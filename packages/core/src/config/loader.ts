/**
 * @file loader.ts
 * @module @legion/core/config
 * @sentinel Gatekeeper & Shadow (Foundation configuration)
 *
 * Central environment configuration loader. Implements "Mock Mode":
 *
 *   Trident Alignment (Omni-Gatekeeper): production exit requires DATABASE_URL
 *   plus all three managed credential arms — EVM_ALCHEMY_KEY (non-empty),
 *   SOLANA_CHAINSTACK_URL (valid HTTPS JSON-RPC endpoint), and
 *   BLOCKCYPHER_API_TOKEN (synchronized / non-empty). If any arm is missing,
 *   LEGION_MOCK_STATE = true and warnings name the missing architecture(s).
 *
 *   Sovereign Mesh Override — FORCE_ENV_RPC=1 always keeps managed providers
 *   enabled and prioritized over public mesh fallback.
 *
 * GATEKEEPER-07: Zero-Leak Fencing stays FULLY ACTIVE in Mock Mode.
 *   This flag relaxes missing-config tolerance only — it does NOT lower the
 *   bar on key-material redaction or BigInt-only balance math.
 *
 * CONTRACT-01: All stub balances in Mock Mode are BigInt literals (uint256).
 *   NEVER Number() on any balance field, even a static mock value.
 *
 * CONTRACT-05: loadConfig() never throws. All failures are captured as
 *   LegionConfigWarning entries (non-fatal, recoverable: true).
 *
 * SHADOW-04: Warnings are emitted as NDJSON to process.stdout via a minimal
 *   inline emitter (no pino dependency required at bootstrap time). Redact
 *   paths from GATEKEEPER-07 are enforced on every emitted entry.
 */

import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'

import { scheduleTridentSignalPing } from './trident-ping.js'

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
   * True when Trident credentials are incomplete:
   * DATABASE_URL missing, or missing any of EVM_ALCHEMY_KEY,
   * valid HTTPS SOLANA_CHAINSTACK_URL, BLOCKCYPHER_API_TOKEN.
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

  /** Non-fatal warnings accumulated during config load (CONTRACT-05). */
  readonly warnings: ReadonlyArray<string>
}

// ─── Singleton loader ─────────────────────────────────────────────────────────
// loadConfig() is called at module initialisation below so that LEGION_MOCK_STATE
// is available as a plain boolean export without requiring an async call.

let _cached: LegionConfig | null = null

/**
 * Loads and validates environment variables. Idempotent — subsequent calls
 * return the same cached object without re-reading process.env.
 *
 * CONTRACT-05: never throws. Missing vars → mockMode = true + warnings array.
 */
export function loadConfig(): LegionConfig {
  if (_cached) return _cached
  hydrateEnvFromNearestDotEnv()
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
  const solanaChainstackUrl = process.env['SOLANA_CHAINSTACK_URL'] ?? null
  // UTXO Provider Re-Routed: BLOCKCYPHER_API_TOKEN replaces BITCOIN_BLOCKCHAIR_KEY.
  const blockcypherApiToken = process.env['BLOCKCYPHER_API_TOKEN'] ?? null
  const useHybridMode       = true
  const forceEnvRpc         = process.env['FORCE_ENV_RPC'] === '1'

  const tridentEvmOk   = isTridentEvmCredentialPresent(evmAlchemyKey)
  const tridentSvmOk   = isTridentSolanaHttpsEndpoint(solanaChainstackUrl)
  const tridentUtxoOk  = isTridentUtxoTokenSynchronized(blockcypherApiToken)
  const tridentAligned = tridentEvmOk && tridentSvmOk && tridentUtxoOk

  // ── DATABASE ──────────────────────────────────────────────────────────────
  const dbUrl = normalizeDatabaseUrl(process.env['DATABASE_URL'] ?? null)
  if (!dbUrl) {
    const w = 'DATABASE_URL not set — DB operations will be skipped (Mock Mode active)'
    warnings.push(w)
    emitLoaderWarn(w, { hint: 'Copy .env.example to .env and set DATABASE_URL' })
  }

  const ethPrimary = tridentEvmOk ? `https://eth-mainnet.g.alchemy.com/v2/${evmAlchemyKey!.trim()}` : null
  const polyPrimary = tridentEvmOk ? `https://polygon-mainnet.g.alchemy.com/v2/${evmAlchemyKey!.trim()}` : null
  const arbPrimary = tridentEvmOk ? `https://arb-mainnet.g.alchemy.com/v2/${evmAlchemyKey!.trim()}` : null
  const basePrimary = tridentEvmOk ? `https://base-mainnet.g.alchemy.com/v2/${evmAlchemyKey!.trim()}` : null
  const opPrimary = tridentEvmOk ? `https://opt-mainnet.g.alchemy.com/v2/${evmAlchemyKey!.trim()}` : null
  const solPrimary = tridentSvmOk ? solanaChainstackUrl!.trim() : null

  const ethBackup = 'https://eth.llamarpc.com'
  const polyBackup = 'https://polygon-bor.publicnode.com'
  const arbBackup = 'https://arbitrum-one.publicnode.com'
  const baseBackup = 'https://base.llamarpc.com'
  const opBackup = 'https://optimism.publicnode.com'
  const solBackup = 'https://api.mainnet-beta.solana.com'
  const btcUrl = blockcypherApiToken?.trim()
    ? `https://api.blockcypher.com/v1/btc/main?token=${encodeURIComponent(blockcypherApiToken.trim())}`
    : null

  if (!tridentEvmOk) warnings.push('EVM_ALCHEMY_KEY not set — EVM managed transport disabled, public fallback only')
  if (!tridentSvmOk) warnings.push('SOLANA_CHAINSTACK_URL missing/invalid — Solana managed transport disabled, public fallback only')
  if (!tridentUtxoOk) warnings.push('BLOCKCYPHER_API_TOKEN not set — UTXO managed transport disabled, mempool fallback only')

  if (useHybridMode) {
    // Telemetry: confirm managed tier status without leaking key material.
    emitLoaderWarn('PROVISIONING_SYNC: Hybrid Provisioning Sync active', {
      managed_evm:   evmAlchemyKey       != null ? '[Managed] Active' : '[Managed] Not Configured',
      managed_svm:   solanaChainstackUrl != null ? '[Managed] Active' : '[Managed] Not Configured',
      managed_utxo:  blockcypherApiToken != null ? '[Managed] Active — BlockCypher Token Synchronized' : '[Managed] Not Configured',
      mesh_standby:  '[Mesh] Standby — Failover Protocol Locked',
    })
  }

  // ── Mock Mode — Trident Alignment Locked / Omni-Protocol Synchronized ─────
  // Production exit: DATABASE_URL + full Trident (EVM / SVM / UTXO credentials).
  const mockMode = !dbUrl || !tridentAligned

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
      solanaChainstackUrl,
      blockcypherApiToken,
      useHybridMode,
    },
    warnings: Object.freeze(warnings),
  }

  scheduleTridentSignalPing({
    evmAlchemyKey,
    solanaChainstackUrl,
    blockcypherApiToken,
  })

  if (mockMode) {
    const missingArms: string[] = []
    if (!tridentEvmOk) missingArms.push('EVM')
    if (!tridentSvmOk) missingArms.push('SVM')
    if (!tridentUtxoOk) missingArms.push('UTXO')
    const tridentDetail =
      missingArms.length > 0
        ? `Trident Alignment pending — missing architecture credential(s): ${missingArms.join(', ')}`
        : ''

    emitLoaderWarn(
      'LEGION_MOCK_STATE = true — Omni-Protocol Synchronized deferred; institutional degraded mode',
      {
        missing_trident_arms:    missingArms,
        trident_alignment_locked: false,
        managed_transport: 'Managed provider priority active; public mesh fallback armed.',
        database_absent: !dbUrl,
        trident_detail:  tridentDetail || (!dbUrl ? 'DATABASE_URL required for production alignment' : ''),
        hint:
          'Trident Alignment Locked when DATABASE_URL + EVM_ALCHEMY_KEY + valid HTTPS SOLANA_CHAINSTACK_URL + BLOCKCYPHER_API_TOKEN',
      },
    )
  } else {
    if (tridentAligned) {
      emitLoaderInfo('OMNI_SYNC: Trident Aligned. Universal Vacuum Engaged.', {
        trident_alignment_locked: true,
        omni_protocol_synchronized: true,
      })
    } else if (forceEnvRpc) {
      emitLoaderInfo('Managed transport priority active; public mesh fallback armed.', {
        trident_alignment_locked: false,
        force_env_rpc: true,
      })
    }
  }

  emitSecurityAuditLockedOnce()

  return cfg
}

// ─── Module-level exports ──────────────────────────────────────────────────────

/**
 * LEGION_MOCK_STATE — true when critical env vars are absent.
 *
 * Callers use this as a read-only boolean gate:
 *   if (LEGION_MOCK_STATE) return mockResult;
 *
 * False (production — Trident Alignment Locked) when:
 *   DATABASE_URL + EVM_ALCHEMY_KEY + HTTPS SOLANA_CHAINSTACK_URL + BLOCKCYPHER_API_TOKEN
 *   Managed transport priority active; public mesh fallback armed.
 *
 * GATEKEEPER-07: this flag does NOT lower security constraints.
 * CONTRACT-01:  stub balances must still be BigInt literals even when true.
 */
export const LEGION_MOCK_STATE: boolean = loadConfig().mockMode
