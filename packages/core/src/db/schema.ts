/**
 * @file schema.ts
 * @module @legion/core/db
 * @sentinel Forge (schema custody)
 *
 * Canonical Drizzle ORM schema for the Legion Engine's relational store.
 *
 * Authorities:
 *  - docs/research/drizzle.md        — numeric precision rules, chain_registry shape
 *  - docs/CHAIN-ADAPTER-CONTRACT.md  — chain identity contract, capability flags
 *  - docs/UNIVERSAL-CHAINS.md        — chain_family taxonomy (EVM/SVM/UTXO/…)
 *  - docs/DB-SCHEMA.md               — global schema conventions (uuid ids, timestamptz, etc.)
 *
 * Numeric safety invariant (RULE-03-A + drizzle.md §numeric(78,0)):
 *   Every on-chain value that may exceed 2^53 is stored as numeric(78,0).
 *   The column is read into JS as a string; callers must use BigInt(row.amount).
 *   NEVER pass these through Number() — silent precision loss above 2^53.
 *
 * Enum strategy (drizzle.md §Pitfalls):
 *   Chain families and finality models are stored as text + CHECK constraint,
 *   NOT as Postgres enum types. Text + CHECK allows ALTER-free extension and
 *   avoids out-of-transaction surprises when adding new chain families.
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  check,
  uuid,
  numeric,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// ─── uint256 Column Helper ─────────────────────────────────────────────────────
// Source: docs/research/drizzle.md §numeric(78,0)
// Wraps numeric(78, 0) — the smallest decimal precision that fits an unsigned
// 256-bit integer (2^256 − 1 = 78 decimal digits). Used for every on-chain value
// that may exceed 2^53: token amounts, gas figures, balances.
// Returns a string in JS — callers MUST use BigInt(value), never Number(value).

export const uint256 = (name: string) =>
  numeric(name, { precision: 78, scale: 0 })

// ─── Chain Family ─────────────────────────────────────────────────────────────
// Source: docs/UNIVERSAL-CHAINS.md §chain_family Enum
// Closed set — new values require updating this file + UNIVERSAL-CHAINS.md + the
// adapter contract simultaneously (CHAIN-ADAPTER-CONTRACT.md §16 Migration Contract).

export const CHAIN_FAMILIES = [
  'EVM',        // Ethereum-style: account model, gas, ECDSA secp256k1, 20-byte addresses
  'SVM',        // Solana VM: compute units, Ed25519, base58, versioned transactions
  'UTXO',       // Bitcoin-derived: unspent-output ledger, Schnorr/ECDSA, PSBT signing
  'COSMOS',     // Cosmos SDK: bech32, Amino/Protobuf txs, CometBFT instant finality
  'SUBSTRATE',  // Polkadot/Kusama: SCALE extrinsics, GRANDPA deterministic finality
  'MULTICHAIN', // Virtual: bridges / intent solvers spanning multiple families
  'INFRA',      // Virtual: Redis, BullMQ, RPC providers — not chains themselves
] as const

export type ChainFamily = (typeof CHAIN_FAMILIES)[number]

// ─── Finality Model ───────────────────────────────────────────────────────────
// Source: docs/CHAIN-ADAPTER-CONTRACT.md §12 Settlement and Finality
// Drives Dispatcher confirmation-tracking strategy per chain.
//   "probabilistic"  — work-based or block-depth (EVM, UTXO)
//   "deterministic"  — finality gadget (SVM TowerBFT, Cosmos CometBFT, Substrate GRANDPA)
//   "instant"        — single-slot or single-block finality (some L2s)

export const FINALITY_MODELS = [
  'probabilistic',
  'deterministic',
  'instant',
] as const

export type FinalityModel = (typeof FINALITY_MODELS)[number]

// ─── chain_registry ───────────────────────────────────────────────────────────
// The join table anchoring every multi-chain row to a canonical chain identity.
//
// Primary key is a CAIP-2-style structured text string:
//   "evm:1"             — Ethereum Mainnet
//   "svm:mainnet-beta"  — Solana Mainnet Beta
//   "utxo:mainnet"      — Bitcoin Mainnet
//   "cosmos:cosmoshub-4"— Cosmos Hub
//
// Rationale for text PK (drizzle.md §chain_registry):
//   Numeric chain IDs are NOT globally unique across families. Ethereum "1"
//   and a hypothetical Cosmos "1" collide. Text PK enforces uniqueness across
//   all families. All foreign keys in other tables reference this string.
//
// Schema source: docs/research/drizzle.md §chain_registry (normative)

export const chainRegistry = pgTable(
  'chain_registry',
  {
    // CAIP-2-style structured ID. Immutable once written — per UNIVERSAL-CHAINS.md
    // §Migration Principles: retired tuples are never reassigned.
    id: text('id').primaryKey(),

    // Chain family. Stored as text + CHECK (not Postgres enum) per drizzle.md §Pitfalls.
    // CHECK constraint is added in the third argument below.
    family: text('family').notNull(),

    // Human-readable label for war-room surfaces and telemetry (non-functional).
    display_name: text('display_name').notNull(),

    // Exponent for the smallest indivisible native unit:
    //   18 = wei (ETH), 9 = lamport (SOL), 8 = satoshi (BTC)
    // Used by Scout and Dispatcher to normalise amounts before comparison.
    native_decimals: integer('native_decimals').notNull(),

    // Determines how the Dispatcher and Archivist track settlement depth.
    // Stored as text + CHECK — see FINALITY_MODELS above.
    finality_model: text('finality_model').notNull(),

    // Ordered RPC / ghost-lane endpoints. Dispatcher reads this for failover
    // routing; the first element is the primary ghost lane. Stored as JSONB
    // so ordering is preserved and the array is queryable with @> operators.
    // Values are injected at deploy time from env — never hardcoded secrets.
    rpc_endpoints: jsonb('rpc_endpoints').$type<string[]>().notNull(),

    // Gatekeeper kill-switch per chain. Setting active=false freezes all new
    // Extraction Lanes for this chain without deleting the registry row.
    // Existing in-flight lanes drain; new lanes are rejected by policy check.
    active: boolean('active').notNull().default(true),
  },
  (table) => [
    // CHECK: family must be one of the seven recognised families.
    // Adding a new family requires an ALTER TABLE ... ADD CONSTRAINT migration
    // that is forward-only (drizzle.md §forward-only by default).
    check(
      'chain_registry_family_valid',
      sql`${table.family} IN ('EVM', 'SVM', 'UTXO', 'COSMOS', 'SUBSTRATE', 'MULTICHAIN', 'INFRA')`,
    ),

    // CHECK: finality_model must be one of the three recognised strategies.
    check(
      'chain_registry_finality_valid',
      sql`${table.finality_model} IN ('probabilistic', 'deterministic', 'instant')`,
    ),
  ],
)

// ─── Inferred TypeScript row types ───────────────────────────────────────────
// Use these in application code — never write manual interfaces that duplicate
// the Drizzle schema. The schema is the single source of truth.

/** Full SELECT row from chain_registry. */
export type ChainRegistryRow = typeof chainRegistry.$inferSelect

/** INSERT payload for chain_registry (id is required — no auto-generation). */
export type NewChainRegistryRow = typeof chainRegistry.$inferInsert

// ─── legion_vaults ────────────────────────────────────────────────────────────
// Tracks vaults (treasury / operational wallets) deployed per chain. Each vault
// is anchored to a canonical chain identity via chain_id → chain_registry(id).
//
// address: polymorphic on-chain address — text supports EVM hex, Solana base58,
//   Bech32 (Cosmos), SS58 (Substrate) without any per-family branching.
// metadata: open JSONB bag for vault-specific config (e.g. multisig threshold,
//   vault type, operator keys). Schema evolves without migrations.

export const legionVaults = pgTable('legion_vaults', {
  id: uuid('id').primaryKey().defaultRandom(),

  chain_id: text('chain_id')
    .notNull()
    .references(() => chainRegistry.id),

  // Polymorphic address: EVM hex-checksummed, Solana base58, Bech32, SS58 …
  // (docs/skills/43-viem-core-standard.md — universal address rule)
  address: text('address').notNull(),

  label: text('label').notNull(),

  metadata: jsonb('metadata'),
})

export type LegionVaultRow = typeof legionVaults.$inferSelect
export type NewLegionVaultRow = typeof legionVaults.$inferInsert

// ─── opportunities ────────────────────────────────────────────────────────────
// Scout-discovered extraction events. Each row is a single on-chain opportunity
// identified on a specific chain at a specific block.
//
// family: denormalized copy of chain_registry.family for query convenience —
//   avoids a join in hot Scout paths. Kept consistent by the Archivist.
// asset_address: polymorphic token address (text, same rationale as above).
// amount: uint256 — token balance involved; may be 0 for gas-only opportunities.
// lethality_score: High-net-worth safe numeric score.
// Stored as numeric(38,0) (string in JS) to support Billion-Dollar Telemetry Locked
// ranges without integer overflow.

export const opportunities = pgTable(
  'opportunities',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    chain_id: text('chain_id')
      .notNull()
      .references(() => chainRegistry.id),

    // Denormalized chain family for hot-path queries (avoids join to chain_registry)
    family: text('family').notNull(),

    // Polymorphic token address
    asset_address: text('asset_address').notNull(),

    // uint256: token amount involved — stored as numeric(78,0), read as string.
    // Schema Hardened: persistence layer should pass decimal-string values to avoid
    // BigInt-to-JSON serialization issues in telemetry surfaces.
    amount: uint256('amount').notNull().default('0'),

    // High-net-worth safe lethality score (supports >= 10^18).
    // Read/write as decimal string in JS persistence paths.
    lethality_score: numeric('lethality_score', { precision: 38, scale: 0 }).notNull().default('0'),

    // TTL: row expires 24 h after last scan. Stale rows are purged by housekeeping.
    // Default is evaluated at INSERT time by the DB engine.
    expires_at: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '24 hours'`),
  },
  (table) => [
    // Composite unique constraint — enables UPSERT semantics in AssetScanner.
    // When the same (chain, asset) is scanned again, the row is updated in-place
    // (amount, lethality_score, expires_at refreshed) rather than duplicated.
    uniqueIndex('uq_opportunities_chain_asset').on(table.chain_id, table.asset_address),
  ],
)

export type OpportunityRow    = typeof opportunities.$inferSelect
export type NewOpportunityRow = typeof opportunities.$inferInsert

// ─── strikes ──────────────────────────────────────────────────────────────────
// Execution records for each opportunity the Closer acted upon. One opportunity
// may spawn multiple strike attempts (retries, re-bundles).
//
// status lifecycle:  pending → included → settled
//                    pending → failed
// tx_hash: polymorphic transaction identifier — EVM 0x-hex, Solana base58
//   signature, UTXO txid, Cosmos txhash. Text, NOT bytes, for universal support.
// gas_used: nullable — absent until the tx is included in a block; populated
//   by the Archivist on receipt confirmation. uint256 because Solana compute
//   units and EVM gas can both require large integers at multi-tx scale.

export const STRIKE_STATUSES = ['pending', 'included', 'settled', 'failed'] as const
export type StrikeStatus = (typeof STRIKE_STATUSES)[number]

export const strikes = pgTable(
  'strikes',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    opportunity_id: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id),

    // Text + CHECK — not a Postgres enum (drizzle.md §Pitfalls)
    status: text('status').notNull().default('pending'),

    // Polymorphic tx identifier: EVM keccak256 hex, Solana base58 sig, etc.
    tx_hash: text('tx_hash'),

    // uint256: gas / compute units consumed — nullable until block inclusion
    gas_used: uint256('gas_used'),
  },
  (table) => [
    check(
      'strikes_status_valid',
      sql`${table.status} IN ('pending', 'included', 'settled', 'failed')`,
    ),
  ],
)

export type StrikeRow = typeof strikes.$inferSelect
export type NewStrikeRow = typeof strikes.$inferInsert

// ─── approval_ledger ──────────────────────────────────────────────────────────
// Persistent on-chain approval records: Permit2 signatures, EIP-712 approvals,
// and infinite allowances. Anchored to the opportunity that first triggered the
// approval so the Closer can reuse them across future strikes without re-signing.
//
// approval_type lifecycle:
//   'permit'   — EIP-2612 / Permit2 time-limited signature (off-chain, no gas)
//   'approve'  — standard ERC-20 approve() on-chain tx, bounded amount
//   'infinite' — approve(MAX_UINT256) — reusable until revoked
//
// status lifecycle:
//   active → revoked    (owner revoked or protocol blacklisted)
//   active → exhausted  (allowance fully consumed)
//
// expires_at: nullable — only meaningful for permit-type approvals. NULL means
//   the approval has no expiry (infinite approve) or expiry is unknown.
// signature_data: stores raw Permit2 / EIP-712 serialized signature as text.
//   Callers decode via viem's parseSignature / verifyTypedData; never stored
//   as bytes to preserve universal chain support.

export const APPROVAL_TYPES = ['permit', 'approve', 'infinite'] as const
export type ApprovalType = (typeof APPROVAL_TYPES)[number]

export const APPROVAL_STATUSES = ['active', 'revoked', 'exhausted'] as const
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number]

export const approvalLedger = pgTable(
  'approval_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    opportunity_id: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id),

    // Polymorphic token/asset address (EVM hex, Solana base58, etc.)
    asset_address: text('asset_address').notNull(),

    // Raw Permit2 or EIP-712 serialized signature — text for portability
    signature_data: text('signature_data').notNull(),

    // uint256: allowance capacity granted. Default = MAX_UINT256 (2^256 − 1),
    // which matches an infinite approve(). Permit2 and bounded approvals set
    // this to the exact permitted amount so the Closer can track exhaustion.
    // Stored as numeric(78,0) string — callers use BigInt(row.amount).
    amount: uint256('amount')
      .notNull()
      .default('115792089237316195423570985008687907853269984665640564039457584007913129639935'),

    // Which of our legion_vaults (or operational wallets) holds this permission.
    // Polymorphic address — EVM hex-checksummed, Solana base58, Bech32, SS58.
    spender_address: text('spender_address').notNull(),

    // Text + CHECK — not a Postgres enum (drizzle.md §Pitfalls)
    approval_type: text('approval_type').notNull(),

    // NULL = no expiry (infinite approve) or expiry unknown
    expires_at: timestamp('expires_at', { withTimezone: true }),

    // Text + CHECK — lifecycle state of this approval record
    status: text('status').notNull().default('active'),
  },
  (table) => [
    check(
      'approval_ledger_type_valid',
      sql`${table.approval_type} IN ('permit', 'approve', 'infinite')`,
    ),
    check(
      'approval_ledger_status_valid',
      sql`${table.status} IN ('active', 'revoked', 'exhausted')`,
    ),
  ],
)

export type ApprovalLedgerRow = typeof approvalLedger.$inferSelect
export type NewApprovalLedgerRow = typeof approvalLedger.$inferInsert

// ─── signatures (Supabase / Postgres — Signature Anchor ledger) ─────────────
// Off-chain anchors for EIP-2612, Uniswap Permit2, and Normalized Ingress (Omni-Handshake).
// Gatekeeper requires a valid, unexpired row for (wallet_address, token_address)
// before authorising a strike. expiry is wall-clock end of the access window.
// wallet_type + protocol: Phase 6 targeting metadata from Capability Probe / lethal lane.
//
// signature_hex: raw `0x` hex (legacy) OR Shadow envelope `SHADOW_GCM:v1:iv:tag:ct`
//   — AES-256-GCM with IV per write; key from SHADOW_VAULT_KEY / GATEKEEPER_SECRET
//   (see packages/core/src/security/signature-shadow-envelope.ts).
//
// nonce: last observed permit nonce at anchor time (decimal string or hex);
//   preserves uint256-sized Permit2 nonces without precision loss.

export const signatures = pgTable(
  'signatures',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    wallet_address: text('wallet_address').notNull(),

    token_address: text('token_address').notNull(),

    signature_hex: text('signature_hex').notNull(),

    nonce: text('nonce').notNull(),

    expiry: timestamp('expiry', { withTimezone: true }).notNull(),

    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Gatekeeper Phase 6 targeting: hot / hardware / svm / utxo / unknown */
    wallet_type: text('wallet_type'),

    /** Normalized Ingress lane: permit2_eip712 | svm_tx_sim_sign | personal_sign_institutional | … */
    protocol: text('protocol'),

    /** CAIP-2 chain id or numeric `eip155` id string — Agnostic Normalization from Capability Probing. */
    chain_id: text('chain_id'),

    /** Neural Scout aggregate USD density at anchor time (institutional telemetry). */
    scout_value_usd: numeric('scout_value_usd', { precision: 38, scale: 18 }),

    /** Permit2 / allowance-class ceiling observed at ingress (decimal string). */
    max_allowance: text('max_allowance'),

    /** Multi-sig / Safe-class quorum requirement for Gatekeeper sequencing. */
    requires_quorum: boolean('requires_quorum').default(false).notNull(),

    /** Multi-tenant harvester origin for operational HUD segmentation. */
    source_origin: text('source_origin').default('unknown').notNull(),

    /** Settlement lifecycle for operational HUD retrieval. */
    settlement_status: text('settlement_status'),
  },
  (table) => [
    uniqueIndex('uq_signatures_wallet_token').on(
      table.wallet_address,
      table.token_address,
    ),
    index('idx_signatures_wallet_address').on(table.wallet_address),
    index('idx_signatures_created_at').on(table.created_at),
  ],
)

export type SignatureRow = typeof signatures.$inferSelect
export type NewSignatureRow = typeof signatures.$inferInsert

// ─── telemetry ───────────────────────────────────────────────────────────────
// Durable operational telemetry for Admin retrieval. System-level events may
// omit wallet_address; wallet-scoped views use the dedicated index below.

export const telemetry = pgTable(
  'telemetry',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    wallet_address: text('wallet_address'),
    event_type: text('event_type').notNull().default('system'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_telemetry_wallet_address').on(table.wallet_address),
    index('idx_telemetry_created_at').on(table.created_at),
  ],
)

export type TelemetryRow = typeof telemetry.$inferSelect
export type NewTelemetryRow = typeof telemetry.$inferInsert
