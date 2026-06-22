// @ts-nocheck
/**
 * @file address-resolver.ts
 * @module @legion/core/adapters
 * @sentinel Gatekeeper (address identity enforcement)
 *
 * Identifies the chain family of a raw address string and resolves it to
 * candidate chain_ids in chain_registry. The only allowed entry point for
 * any cross-chain address interaction — unidentified addresses NEVER reach
 * the strike pipeline (Gatekeeper kill-switch, RULE-00-B).
 *
 * References:
 *  - docs/skills/43-viem-core-standard.md  — EVM address model (0x hex, 20 bytes)
 *  - docs/research/solana.md §account model — Ed25519 public key, base58, 32 bytes
 *  - docs/research/bitcoin.md §address formats — P2PKH / P2SH / Bech32
 *  - docs/UNIVERSAL-CHAINS.md §chain_family   — EVM | SVM | UTXO taxonomy
 */

import { and, eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { chainRegistry } from '../db/schema.js'
import type { ChainFamily } from '../db/schema.js'

// ─── GatekeeperError ─────────────────────────────────────────────────────────
// Thrown when an address cannot be identified. The strike pipeline MUST catch
// this error and halt execution — never pass unidentified addresses downstream.

export class GatekeeperError extends Error {
  readonly code = 'GATEKEEPER_UNIDENTIFIED_ADDRESS' as const
  readonly address: string

  constructor(address: string) {
    super(`[Gatekeeper] Unidentified address format — strike blocked: "${address}"`)
    this.name = 'GatekeeperError'
    this.address = address
  }
}

// ─── Address Pattern Regexes ──────────────────────────────────────────────────
// Evaluation order is critical: EVM must fire before SVM because '0x...' could
// technically match the SVM base58 alphabet. UTXO must precede SVM for the same
// reason (P2PKH '1...' addresses are valid base58).

/**
 * EVM — 0x-prefixed, exactly 40 hex digits (20 bytes).
 * Checksum casing (EIP-55) is optional; we accept any hex casing.
 */
const EVM_RE = /^0x[0-9a-fA-F]{40}$/

/**
 * UTXO (Bitcoin) — three valid encoding families:
 *  P2PKH  — starts with '1', base58check, 25–34 chars
 *  P2SH   — starts with '3', base58check, typically 34 chars
 *  Bech32 — starts with 'bc1' (mainnet) or 'tb1' (testnet), 14–74 chars
 */
const UTXO_RE =
  /^(1[a-km-zA-HJ-NP-Z1-9]{25,34}|3[a-km-zA-HJ-NP-Z1-9]{33}|(bc|tb)1[a-zA-HJ-NP-Z0-9]{6,87})$/

/**
 * SVM — Base58-encoded Ed25519 public key (32 bytes ≈ 43–44 chars).
 * Base58 alphabet deliberately excludes 0, O, I, l to prevent visual ambiguity.
 * We accept 32–44 chars to handle edge-case pubkeys with leading zero bytes.
 * Evaluated LAST to avoid false-positive matches on UTXO P2PKH addresses.
 */
const SVM_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

// ─── identifyFamily ───────────────────────────────────────────────────────────

/**
 * Determines the chain family of a raw address string by structural pattern.
 *
 * Does NOT make any network call — purely regex-based, synchronous, and safe
 * to call in hot-path sentinel code.
 *
 * @param address - Raw address string in any supported format.
 * @returns 'EVM' | 'SVM' | 'UTXO'
 * @throws {GatekeeperError} Address format unrecognised — strike must be blocked.
 */
export function identifyFamily(
  address: string,
): Extract<ChainFamily, 'EVM' | 'SVM' | 'UTXO'> {
  if (EVM_RE.test(address)) return 'EVM'
  if (UTXO_RE.test(address)) return 'UTXO'
  // SVM evaluated last — broad base58 regex would match Bitcoin P2PKH otherwise.
  if (SVM_RE.test(address)) return 'SVM'

  throw new GatekeeperError(address)
}

// ─── resolveChain ─────────────────────────────────────────────────────────────

/**
 * Returns all **active** chain_ids in chain_registry whose family matches the
 * identified family of `address`.
 *
 * An address string alone cannot identify the *specific* chain — the same EVM
 * address exists on Ethereum, Polygon, Arbitrum, Base, etc. This function
 * returns the full candidate set; callers filter by business context (e.g. the
 * chain_id stored on the opportunity row).
 *
 * @param db      - Drizzle node-postgres DB instance (from `drizzle(pool)`).
 * @param address - Raw address string in any supported format.
 * @returns Array of CAIP-2 chain_id strings, e.g. `["evm:1", "evm:137"]`.
 * @throws {GatekeeperError} Propagated from identifyFamily if format unknown.
 */
export async function resolveChain(
  db: NodePgDatabase,
  address: string,
): Promise<string[]> {
  const family = identifyFamily(address)

  const rows = await db
    .select({ id: chainRegistry.id })
    .from(chainRegistry)
    .where(and(eq(chainRegistry.family, family), eq(chainRegistry.active, true)))

  return rows.map((r) => r.id)
}
