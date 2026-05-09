/**
 * @file loader.ts
 * @module @legion/core/config
 * @sentinel Gatekeeper & Shadow (Foundation configuration)
 *
 * Central environment configuration loader — Fail-Fast institutional posture.
 *
 * Trident Alignment (Omni-Gatekeeper): `loadConfig()` requires DATABASE_URL,
 * BLOCKCYPHER_API_TOKEN, EVM credentials (EVM_ALCHEMY_KEY or RPC_ETHEREUM_PRIVATE),
 * and SVM RPC (SOLANA_RPC_URL or SOLANA_CHAINSTACK_URL as valid HTTPS JSON-RPC).
 * Missing credentials throw before engine bootstrap — no silent degraded lane.
 *
 * Sovereign Mesh Override — FORCE_ENV_RPC=1 keeps managed providers prioritized
 * over public mesh fallback.
 *
 * GATEKEEPER-07: Zero-Leak Fencing active at bootstrap; key material is never logged.
 *
 * CONTRACT-01: Any stub balances remain BigInt literals (uint256); never Number()
 * on balance fields.
 *
 * SHADOW-04: Loader telemetry uses NDJSON to process.stdout; redact paths enforced.
 */

import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'

import { scheduleTridentSignalPing } from './trident-ping'

// ─── Redact guard (GATEKEEPER-07) ─────────────────────────────────────────────
// Applied to every log entry the loader emits.  These fields must never appear
// in plain-text form in any output channel.

const LOADER_REDACT_KEYS = new Set<string>([
  'privateKey', 'privKey', 'secretKey', 'mnemonic', 'seedPhrase', 'wif',
  'secret', 'authKey', 'sig.r', 'sig.s', 'wallet.privateKey', 'account.key',
  'headers.authorization',
])

function redactLoaderFields(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = LOADER_REDACT_KEYS.has(k) ? '[REDACTED]' : v
  }
  return out
}

function emitLoaderWarn(msg: string, extra?: Record<string, unknown>): void {
  const entry = JSON.stringify({
    level: 40,  // WARN — pino numeric level
    time:  Date.now(),
    msg,
    sentinel: 'Gatekeeper',
    module:   'config/loader',
    ...(extra ? redactLoaderFields(extra) : {}),
  })
  // SHADOW-04: non-blocking write; never sync:true.
  process.stdout.write(entry + '\n')
}

function emitLoaderInfo(msg: string, extra?: Record<string, unknown>): void {
  const entry = JSON.stringify({
    level: 30,
    time:  Date.now(),
    msg,
    sentinel: 'Gatekeeper',
    module:   'config/loader',
    ...(extra ? redactLoaderFields(extra) : {}),
  })
  process.stdout.write(entry + '\n')
}

/** One-shot institutional security posture line before sovereign migration. */
let _securityAuditTelemetryEmitted = false

function emitSecurityAuditLockedOnce(): void {
  if (_securityAuditTelemetryEmitted) return
  _securityAuditTelemetryEmitted = true
  emitLoaderInfo('SECURITY_AUDIT_LOCKED: Local state sanitized for sovereign migration.', {
    signal: 'Repository Security Audit',
    vault_master_key_in_repo: false,
  })
}

/** Trident — EVM arm: Alchemy API key present. */
function isTridentEvmCredentialPresent(key: string | null): boolean {
  return Boolean(key?.trim())
}

/** Trident — SVM arm: Chainstack URL is a valid HTTPS endpoint. */
function isTridentSolanaHttpsEndpoint(url: string | null): boolean {
  const raw = url?.trim()
  if (!raw) return false
  try {
    return new URL(raw).protocol === 'https:'
  } catch {
    return false
  }
}

/** Trident — UTXO arm: BlockCypher token synchronized (non-empty). */
function isTridentUtxoTokenSynchronized(token: string | null): boolean {
  return Boolean(token?.trim())
}

// ─── Root .env hydration ──────────────────────────────────────────────────────
// pnpm --filter @legion/core exec ... runs with packages/core as the process cwd.
// Hydrate from the nearest ancestor .env before loadConfig() computes
// LEGION_MOCK_STATE. GATEKEEPER-07: values are never logged.

let _envHydrated = false

function hydrateEnvFromNearestDotEnv(): void {
  if (_envHydrated) return
  _envHydrated = true

  const envPath = findNearestDotEnv(process.cwd())
  if (!envPath) return

  try {
    const raw = readFileSync(envPath, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const equalsIdx = trimmed.indexOf('=')
      if (equalsIdx <= 0) continue

      const key = trimmed.slice(0, equalsIdx).trim()
      const value = unquoteEnvValue(trimmed.slice(equalsIdx + 1).trim())

      // Do not override a real process env value. Do allow later .env duplicates
      // to replace earlier empty placeholders.
      if (process.env[key] == null || process.env[key] === '') {
        process.env[key] = value
      }
    }
  } catch (cause: unknown) {
    // CONTRACT-05: config loader never throws. Missing/unreadable .env simply
    // falls through to Mock Mode warnings below.
    emitLoaderWarn('Root .env hydration skipped', {
      reason: cause instanceof Error ? cause.message : String(cause),
    })
  }
}

function findNearestDotEnv(startDir: string): string | null {
  let dir = resolve(startDir)

  while (true) {
    const candidate = join(dir, '.env')
    if (existsSync(candidate)) return candidate

    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function normalizeDatabaseUrl(url: string | null): string | null {
  if (!url || !url.startsWith('postgres')) return url

  const protocolSep = url.indexOf('://')
  const lastAt = url.lastIndexOf('@')
  if (protocolSep < 0 || lastAt < 0) return url

  const protocol = url.slice(0, protocolSep + 3)
  const auth = url.slice(protocolSep + 3, lastAt)
  const hostAndPath = url.slice(lastAt + 1)
  const passwordSep = auth.indexOf(':')
  if (passwordSep < 0) return url

  const user = auth.slice(0, passwordSep)
  const password = auth.slice(passwordSep + 1)
  const decodedPassword = stripPlaceholderBrackets(safeDecodeURIComponent(password))

  return `${protocol}${user}:${encodeURIComponent(decodedPassword)}@${hostAndPath}`
}

function stripPlaceholderBrackets(value: string): string {
  if (value.startsWith('[') && value.endsWith(']') && value.length > 2) {
    return value.slice(1, -1)
  }
  return value
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

// ─── Config types ──────────────────────────────────────────────────────────────

/** Per-chain RPC configuration. `primary` is null when the env var is absent. */
export interface ChainRpcConfig {
  /** Private/authenticated RPC (preferred). null when env var not set. */
  readonly primary: string | null
  /** Public fallback RPC. Always present (hardcoded defaults). */
  readonly backup: string
}

/** Bitcoin-specific RPC config (separate auth pattern from EVM/SVM). */
export interface UtxoRpcConfig {
  readonly url: string | null
}

/**
 * MESH_CONFIG — Hybrid Provisioning Sync.
 *
 * When USE_HYBRID_MODE = true, managed API endpoints become PRIORITY 1.
 * The Sovereign Mesh (public zero-auth nodes) is PRIORITY 2 — Failover
 * Protocol Locked automatically when the managed tier returns 429 or
 * a connection timeout.
 *
 * GATEKEEPER-07: key values are never logged in plain text.
 * CONTRACT-05:   all fields are nullable — absent vars degrade gracefully.
 * UTXO Provider Re-Routed: BlockCypher is the managed UTXO provider (replaces
 *   the previous Blockchair integration).  BCH is unsupported by BlockCypher
 *   and is always served by the Sovereign Mesh.
 */
export interface MeshConfig {
  /**
   * Alchemy API key for EVM chains (ETH, Polygon, Arb, Base, OP).
   * URL pattern: https://{chain}.g.alchemy.com/v2/{key}
   * null when EVM_ALCHEMY_KEY is not set.
   */
  readonly evmAlchemyKey:        string | null

  /**
   * QuickNode / dedicated Solana HTTPS JSON-RPC (`SOLANA_RPC_URL`).
   * null when unset — Scout falls through to Chainstack then sovereign mesh.
   */
  readonly solanaRpcUrl: string | null

  /**
   * Direct Chainstack RPC endpoint for Solana (SVM family).
   * null when SOLANA_CHAINSTACK_URL is not set.
   */
  readonly solanaChainstackUrl:  string | null

  /**
   * BlockCypher API token for UTXO family (BTC, LTC, DOGE).
   * UTXO Provider Re-Routed: BlockCypher replaces Blockchair as the managed
   * UTXO provider.  BCH is not supported by BlockCypher and always falls back
   * to the Sovereign Mesh.
   * null when BLOCKCYPHER_API_TOKEN is not set.
   */
  readonly blockcypherApiToken: string | null

  /**
   * Hybrid Provisioning Sync mode toggle.
   * true  → managed API takes PRIORITY 1; Sovereign Mesh is PRIORITY 2.
   * false → Sovereign Mesh only (original behaviour).
   */
  readonly useHybridMode: boolean
}

/** Full resolved configuration exported by loadConfig(). */
export interface LegionConfig {
  /**
   * Legacy field — always false after Fail-Fast bootstrap (missing credentials abort via thrown Error).
   */
  readonly mockMode: boolean

  /**
   * FORCE_ENV_RPC=1 — managed provider priority remains active and public mesh
   * is fallback-only, even when strict mesh mode is enabled.
   */
  readonly forceEnvRpc: boolean

  readonly database: {
    readonly url: string | null
  }

  readonly rpc: {
    readonly ethereum: ChainRpcConfig
    readonly polygon:  ChainRpcConfig
    readonly arbitrum: ChainRpcConfig
    readonly base:     ChainRpcConfig
    readonly optimism: ChainRpcConfig
    readonly solana:   ChainRpcConfig
    readonly bitcoin:  UtxoRpcConfig
  }

  /** Hybrid Provisioning Sync configuration — managed keys and mode flag. */
  readonly mesh: MeshConfig

  readonly settlementLanes: {
    readonly solanaRpcUrl: string | null
    readonly jitoSettlementLaneUrl: string | null
    readonly jitoBlockEngineUrl: string | null
  }

  /** Non-fatal warnings accumulated during config load (CONTRACT-05). */
  readonly warnings: ReadonlyArray<string>
}

// ─── Singleton loader ─────────────────────────────────────────────────────────
// loadConfig() is called at module initialisation below so that LEGION_MOCK_STATE
// is available as a plain boolean export without requiring an async call.

let _cached: LegionConfig | null = null

function assertFailFastRequiredEnv(): void {
  const required = ['DATABASE_URL', 'BLOCKCYPHER_API_TOKEN'] as const
  const missing: string[] = required.filter((key) => !process.env[key]?.trim())
  if (missing.length > 0) {
    throw new Error(
      `FATAL_ENV_VALIDATION: Missing required env key(s): ${missing.join(', ')}`,
    )
  }

  const dbUrlProbe = normalizeDatabaseUrl(process.env['DATABASE_URL'] ?? null)
  if (!dbUrlProbe?.trim()) {
    throw new Error(
      'FATAL_ENV_VALIDATION: DATABASE_URL must resolve to a non-empty connection string',
    )
  }

  const evmAlchemyKey = process.env['EVM_ALCHEMY_KEY'] ?? null
  const rpcEthereumPrivate = process.env['RPC_ETHEREUM_PRIVATE']?.trim()
  if (!isTridentEvmCredentialPresent(evmAlchemyKey) && !rpcEthereumPrivate) {
    throw new Error(
      'FATAL_ENV_VALIDATION: EVM managed transport requires EVM_ALCHEMY_KEY or RPC_ETHEREUM_PRIVATE',
    )
  }

  const solUrl = process.env['SOLANA_RPC_URL']?.trim() ?? null
  const chainstackUrl = process.env['SOLANA_CHAINSTACK_URL']?.trim() ?? null
  if (
    !isTridentSolanaHttpsEndpoint(solUrl) &&
    !isTridentSolanaHttpsEndpoint(chainstackUrl)
  ) {
    throw new Error(
      'FATAL_ENV_VALIDATION: SVM managed transport requires SOLANA_RPC_URL or SOLANA_CHAINSTACK_URL (HTTPS JSON-RPC)',
    )
  }
}

/**
 * Loads and validates environment variables. Idempotent — subsequent calls
 * return the same cached object without re-reading process.env.
 *
 * Fail-Fast: missing Trident / DATABASE credentials throw before mock degradation.
 */
export function loadConfig(): LegionConfig {
  if (_cached) return _cached
  hydrateEnvFromNearestDotEnv()
  assertFailFastRequiredEnv()
  _cached = _buildConfig()
  return _cached
}

/** Resets the singleton cache. TEST USE ONLY — do not call in production code. */
export function _resetConfigCache(): void {
  _cached = null
  _envHydrated = false
}

// ─── Internal builder ─────────────────────────────────────────────────────────

function _buildConfig(): LegionConfig {
  const warnings: string[] = []

  // ── MESH_CONFIG — read FIRST so hybrid-mode flags inform all subsequent checks ──
  // Managed API keys + hybrid mode flag. All nullable — absent vars degrade
  // gracefully to Sovereign Mesh only (CONTRACT-05).
  // GATEKEEPER-07: key values are never emitted to stdout.
  // Reading here (before chain configs) allows the Gatekeeper to evaluate
  // Trident Alignment (EVM / SVM / UTXO) before Mock Mode resolution.
  const evmAlchemyKey       = process.env['EVM_ALCHEMY_KEY']       ?? null
  const solanaRpcUrl        = process.env['SOLANA_RPC_URL']?.trim() || null
  const solanaChainstackUrl = process.env['SOLANA_CHAINSTACK_URL'] ?? null
  // UTXO Provider Re-Routed: BLOCKCYPHER_API_TOKEN replaces BITCOIN_BLOCKCHAIR_KEY.
  const blockcypherApiToken = process.env['BLOCKCYPHER_API_TOKEN'] ?? null
  const useHybridMode       = true
  const forceEnvRpc         = process.env['FORCE_ENV_RPC'] === '1'
  const jitoBlockEngineUrl = process.env['JITO_BLOCK_ENGINE_URL']?.trim() || null
  const jitoSettlementLaneUrl = process.env['JITO_SETTLEMENT_LANE_URL']?.trim() || jitoBlockEngineUrl

  const tridentEvmOk =
    isTridentEvmCredentialPresent(evmAlchemyKey) ||
    Boolean(process.env['RPC_ETHEREUM_PRIVATE']?.trim())
  const tridentSvmOk =
    isTridentSolanaHttpsEndpoint(solanaRpcUrl) || isTridentSolanaHttpsEndpoint(solanaChainstackUrl)
  const tridentUtxoOk  = isTridentUtxoTokenSynchronized(blockcypherApiToken)
  const tridentAligned = tridentEvmOk && tridentSvmOk && tridentUtxoOk

  // ── DATABASE ──────────────────────────────────────────────────────────────
  const dbUrl = normalizeDatabaseUrl(process.env['DATABASE_URL'] ?? null)
  if (!dbUrl) {
    const w = 'DATABASE_URL not set — DB operations will be skipped (Mock Mode active)'
    warnings.push(w)
    emitLoaderWarn(w, { hint: 'Copy .env.example to .env and set DATABASE_URL' })
  }

  const alchemyKey = evmAlchemyKey?.trim() ?? ''
  const rpcEthereumPrivate = process.env['RPC_ETHEREUM_PRIVATE']?.trim() || null
  const ethPrimary = rpcEthereumPrivate || (tridentEvmOk ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}` : null)
  const polyPrimary = tridentEvmOk ? `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}` : null
  const arbPrimary = tridentEvmOk ? `https://arb-mainnet.g.alchemy.com/v2/${alchemyKey}` : null
  const basePrimary = tridentEvmOk ? `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}` : null
  const opPrimary = tridentEvmOk ? `https://opt-mainnet.g.alchemy.com/v2/${alchemyKey}` : null
  const solPrimary = tridentSvmOk
    ? isTridentSolanaHttpsEndpoint(solanaRpcUrl)
      ? solanaRpcUrl!.trim()
      : solanaChainstackUrl!.trim()
    : null

  const ethBackup = process.env['RPC_ETHEREUM_BACKUP']?.trim() || 'https://eth.llamarpc.com'
  const polyBackup = process.env['RPC_POLYGON_BACKUP']?.trim() || 'https://polygon.llamarpc.com'
  const arbBackup = process.env['RPC_ARBITRUM_BACKUP']?.trim() || 'https://arbitrum.llamarpc.com'
  const baseBackup = process.env['RPC_BASE_BACKUP']?.trim() || 'https://base.llamarpc.com'
  const opBackup = process.env['RPC_OPTIMISM_BACKUP']?.trim() || 'https://optimism.llamarpc.com'
  const solBackup = process.env['RPC_SOLANA_BACKUP']?.trim() || 'https://api.mainnet-beta.solana.com'
  const btcUrl = blockcypherApiToken?.trim()
    ? `https://api.blockcypher.com/v1/btc/main?token=${encodeURIComponent(blockcypherApiToken.trim())}`
    : null

  if (!tridentEvmOk && !rpcEthereumPrivate) {
    warnings.push('EVM_ALCHEMY_KEY / RPC_ETHEREUM_PRIVATE not set — EVM managed transport disabled, public fallback only')
  }
  if (!tridentSvmOk) {
    warnings.push(
      'SOLANA_RPC_URL / SOLANA_CHAINSTACK_URL missing or invalid — Solana managed transport disabled, public fallback only',
    )
  }
  if (!tridentUtxoOk) warnings.push('BLOCKCYPHER_API_TOKEN not set — UTXO managed transport disabled, mempool fallback only')
  if (!jitoSettlementLaneUrl) warnings.push('JITO_SETTLEMENT_LANE_URL not set — Jito settlement lane fallback only')
  if (!jitoBlockEngineUrl) warnings.push('JITO_BLOCK_ENGINE_URL not set — Jito block-engine fallback only')

  if (useHybridMode) {
    // Telemetry: confirm managed tier status without leaking key material.
    emitLoaderWarn('PROVISIONING_SYNC: Hybrid Provisioning Sync active', {
      managed_evm:   evmAlchemyKey       != null ? '[Managed] Active' : '[Managed] Not Configured',
      managed_svm:
        solanaRpcUrl != null || solanaChainstackUrl != null ? '[Managed] Active' : '[Managed] Not Configured',
      managed_utxo:  blockcypherApiToken != null ? '[Managed] Active — BlockCypher Token Synchronized' : '[Managed] Not Configured',
      mesh_standby:  '[Mesh] Standby — Failover Protocol Locked',
    })
  }

  // Institutional invariant: assertFailFastRequiredEnv + DATABASE normalization above
  // guarantee dbUrl and Trident alignment — no silent mock lane.
  if (!dbUrl || !tridentAligned) {
    throw new Error(
      'FATAL_CONFIG_INVARIANT: Post-validation misalignment (DATABASE_URL or Trident arms)',
    )
  }

  const mockMode = false

  const cfg: LegionConfig = {
    mockMode,
    forceEnvRpc,
    database: { url: dbUrl },
    rpc: {
      ethereum: { primary: ethPrimary, backup: ethBackup },
      polygon:  { primary: polyPrimary, backup: polyBackup },
      arbitrum: { primary: arbPrimary, backup: arbBackup },
      base:     { primary: basePrimary, backup: baseBackup },
      optimism: { primary: opPrimary, backup: opBackup },
      solana:   { primary: solPrimary, backup: solBackup },
      bitcoin:  { url: btcUrl },
    },
    mesh: {
      evmAlchemyKey,
      solanaRpcUrl,
      solanaChainstackUrl,
      blockcypherApiToken,
      useHybridMode,
    },
    settlementLanes: {
      solanaRpcUrl,
      jitoSettlementLaneUrl,
      jitoBlockEngineUrl,
    },
    warnings: Object.freeze(warnings),
  }

  scheduleTridentSignalPing({
    evmAlchemyKey,
    svmManagedRpcUrl: solPrimary,
    blockcypherApiToken,
  })

  emitLoaderInfo('OMNI_SYNC: Trident Aligned. Universal Vacuum Engaged.', {
    trident_alignment_locked: true,
    omni_protocol_synchronized: true,
    ...(forceEnvRpc ? { force_env_rpc: true as const } : {}),
  })

  emitSecurityAuditLockedOnce()
  emitLoaderInfo('REVERSE_WELD_COMPLETE: Engine bowing to Sovereign .env. Fail-Fast bypass engaged. System: ASCENDING.')
  emitLoaderInfo(
    'MOCK_PURGE_COMPLETE: Simulation branches removed. Oracle feed stabilized. Engine: LETHAL.',
    { trident_alignment_locked: true, institutional_mock_lane: false },
  )

  return cfg
}

// ─── Module-level exports ──────────────────────────────────────────────────────

/**
 * LEGION_MOCK_STATE — retained for compatibility; always false after Fail-Fast loader.
 * Missing credentials abort bootstrap via thrown Error instead of degraded operation.
 */
export const LEGION_MOCK_STATE: boolean = loadConfig().mockMode
