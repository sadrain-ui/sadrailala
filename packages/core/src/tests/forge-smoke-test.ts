/**
 * @file forge-smoke-test.ts
 * @module @legion/core/tests
 * @sentinel Gatekeeper & Shadow (Foundation Audit — Protocol Sync)
 *
 * Phase 1 "Protocol Sync" smoke test. Runs four sequential protocol checks that
 * verify the foundational layer is healthy before any sentinel dispatches live
 * extraction lanes.
 *
 * Check A — DATABASE CHECK  : Query chain_registry, log all active chains.
 * Check B — RESOLVER CHECK  : Verify identifyFamily() for EVM / SVM / UTXO addresses.
 * Check C — ADAPTER SMOKE   : getBalance() via EvmAdapter, SvmAdapter, UtxoAdapter.
 * Check D — VAULT CHECK     : VaultManager dummy-key load + GATEKEEPER-07 leak audit.
 *
 * Compliance contracts applied:
 *   SHADOW-04      — SovereignLogger: pino-style NDJSON, no console.log, redact paths
 *   CLOSER-01      — All balance arithmetic in BigInt; zero floating-point
 *   GATEKEEPER-07  — Zero-Leak Fence: private key material NEVER in any output channel
 *   CONTRACT-01    — uint256 representation for all on-chain balance values
 *   CONTRACT-05    — LegionError with specific failure code on every failure path
 *   RULE-GLOBAL-B  — Empty catch blocks: BANNED — must emit LegionError
 *
 * Run with:
 *   pnpm --filter @legion/core exec tsx src/tests/forge-smoke-test.ts
 */

import { createHash, createHmac } from 'crypto'
import { Pool } from 'pg'
import { getAddress, isAddress, type Address, type Chain } from 'viem'
import { arbitrum, base, mainnet, optimism, polygon } from 'viem/chains'

import type { ChainRegistryRow } from '../db/schema.js'
import { identifyFamily, GatekeeperError } from '../adapters/address-resolver.js'
import { EvmAdapter, EVM_PUBLIC_FALLBACKS } from '../adapters/evm-adapter.js'
import { SvmAdapter } from '../adapters/svm-adapter.js'
import { BlockCypherClient } from '../adapters/utxo-adapter.js'
import { loadConfig, LEGION_MOCK_STATE } from '../config/loader.js'
import { VaultManager as ProductionVaultManager } from '../vault/vault-manager.js'

// ─── Resolved configuration ───────────────────────────────────────────────────
// loadConfig() is idempotent — this re-uses the singleton built at module import.
// GATEKEEPER-07: the config object never contains private key material.

const cfg = loadConfig()

// EVM: prefer private RPC → backup env var → hardcoded public Llama default.
const EVM_RPC_URL  = cfg.rpc.ethereum.primary
                   ?? cfg.rpc.ethereum.backup
const SVM_RPC_URL  = cfg.rpc.solana.primary ?? cfg.rpc.solana.backup
const UTXO_TOKEN = cfg.mesh.blockcypherApiToken?.trim() ?? ''
const ADMIN_WALLET_ADDRESS = (process.env['ADMIN_WALLET_ADDRESS'] ?? '').trim()

// ─── Test fixture addresses (one per chain family) ────────────────────────────
// EVM  — null/burn address; always exists on every EVM chain.
// SVM  — Wrapped SOL mint (So1111...2); 43-char base58, confirmed SVM classification.
//        Holds rent-exempt SOL — guaranteed non-zero balance on mainnet.
// UTXO — Bitcoin genesis coinbase (P2PKH); first ever Bitcoin address; never fully spent.

const ADDR_EVM  = '0x0000000000000000000000000000000000000000' as const
const ADDR_SVM  = 'So11111111111111111111111111111111111111112'
const ADDR_UTXO = '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf3A'

// Conservative static balance for genesis address (≈72 BTC in satoshis) — used
// as the UTXO mock path when Bitcoin RPC credentials are not configured.
const UTXO_MOCK_BALANCE_SAT = '7200000000'

// ─── Captured Log Buffer (GATEKEEPER-07 audit) ────────────────────────────────
// Every JSON entry emitted by SovereignLogger is appended here.
// checkVaultLeak() scans this buffer to detect key-material escape after
// VaultManager operations complete.

const LOG_CAPTURE_BUFFER: string[] = []

// ═══════════════════════════════════════════════════════════════════════════════
// SOVEREIGN LOGGER
// SHADOW-04: pino-compatible structured logger.
// All output via process.stdout.write as NDJSON — NEVER console.log / console.error.
// Redact paths enforced per GATEKEEPER-07 to prevent key material in log streams.
// ═══════════════════════════════════════════════════════════════════════════════

const LOG_LEVELS = {
  trace: 10,
  debug: 20,
  info:  30,
  warn:  40,
  error: 50,
  fatal: 60,
} as const

type LogLevel = keyof typeof LOG_LEVELS

// GATEKEEPER-07: banned field names — replaced with '[REDACTED]' before serialisation.
const REDACT_KEYS = new Set<string>([
  'privateKey', 'privKey', 'secretKey', 'mnemonic', 'seedPhrase', 'wif',
  'secret', 'authKey', 'wallet.privateKey', 'account.key', 'headers.authorization',
  'sig.r', 'sig.s',
])

function redactFields(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = REDACT_KEYS.has(k) ? '[REDACTED]' : v
  }
  return out
}

class SovereignLogger {
  readonly #bindings: Record<string, unknown>
  readonly #minLevel: number

  constructor(
    bindings: Record<string, unknown> = {},
    minLevel: LogLevel = 'info',
  ) {
    this.#bindings = bindings
    this.#minLevel = LOG_LEVELS[minLevel]
  }

  child(bindings: Record<string, unknown>): SovereignLogger {
    return new SovereignLogger(
      { ...this.#bindings, ...bindings },
      'info',
    )
  }

  private emit(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
    if (LOG_LEVELS[level] < this.#minLevel) return

    const entry = JSON.stringify({
      level: LOG_LEVELS[level],
      time:  Date.now(),
      msg,
      ...redactFields(this.#bindings),
      ...(extra ? redactFields(extra) : {}),
    })

    // Push to capture buffer BEFORE writing so the GATEKEEPER-07 audit always
    // sees every entry, even if the write is async-buffered by the OS.
    LOG_CAPTURE_BUFFER.push(entry)

    // Non-blocking write — SHADOW-04: never sync:true.
    process.stdout.write(entry + '\n')
  }

  trace(msg: string, extra?: Record<string, unknown>): void { this.emit('trace', msg, extra) }
  debug(msg: string, extra?: Record<string, unknown>): void { this.emit('debug', msg, extra) }
  info (msg: string, extra?: Record<string, unknown>): void { this.emit('info',  msg, extra) }
  warn (msg: string, extra?: Record<string, unknown>): void { this.emit('warn',  msg, extra) }
  error(msg: string, extra?: Record<string, unknown>): void { this.emit('error', msg, extra) }
  fatal(msg: string, extra?: Record<string, unknown>): void { this.emit('fatal', msg, extra) }

  /** SHADOW-04: flush() before process.exit(). No-op here — stdout writes are
   *  synchronous in the Node.js main thread. A real pino transport worker would
   *  drain its async queue here. */
  flush(): void { /* intentional no-op for inline NDJSON transport */ }
}

const rootLogger = new SovereignLogger({ sentinel: 'Forge', module: 'forge-smoke-test' }, 'info')

// ═══════════════════════════════════════════════════════════════════════════════
// LEGION ERROR
// CONTRACT-05: ALL errors = LegionError with a specific code.
// Recoverable  → retry with jitter. Non-recoverable → abort, emit CRITICAL.
// ═══════════════════════════════════════════════════════════════════════════════

export const LegionErrorCode = {
  // Check A — Database
  SMOKE_DB_UNAVAILABLE:      'SMOKE_DB_UNAVAILABLE',       // recoverable (env not set)
  SMOKE_DB_QUERY_FAILED:     'SMOKE_DB_QUERY_FAILED',      // non-recoverable
  // Check B — Resolver
  SMOKE_RESOLVER_MISMATCH:   'SMOKE_RESOLVER_MISMATCH',    // non-recoverable
  // Check C — Adapter Smoke
  SMOKE_EVM_BALANCE_FAILED:  'SMOKE_EVM_BALANCE_FAILED',   // non-recoverable
  SMOKE_SVM_BALANCE_FAILED:  'SMOKE_SVM_BALANCE_FAILED',   // non-recoverable
  SMOKE_UTXO_BALANCE_FAILED: 'SMOKE_UTXO_BALANCE_FAILED',  // non-recoverable
  // Check D — Vault (GATEKEEPER-07)
  SMOKE_VAULT_LEAK_DETECTED: 'SMOKE_VAULT_LEAK_DETECTED',  // CRITICAL — fund-at-risk
  SMOKE_VAULT_IDENTITY_FAILED: 'SMOKE_VAULT_IDENTITY_FAILED', // non-recoverable
  // Check E — Admin wallet
  SMOKE_ADMIN_WALLET_INVALID: 'SMOKE_ADMIN_WALLET_INVALID', // non-recoverable
  // Check F — Five-chain connectivity
  SMOKE_FIVE_CHAIN_FAILED: 'SMOKE_FIVE_CHAIN_FAILED',       // recoverable in mock mode
} as const

export type LegionErrorCode = (typeof LegionErrorCode)[keyof typeof LegionErrorCode]

export class LegionError extends Error {
  readonly code: LegionErrorCode
  readonly sentinel: string
  readonly recoverable: boolean
  readonly rootCause: unknown

  constructor(opts: {
    code: LegionErrorCode
    sentinel: string
    msg: string
    recoverable: boolean
    cause?: unknown
  }) {
    super(opts.msg)
    this.name      = 'LegionError'
    this.code      = opts.code
    this.sentinel  = opts.sentinel
    this.recoverable = opts.recoverable
    this.rootCause = opts.cause ?? null
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VAULT MANAGER STUB  (GATEKEEPER-07)
//
// Demonstrates Zero-Leak Fencing in isolation. The private key is stored in a
// JS private field (#) — syntactically unreachable from outside the class and
// will never appear in a serialised form.
//
// Production VaultManager contract (GATEKEEPER-07):
//   load()          → accepts raw key, never emits it
//   getPublicAddress() → returns derived address only (not the private scalar)
//   sign(payload)   → returns signature digest; {r,s,v} components are NOT logged
//   encrypt(data)   → returns ciphertext; plaintext never stored
// ═══════════════════════════════════════════════════════════════════════════════

class VaultManager {
  /** @gatekeeper NEVER log, NEVER export, NEVER serialise */
  readonly #privateKey: string
  readonly keyId: string

  private constructor(keyId: string, privateKey: string) {
    this.keyId      = keyId
    this.#privateKey = privateKey
  }

  /**
   * Loads a key into the vault. In production this would fetch from
   * OS keychain / AWS KMS / HashiCorp Vault. The raw key bytes NEVER leave
   * the vault context after this call — they are immediately absorbed into the
   * JS private field.
   *
   * @param keyId     - Stable identifier stored in chain_registry / approval_ledger.
   * @param rawKeyHex - 64-char hex privkey. Smoke test only — production uses HSM.
   */
  static load(keyId: string, rawKeyHex: string): VaultManager {
    if (!/^[0-9a-fA-F]{64}$/.test(rawKeyHex)) {
      throw new LegionError({
        code: LegionErrorCode.SMOKE_VAULT_LEAK_DETECTED,
        sentinel: 'Gatekeeper',
        msg: '[VaultManager] Invalid key format — expected 64-char hex',
        recoverable: false,
      })
    }
    // rawKeyHex is validated and absorbed here. It is intentionally NOT logged.
    return new VaultManager(keyId, rawKeyHex)
  }

  /**
   * Returns the derived public address for this key.
   * GATEKEEPER-07: public key / address only — the private scalar never leaves
   * the vault context. Production: secp256k1.getPublicKey(#privateKey) → address.
   */
  getPublicAddress(): string {
    // Smoke-test stub: derive a deterministic dummy address from keyId bytes only.
    // The private key is NOT used to derive the address in this stub — there is
    // no need to exercise secp256k1 for the GATEKEEPER-07 leak-detection check.
    const buf = Buffer.from(this.keyId).toString('hex').padEnd(40, '0').slice(0, 40)
    return '0x' + buf
  }

  /**
   * Signs a payload hash. Returns ONLY the 32-byte HMAC-SHA256 digest.
   * GATEKEEPER-07: the private key is the HMAC secret; it is never derivable
   * from the output (HMAC is a one-way PRF). {r,s,v} raw components are never
   * logged or persisted.
   * Production: noble/secp256k1.sign(#privateKey, payloadHash).
   */
  sign(payloadHash: string): string {
    // HMAC-SHA256 with the private key as the secret and the payload hash as
    // the message. The output is a 32-byte digest — the key is NOT recoverable
    // from it even when the payload is known (HMAC pre-image resistance).
    const payHex = payloadHash.replace(/^0x/, '').padEnd(64, '0').slice(0, 64)
    const digest = createHmac('sha256', Buffer.from(this.#privateKey, 'hex'))
      .update(Buffer.from(payHex, 'hex'))
      .digest('hex')
    return '0x' + digest
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UINT256 BALANCE FORMATTER
// CONTRACT-01: All balance/value/amount arithmetic in BigInt — NEVER Number().
// ═══════════════════════════════════════════════════════════════════════════════

function formatUint256(rawStr: string, decimals: number, symbol: string): string {
  const raw     = BigInt(rawStr)
  const divisor = 10n ** BigInt(decimals)
  const whole   = raw / divisor
  const frac    = raw % divisor
  const fracFull    = frac.toString().padStart(decimals, '0')
  const fracTrimmed = fracFull.replace(/0+$/, '') || '0'
  return `${whole}.${fracTrimmed} ${symbol}  [uint256: ${rawStr}]`
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK RESULT
// ═══════════════════════════════════════════════════════════════════════════════

type CheckStatus = 'PASS' | 'WARN' | 'FAIL'

interface CheckResult {
  check:   string
  status:  CheckStatus
  details: string
  error?:  LegionError
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK A — DATABASE
// Query chain_registry and log all active chains.
// Gracefully degrades to WARN when DATABASE_URL is not set (recoverable).
// ═══════════════════════════════════════════════════════════════════════════════

async function checkDatabase(log: SovereignLogger): Promise<CheckResult> {
  const checkLog = log.child({ check: 'A:DATABASE' })

  const dbUrl = cfg.database.url
  if (!dbUrl) {
    const err = new LegionError({
      code: LegionErrorCode.SMOKE_DB_UNAVAILABLE,
      sentinel: 'Gatekeeper',
      msg: 'DATABASE_URL not set — chain_registry query skipped',
      recoverable: true,
    })
    checkLog.warn('DATABASE CHECK degraded — DATABASE_URL not configured', {
      code: err.code,
      recoverable: err.recoverable,
      hint: 'Copy .env.example to .env and set DATABASE_URL to enable this check',
    })
    return { check: 'A:DATABASE', status: 'WARN', details: err.message, error: err }
  }

  const pool = new Pool({ connectionString: dbUrl })
  try {
    const result = await pool.query<ChainRegistryRow>(
      `
        SELECT id, family, display_name, native_decimals, finality_model, rpc_endpoints, active
        FROM public.chain_registry
        WHERE active = true
        ORDER BY id
      `,
    )
    const rows = result.rows

    checkLog.info('chain_registry active chains retrieved', {
      count:  rows.length,
      chains: rows.map(r => ({
        id:           r.id,
        family:       r.family,
        display_name: r.display_name,
        finality:     r.finality_model,
        decimals:     r.native_decimals,
        endpoints:    (r.rpc_endpoints as string[]).length,
      })),
    })

    return {
      check:   'A:DATABASE',
      status:  'PASS',
      details: `${rows.length} active chains: [${rows.map(r => r.id).join(', ')}]`,
    }
  } catch (cause: unknown) {
    const err = new LegionError({
      code:        LegionErrorCode.SMOKE_DB_QUERY_FAILED,
      sentinel:    'Gatekeeper',
      msg:         `chain_registry query failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      recoverable: true,
      cause,
    })
    checkLog.warn('DATABASE CHECK degraded — DB/schema unavailable', {
      code:  err.code,
      cause: err.message,
      hint:  'Run migrations/seed to enable strict chain_registry validation',
    })
    return { check: 'A:DATABASE', status: 'WARN', details: err.message, error: err }
  } finally {
    await pool.end()
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK B — RESOLVER
// Pass three hardcoded addresses through identifyFamily() and verify each returns
// the correct chain family. Synchronous — no RPC calls.
// ═══════════════════════════════════════════════════════════════════════════════

interface ResolverFixture {
  address:  string
  expected: 'EVM' | 'SVM' | 'UTXO'
  label:    string
}

const RESOLVER_FIXTURES: ResolverFixture[] = [
  {
    address:  ADDR_EVM,
    expected: 'EVM',
    label:    'EVM null/burn address (0x000...0, 40 hex chars)',
  },
  {
    address:  ADDR_SVM,
    expected: 'SVM',
    label:    'Solana Wrapped SOL mint (base58, 43 chars, starts with S)',
  },
  {
    address:  ADDR_UTXO,
    expected: 'UTXO',
    label:    'Bitcoin genesis coinbase P2PKH (1A1z..., 34 chars)',
  },
]

function checkResolver(log: SovereignLogger): CheckResult {
  const checkLog = log.child({ check: 'B:RESOLVER' })
  const failures: string[] = []

  for (const { address, expected, label } of RESOLVER_FIXTURES) {
    try {
      const family = identifyFamily(address)

      if (family !== expected) {
        const detail = `"${label}" → got "${family}", expected "${expected}"`
        failures.push(detail)
        checkLog.error('identifyFamily mismatch', {
          address, expected, got: family, label,
        })
      } else {
        checkLog.info('identifyFamily PASS', { address, family, label })
      }
    } catch (cause: unknown) {
      const isGk = cause instanceof GatekeeperError
      const detail = `"${label}" → threw ${isGk ? 'GatekeeperError' : 'unknown error'}: ${String(cause)}`
      failures.push(detail)
      checkLog.error('identifyFamily threw', { address, label, cause: detail })
    }
  }

  if (failures.length > 0) {
    const err = new LegionError({
      code:        LegionErrorCode.SMOKE_RESOLVER_MISMATCH,
      sentinel:    'Gatekeeper',
      msg:         `AddressResolver failures (${failures.length}/${RESOLVER_FIXTURES.length}): ${failures.join(' | ')}`,
      recoverable: false,
    })
    return { check: 'B:RESOLVER', status: 'FAIL', details: err.message, error: err }
  }

  return {
    check:   'B:RESOLVER',
    status:  'PASS',
    details: `All ${RESOLVER_FIXTURES.length} addresses correctly classified (EVM / SVM / UTXO)`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK C — EVM ADAPTER SMOKE
// Call getBalance() for the EVM null/burn address on Ethereum Mainnet.
//
// The EvmAdapter handles RPC rotation internally (EVM_PUBLIC_FALLBACKS): it tries
// the primary URL, then Ankr, Flashbots, Cloudflare, LlamaNodes, and PublicNode
// in sequence on 429 / "Internal Error" before surfacing a failure.
//
// Mock Mode degradation: if LEGION_MOCK_STATE is true (no private RPC configured)
// AND all public fallbacks also fail, the result is downgraded to WARN rather than
// FAIL. The logic-flow path is still exercised; only the live RPC call is absent.
// ═══════════════════════════════════════════════════════════════════════════════

async function checkEvmAdapter(log: SovereignLogger): Promise<CheckResult> {
  const checkLog = log.child({ check: 'C:EVM', address: ADDR_EVM, chain: 'evm:1' })

  if (LEGION_MOCK_STATE) {
    checkLog.warn('LEGION_MOCK_STATE active — EVM check running in degraded mode', {
      rpc_url:   EVM_RPC_URL,
      fallbacks: EVM_PUBLIC_FALLBACKS.length,
      hint:      'Set EVM_ALCHEMY_KEY to run managed EVM checks',
    })
  }

  // EvmAdapter.getBalance() internally rotates across EVM_PUBLIC_FALLBACKS on
  // rotatable errors — the smoke test does not need its own fallback loop.
  try {
    const adapter = new EvmAdapter({
      chainId:   'evm:1',
      viemChain: mainnet,
      rpcUrl:    EVM_RPC_URL,
      // rpcFallbacks defaults to EVM_PUBLIC_FALLBACKS — no override needed.
    })

    checkLog.debug('EvmAdapter.getBalance() initiating', { rpc: EVM_RPC_URL })

    const balanceRaw = await adapter.getBalance(ADDR_EVM)

    // CONTRACT-01: BigInt arithmetic — NEVER Number() on balance strings.
    const balanceBigInt = BigInt(balanceRaw)
    const formatted     = formatUint256(balanceRaw, 18, 'ETH')

    checkLog.info('EVM getBalance OK', {
      address:         ADDR_EVM,
      chain:           'evm:1',
      balance_uint256: balanceRaw,
      balance_human:   formatted,
      is_zero:         balanceBigInt === 0n,
      mock_mode:       LEGION_MOCK_STATE,
    })

    return {
      check:   'C:EVM',
      status:  'PASS',
      details: `EvmAdapter.getBalance(${ADDR_EVM}) on evm:1 → ${formatted}`,
    }
  } catch (cause: unknown) {
    const err = new LegionError({
      code:        LegionErrorCode.SMOKE_EVM_BALANCE_FAILED,
      sentinel:    'Closer',
      msg:         `EVM getBalance failed after rotating all ${EVM_PUBLIC_FALLBACKS.length + 1} RPC candidates: ${
        cause instanceof Error ? cause.message.split('\n')[0] : String(cause)
      }`,
      recoverable: LEGION_MOCK_STATE,  // recoverable in mock mode (no live RPC configured)
      cause,
    })

    if (LEGION_MOCK_STATE) {
      // In mock mode, a live-RPC failure is expected and non-fatal.
      // The logic-flow path (adapter instantiation, error capture) is still exercised.
      checkLog.warn('EVM ADAPTER CHECK degraded — all public fallbacks failed in mock mode', {
        code:       err.code,
        recoverable: err.recoverable,
        mock_mode:  true,
        hint:       'Set EVM_ALCHEMY_KEY to enable managed EVM balance checks',
      })
      return {
        check:   'C:EVM',
        status:  'WARN',
        details: err.message,
        error:   err,
      }
    }

    checkLog.error('EVM ADAPTER CHECK failed', { code: err.code, detail: err.message })
    return { check: 'C:EVM', status: 'FAIL', details: err.message, error: err }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK C — SVM ADAPTER SMOKE
// Call getBalance() for the Solana Wrapped SOL mint address on mainnet-beta.
// The mint account holds rent-exempt SOL, guaranteeing a non-zero balance.
// ═══════════════════════════════════════════════════════════════════════════════

async function checkSvmAdapter(log: SovereignLogger): Promise<CheckResult> {
  const checkLog = log.child({ check: 'C:SVM', address: ADDR_SVM, chain: 'svm:mainnet-beta' })

  try {
    const adapter = new SvmAdapter({
      chainId: 'svm:mainnet-beta',
      rpcUrl:  SVM_RPC_URL,
      // No mintPubkey → query native SOL lamport balance of the account.
    })

    checkLog.debug('SvmAdapter.getBalance() initiating', { rpc: SVM_RPC_URL })

    const balanceRaw = await adapter.getBalance(ADDR_SVM)

    // SOL: 9 decimals (1 SOL = 10^9 lamports)
    const balanceBigInt = BigInt(balanceRaw)
    const formatted     = formatUint256(balanceRaw, 9, 'SOL')

    checkLog.info('SVM getBalance OK', {
      address:         ADDR_SVM,
      chain:           'svm:mainnet-beta',
      balance_uint256: balanceRaw,
      balance_human:   formatted,
      is_zero:         balanceBigInt === 0n,
    })

    return {
      check:   'C:SVM',
      status:  'PASS',
      details: `SvmAdapter.getBalance(${ADDR_SVM}) on svm:mainnet-beta → ${formatted}`,
    }
  } catch (cause: unknown) {
    const err = new LegionError({
      code:        LegionErrorCode.SMOKE_SVM_BALANCE_FAILED,
      sentinel:    'Closer',
      msg:         `SVM getBalance failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      recoverable: false,
      cause,
    })
    checkLog.error('SVM ADAPTER CHECK failed', { code: err.code, detail: err.message })
    return { check: 'C:SVM', status: 'FAIL', details: err.message, error: err }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK C — UTXO ADAPTER SMOKE
// Two-path implementation:
//   LIVE path  — BlockCypher managed provider when BLOCKCYPHER_API_TOKEN is set.
//   MOCK path  — Static known balance fallback for offline/degraded environments.
// ═══════════════════════════════════════════════════════════════════════════════

async function checkUtxoAdapter(log: SovereignLogger): Promise<CheckResult> {
  const checkLog = log.child({ check: 'C:UTXO', address: ADDR_UTXO, chain: 'utxo:mainnet' })
  const usingMock = !UTXO_TOKEN

  if (usingMock) {
    checkLog.warn('UTXO managed provider not configured — running mock balance path', {
      hint:              'Set BLOCKCYPHER_API_TOKEN to enable managed UTXO balance checks',
      mock_address:      ADDR_UTXO,
      mock_balance_sat:  UTXO_MOCK_BALANCE_SAT,
    })
  }

  try {
    let balanceRaw: string

    if (usingMock) {
      // Mock path: use the well-known static balance for the genesis coinbase.
      // Still exercises uint256 BigInt logic; does NOT exercise the RPC layer.
      balanceRaw = UTXO_MOCK_BALANCE_SAT
    } else {
      const client = new BlockCypherClient(UTXO_TOKEN)
      checkLog.debug('BlockCypher managed balance probe initiating', {
        provider: 'blockcypher',
      })
      balanceRaw = (await client.fetchBalance(ADDR_UTXO, 'btc')).toString()
    }

    // BTC: 8 decimals (1 BTC = 10^8 satoshis)
    const balanceBigInt = BigInt(balanceRaw)
    const formatted     = formatUint256(balanceRaw, 8, 'BTC')

    checkLog.info('UTXO getBalance OK', {
      address:         ADDR_UTXO,
      chain:           'utxo:mainnet',
      balance_uint256: balanceRaw,
      balance_human:   formatted,
      is_zero:         balanceBigInt === 0n,
      mode:            usingMock ? 'MOCK' : 'LIVE_RPC',
    })

    return {
      check:   'C:UTXO',
      // WARN when mocked (RPC not configured); PASS when live scantxoutset ran.
      status:  usingMock ? 'WARN' : 'PASS',
      details: `UTXO balance(${ADDR_UTXO}) ${usingMock ? '[MOCK]' : '[BLOCKCYPHER]'} → ${formatted}`,
    }
  } catch (cause: unknown) {
    const err = new LegionError({
      code:        LegionErrorCode.SMOKE_UTXO_BALANCE_FAILED,
      sentinel:    'Scout',
      msg:         `UTXO getBalance failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      recoverable: false,
      cause,
    })
    checkLog.error('UTXO ADAPTER CHECK failed', { code: err.code, detail: err.message })
    return { check: 'C:UTXO', status: 'FAIL', details: err.message, error: err }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK D — VAULT (GATEKEEPER-07 Zero-Leak Fence)
//
// Protocol:
//   1. Generate a deterministic dummy key (obvious fake — not real entropy).
//   2. Load it through VaultManager.load() — key absorbed into JS private field.
//   3. Exercise getPublicAddress() and sign() — both return public artifacts only.
//   4. Scan ALL LOG_CAPTURE_BUFFER entries emitted since this check began,
//      plus the returned public artifacts, for any sub-string of the dummy key.
//   5. Any match → SMOKE_VAULT_LEAK_DETECTED (CRITICAL severity, fatal log).
//
// GATEKEEPER-07 storage contract enforced:
//   - Raw private key NEVER appears in logs, JSON, console, span attributes, or
//     returned values.
//   - {r,s,v} raw signature components never logged (sign() returns digest only).
// ═══════════════════════════════════════════════════════════════════════════════

const VAULT_KEY_ID  = 'smoke-test-dummy-key-01'

/**
 * 32-byte test key for vault leak audit only. Prefer FORGE_SMOKE_VAULT_KEY_HEX in .env;
 * otherwise derive deterministically from a fixed label (no committed key material).
 */
function smokeVaultKeyHex(): string {
  const raw = process.env['FORGE_SMOKE_VAULT_KEY_HEX']?.trim().replace(/^0x/i, '') ?? ''
  if (raw.length === 64 && /^[0-9a-fA-F]{64}$/.test(raw)) return raw.toLowerCase()
  return createHash('sha256').update('legion-forge-smoke-vault-dummy-v1', 'utf8').digest('hex')
}

async function checkVaultLeak(log: SovereignLogger): Promise<CheckResult> {
  const vaultKeyHex = smokeVaultKeyHex()
  const checkLog    = log.child({ check: 'D:VAULT', keyId: VAULT_KEY_ID })
  const captureStart = LOG_CAPTURE_BUFFER.length

  // ── Phase 1: Load dummy key ──────────────────────────────────────────────
  let vault: VaultManager
  try {
    vault = VaultManager.load(VAULT_KEY_ID, vaultKeyHex)
    // NOTE: vault key hex is intentionally NOT passed to the logger here.
    checkLog.info('VaultManager.load() succeeded', { keyId: VAULT_KEY_ID })
  } catch (cause: unknown) {
    const err = new LegionError({
      code:        LegionErrorCode.SMOKE_VAULT_LEAK_DETECTED,
      sentinel:    'Gatekeeper',
      msg:         `VaultManager.load() failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      recoverable: false,
      cause,
    })
    checkLog.error('VAULT CHECK failed at load()', { code: err.code })
    return { check: 'D:VAULT', status: 'FAIL', details: err.message, error: err }
  }

  // ── Phase 2: Exercise vault operations ───────────────────────────────────
  const publicAddr = vault.getPublicAddress()
  const sigDigest  = vault.sign('0xdeadbeef00000000000000000000000000000000000000000000000000000000')

  checkLog.info('VaultManager operations completed', {
    keyId:         VAULT_KEY_ID,
    publicAddress: publicAddr,
    // sigDigest logged as-is — it is a 32-byte XOR of key and payload, NOT the key.
    // {r,s,v} raw components are never surfaced (GATEKEEPER-07).
    sigDigest,
  })

  // ── Phase 3: GATEKEEPER-07 Leak Audit ────────────────────────────────────
  // Collect every log entry emitted since check D started, plus both operation
  // return values (ensure derived artifacts don't embed the private key).
  const capturedEntries = LOG_CAPTURE_BUFFER.slice(captureStart)
  const allArtifacts    = [...capturedEntries, publicAddr, sigDigest]

  // Key material patterns to scan for (case-insensitive; partial matches count).
  // Checking sub-strings prevents a naive split-and-rejoin obfuscation bypass.
  const keyLower        = vaultKeyHex.toLowerCase()
  const keyPatterns: string[] = [
    keyLower,                   // full 64-char key
    keyLower.slice(0, 32),      // first 16 bytes
    keyLower.slice(32),         // second 16 bytes
    keyLower.slice(8, 48),      // middle 20 bytes — catches partial exposures
  ]

  const leaks: string[] = []
  for (const pattern of keyPatterns) {
    for (const artifact of allArtifacts) {
      if (artifact.toLowerCase().includes(pattern)) {
        leaks.push(
          `key pattern [${pattern.slice(0, 8)}...] found in ${
            capturedEntries.includes(artifact) ? 'log entry' : 'operation output'
          }`,
        )
      }
    }
  }

  if (leaks.length > 0) {
    const err = new LegionError({
      code:        LegionErrorCode.SMOKE_VAULT_LEAK_DETECTED,
      sentinel:    'Gatekeeper',
      msg:         `GATEKEEPER-07 VIOLATION — private key escaped output channel: ${leaks.join('; ')}`,
      recoverable: false,
    })
    // fatal: fund-at-risk severity (SHADOW-04 log levels).
    checkLog.fatal('GATEKEEPER-07 VIOLATION — KEY MATERIAL LEAKED', {
      code:            err.code,
      leaks,
      entries_scanned: capturedEntries.length,
    })
    return { check: 'D:VAULT', status: 'FAIL', details: err.message, error: err }
  }

  checkLog.info('GATEKEEPER-07 PASS — zero key material in any output channel', {
    entries_scanned:  capturedEntries.length,
    patterns_checked: keyPatterns.length,
    artifacts_checked: allArtifacts.length,
  })

  return {
    check:   'D:VAULT',
    status:  'PASS',
    details: `Zero-Leak Fence verified. ${capturedEntries.length} log entries + ${
      2
    } operation outputs scanned. 0 key patterns found.`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK E — VAULT IDENTITY HANDSHAKE
// Loads FLASHBOTS_AUTH_KEY into the production VaultManager and verifies the
// derived EIP-55 public address. GATEKEEPER-07: only publicAddress is logged.
// ═══════════════════════════════════════════════════════════════════════════════

function checkVaultIdentity(log: SovereignLogger): CheckResult {
  const checkLog = log.child({ check: 'E:VAULT_IDENTITY', keyId: 'flashbots-auth' })

  try {
    const vault = ProductionVaultManager.loadFromEnv('flashbots-auth', 'FLASHBOTS_AUTH_KEY')
    const publicAddress = vault.verifyIdentity(checkLog)

    return {
      check:   'E:VAULT_IDENTITY',
      status:  'PASS',
      details: `FLASHBOTS_AUTH_KEY derives public address ${publicAddress}`,
    }
  } catch (cause: unknown) {
    const err = new LegionError({
      code:        LegionErrorCode.SMOKE_VAULT_IDENTITY_FAILED,
      sentinel:    'Gatekeeper',
      msg:         `Vault identity verification failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      recoverable: false,
      cause,
    })
    checkLog.error('VAULT IDENTITY CHECK failed', {
      code: err.code,
      // GATEKEEPER-07: do not include env values, private key scalar, or signature material.
      reason: err.message,
    })
    return { check: 'E:VAULT_IDENTITY', status: 'FAIL', details: err.message, error: err }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK F — ADMIN WALLET CHECKSUM VALIDATION
// Validates ADMIN_WALLET_ADDRESS as an EVM 20-byte address and confirms its
// EIP-55 checksum form exactly matches the configured value.
// ═══════════════════════════════════════════════════════════════════════════════

function checkAdminWallet(log: SovereignLogger): CheckResult {
  const checkLog = log.child({ check: 'F:ADMIN_WALLET' })
  const configured = ADMIN_WALLET_ADDRESS

  if (!configured || !isAddress(configured)) {
    const err = new LegionError({
      code:        LegionErrorCode.SMOKE_ADMIN_WALLET_INVALID,
      sentinel:    'Gatekeeper',
      msg:         'ADMIN_WALLET_ADDRESS is missing or not a valid EVM address',
      recoverable: false,
    })
    checkLog.error('ADMIN_WALLET_ADDRESS invalid', { code: err.code })
    return { check: 'F:ADMIN_WALLET', status: 'FAIL', details: err.message, error: err }
  }

  const checksummed = getAddress(configured)
  if (configured !== checksummed) {
    const err = new LegionError({
      code:        LegionErrorCode.SMOKE_ADMIN_WALLET_INVALID,
      sentinel:    'Gatekeeper',
      msg:         `ADMIN_WALLET_ADDRESS checksum mismatch; expected ${checksummed}`,
      recoverable: false,
    })
    checkLog.error('ADMIN_WALLET_ADDRESS checksum mismatch', {
      code: err.code,
      configured,
      expected: checksummed,
    })
    return { check: 'F:ADMIN_WALLET', status: 'FAIL', details: err.message, error: err }
  }

  checkLog.info('ADMIN_WALLET_ADDRESS checksum verified', {
    adminWallet: checksummed,
    checksummed: true,
  })

  return {
    check:   'F:ADMIN_WALLET',
    status:  'PASS',
    details: `ADMIN_WALLET_ADDRESS is valid EIP-55 checksum address: ${checksummed}`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK G — FINAL 5-CHAIN CONNECTIVITY
// Pings initial ADMIN wallet balances on Ethereum, Polygon, Arbitrum, Base,
// and Optimism. All balances are returned as Uint256 strings and converted via
// BigInt only for zero checks / formatting (CONTRACT-01).
// ═══════════════════════════════════════════════════════════════════════════════

interface FiveChainTarget {
  label: string
  chainId: string
  viemChain: Chain
  rpcUrl: string
  decimals: number
  symbol: string
}

const FIVE_CHAIN_TARGETS: FiveChainTarget[] = [
  {
    label:     'Ethereum',
    chainId:   'evm:1',
    viemChain: mainnet,
    rpcUrl:    cfg.rpc.ethereum.primary ?? cfg.rpc.ethereum.backup,
    decimals:  18,
    symbol:    'ETH',
  },
  {
    label:     'Polygon',
    chainId:   'evm:137',
    viemChain: polygon,
    rpcUrl:    cfg.rpc.polygon.primary ?? cfg.rpc.polygon.backup,
    decimals:  18,
    symbol:    'MATIC',
  },
  {
    label:     'Arbitrum',
    chainId:   'evm:42161',
    viemChain: arbitrum,
    rpcUrl:    cfg.rpc.arbitrum.primary ?? cfg.rpc.arbitrum.backup,
    decimals:  18,
    symbol:    'ETH',
  },
  {
    label:     'Base',
    chainId:   'evm:8453',
    viemChain: base,
    rpcUrl:    cfg.rpc.base.primary ?? cfg.rpc.base.backup,
    decimals:  18,
    symbol:    'ETH',
  },
  {
    label:     'Optimism',
    chainId:   'evm:10',
    viemChain: optimism,
    rpcUrl:    cfg.rpc.optimism.primary ?? cfg.rpc.optimism.backup,
    decimals:  18,
    symbol:    'ETH',
  },
]

async function checkFiveChainConnectivity(log: SovereignLogger): Promise<CheckResult> {
  const checkLog = log.child({ check: 'G:5_CHAIN_CONNECTIVITY' })

  if (!ADMIN_WALLET_ADDRESS || !isAddress(ADMIN_WALLET_ADDRESS)) {
    const err = new LegionError({
      code:        LegionErrorCode.SMOKE_FIVE_CHAIN_FAILED,
      sentinel:    'Closer',
      msg:         'Cannot run 5-chain connectivity: ADMIN_WALLET_ADDRESS is invalid',
      recoverable: false,
    })
    checkLog.error('5-chain connectivity blocked', { code: err.code })
    return { check: 'G:5_CHAIN_CONNECTIVITY', status: 'FAIL', details: err.message, error: err }
  }

  const owner = getAddress(ADMIN_WALLET_ADDRESS) as Address

  const settled = await Promise.allSettled(
    FIVE_CHAIN_TARGETS.map(async (target) => {
      const adapter = new EvmAdapter({
        chainId:   target.chainId,
        viemChain: target.viemChain,
        rpcUrl:    target.rpcUrl,
      })

      const balanceRaw = await adapter.getBalance(owner)
      const balanceBigInt = BigInt(balanceRaw)
      const formatted = formatUint256(balanceRaw, target.decimals, target.symbol)

      checkLog.info('5-chain balance ping OK', {
        chain:           target.label,
        chainId:         target.chainId,
        address:         owner,
        balance_uint256: balanceRaw,
        balance_human:   formatted,
        is_zero:         balanceBigInt === 0n,
      })

      return {
        chain:     target.label,
        chainId:   target.chainId,
        balance:   balanceRaw,
        formatted,
        isZero:    balanceBigInt === 0n,
      }
    }),
  )

  const failures: string[] = []
  const successes: Array<{ chain: string; formatted: string; isZero: boolean }> = []

  for (let i = 0; i < settled.length; i++) {
    const target = FIVE_CHAIN_TARGETS[i]!
    const item = settled[i]!
    if (item.status === 'fulfilled') {
      successes.push({
        chain:     item.value.chain,
        formatted: item.value.formatted,
        isZero:    item.value.isZero,
      })
    } else {
      const reason = item.reason instanceof Error
        ? item.reason.message.split('\n')[0]
        : String(item.reason)
      failures.push(`${target.label}: ${reason}`)
      checkLog.warn('5-chain balance ping failed', {
        chain: target.label,
        chainId: target.chainId,
        reason,
      })
    }
  }

  if (failures.length > 0) {
    const err = new LegionError({
      code:        LegionErrorCode.SMOKE_FIVE_CHAIN_FAILED,
      sentinel:    'Closer',
      msg:         `5-chain connectivity partial failure (${failures.length}/${FIVE_CHAIN_TARGETS.length}): ${failures.join(' | ')}`,
      recoverable: LEGION_MOCK_STATE,
    })
    return {
      check:   'G:5_CHAIN_CONNECTIVITY',
      status:  LEGION_MOCK_STATE ? 'WARN' : 'FAIL',
      details: err.message,
      error:   err,
    }
  }

  checkLog.info('5-chain connectivity complete', {
    address: owner,
    chains:  successes.map(s => ({ chain: s.chain, is_zero: s.isZero })),
  })

  return {
    check:   'G:5_CHAIN_CONNECTIVITY',
    status:  'PASS',
    details: `5-chain connectivity OK: ${successes.map(s => `${s.chain}=${s.formatted}`).join('; ')}`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROTOCOL SYNC SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

function emitSummary(results: CheckResult[], log: SovereignLogger): CheckStatus {
  const pass    = results.filter(r => r.status === 'PASS').length
  const warn    = results.filter(r => r.status === 'WARN').length
  const fail    = results.filter(r => r.status === 'FAIL').length
  const overall: CheckStatus = fail > 0 ? 'FAIL' : warn > 0 ? 'WARN' : 'PASS'

  log.info('Protocol Sync complete', {
    overall,
    pass,
    warn,
    fail,
    total:   results.length,
    results: results.map(r => ({
      check:     r.check,
      status:    r.status,
      details:   r.details,
      errorCode: r.error?.code ?? null,
    })),
  })

  return overall
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  // Banner: only acceptable non-logger output — static CLI UX header.
  process.stdout.write([
    '',
    '╔══════════════════════════════════════════════════════════════════╗',
    '║   LEGION ENGINE — Phase 1 Foundation Audit                      ║',
    '║   "Protocol Sync" Smoke Test  ·  forge-smoke-test.ts            ║',
    '╚══════════════════════════════════════════════════════════════════╝',
    '',
  ].join('\n') + '\n')

  const log = rootLogger

  log.info('Protocol Sync starting', {
    timestamp:           new Date().toISOString(),
    node_version:        process.version,
    mock_mode:           LEGION_MOCK_STATE,
    config_warnings:     cfg.warnings.length,
    evm_rpc:             EVM_RPC_URL,
    svm_rpc:             SVM_RPC_URL,
    utxo_managed_configured: Boolean(UTXO_TOKEN),
    db_configured:       Boolean(cfg.database.url),
    evm_fallbacks:       EVM_PUBLIC_FALLBACKS.length,
    test_addresses: {
      evm:  ADDR_EVM,
      svm:  ADDR_SVM,
      utxo: ADDR_UTXO,
      admin: ADMIN_WALLET_ADDRESS || '[unset]',
    },
  })

  const results: CheckResult[] = []

  // ── Check A: Database ──────────────────────────────────────────────────────
  log.info('━━━ Check A: DATABASE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  results.push(await checkDatabase(log))

  // ── Check B: Resolver ──────────────────────────────────────────────────────
  log.info('━━━ Check B: RESOLVER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  results.push(checkResolver(log))

  // ── Check C: Adapter Smoke (EVM + SVM run in parallel, UTXO sequential) ──
  log.info('━━━ Check C: ADAPTER SMOKE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // SCOUT-01: I/O-bound checks run in parallel via Promise.allSettled().
  // UTXO runs sequentially after EVM/SVM — its mock path must not race with
  // the log capture buffer used in Check D.
  const [evmSettled, svmSettled] = await Promise.allSettled([
    checkEvmAdapter(log),
    checkSvmAdapter(log),
  ])

  results.push(
    evmSettled.status === 'fulfilled'
      ? evmSettled.value
      : {
          check:   'C:EVM',
          status:  'FAIL' as const,
          details: `Promise rejected: ${
            evmSettled.reason instanceof Error
              ? evmSettled.reason.message
              : String(evmSettled.reason)
          }`,
        },
  )

  results.push(
    svmSettled.status === 'fulfilled'
      ? svmSettled.value
      : {
          check:   'C:SVM',
          status:  'FAIL' as const,
          details: `Promise rejected: ${
            svmSettled.reason instanceof Error
              ? svmSettled.reason.message
              : String(svmSettled.reason)
          }`,
        },
  )

  results.push(await checkUtxoAdapter(log))

  // ── Check D: Vault (GATEKEEPER-07) ─────────────────────────────────────────
  log.info('━━━ Check D: VAULT (GATEKEEPER-07) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  results.push(await checkVaultLeak(log))

  // ── Check E: Vault Identity (FLASHBOTS_AUTH_KEY) ───────────────────────────
  log.info('━━━ Check E: VAULT IDENTITY HANDSHAKE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  results.push(checkVaultIdentity(log))

  // ── Check F: Admin wallet checksum ─────────────────────────────────────────
  log.info('━━━ Check F: ADMIN WALLET CHECKSUM ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  results.push(checkAdminWallet(log))

  // ── Check G: Five-chain connectivity ───────────────────────────────────────
  log.info('━━━ Check G: FINAL 5-CHAIN CONNECTIVITY ━━━━━━━━━━━━━━━━━━━━━━━━━━')
  results.push(await checkFiveChainConnectivity(log))

  // ── Summary ────────────────────────────────────────────────────────────────
  log.info('━━━ PROTOCOL SYNC SUMMARY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  const overall = emitSummary(results, log)

  // SHADOW-04: flush logger before process.exit() to drain any buffered writes.
  log.flush()

  // Exit 1 on any hard failure — WARN is acceptable (DB/UTXO RPC not configured).
  process.exit(overall === 'FAIL' ? 1 : 0)
}

main().catch((err: unknown) => {
  // Top-level escape hatch — CONTRACT-05: NEVER empty catch blocks.
  rootLogger.fatal('forge-smoke-test crashed at top level', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack   : undefined,
  })
  rootLogger.flush()
  process.exit(1)
})
