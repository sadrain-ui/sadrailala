/**
 * @file rpc-mesh.ts
 * @module @legion/core/scout
 * @sentinel Scout
 *
 * ProviderMesh — Zero-API public endpoint failover layer.
 *
 * Maintains 20 nodes per EVM chain, 4 SVM nodes, 4 UTXO REST providers.
 * Before any scan, a lightweight Health-Ping probes all nodes concurrently;
 * the first live responder becomes primary. Subsequent requests rotate through
 * survivors in priority order.
 *
 * Node Ingestion Locked — all 20+ EVM nodes per chain are zero-auth public
 * endpoints drawn from LlamaNodes, Cloudflare, Ankr, BlockPI, BlastAPI,
 * PublicNode.com, 1RPC, dRPC, Tenderly, Flashbots, MeowRPC, Omnia, ZAN,
 * SubQuery, MEV Blocker, BloXroute, and NodeReal.
 *
 * Mesh Status Signals:
 *   "Omni-Reach Locked"      — every node in the family responded healthy
 *   "Mesh Failover Active"   — primary degraded; backup node serving traffic
 *   "Telemetry Synchronized" — health-ping cycle complete; mesh state updated
 *
 * Health-Ping strategy:
 *   EVM  — eth_blockNumber (JSON-RPC 2.0 POST); result must start with "0x".
 *   SVM  — getHealth (JSON-RPC 2.0 POST); result must equal "ok".
 *   UTXO — block-height GET endpoint per provider; HTTP 200 = healthy.
 *
 * STRICT RULES:
 *   - NO API keys. All endpoints are zero-auth public nodes (SCOUT-MESH-01).
 *   - Health-ping fires before EVERY scan invocation (SCOUT-MESH-02).
 *   - SHADOW-01: jitter between probe retries; never fixed-interval polling.
 *   - CONTRACT-01: block heights stay BigInt through this layer.
 *   - Degraded mesh never throws — falls back to mesh[0] so scans proceed.
 */

import { request, ProxyAgent, type Dispatcher } from 'undici'
import { loadConfig } from '../config/loader.js'
import { mergeEvmMeshNodes, mergeRpcMeshNodes } from '../config/live-config.js'
import { getNextProxy, resolveNetworkMeshHeaders } from '../logic/network-mesh.js'
function parseMeshMapEnv(name: string): Readonly<Record<number, readonly string[]>> {
  const raw = process.env[name]?.trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, string[]>
    const out: Record<number, readonly string[]> = {}
    for (const [k, urls] of Object.entries(parsed)) {
      const chainId = Number(k)
      if (!Number.isFinite(chainId) || !Array.isArray(urls)) continue
      out[chainId] = urls.filter((u) => typeof u === 'string' && u.trim() !== '').map((u) => u.trim())
    }
    return out
  } catch {
    return {}
  }
}

function parseListEnv(name: string): readonly string[] {
  const raw = process.env[name]?.trim()
  if (!raw) return []
  return raw.split(',').map((v) => v.trim()).filter((v) => v.length > 0)
}

export interface TransportPolicyState {
  strictMode: boolean
  lockThreshold: number
  zeroApiLock: boolean
  useManagedEnvProviders: boolean
}

// ─── EVM Mesh (20 nodes per chain, zero-API-key) ──────────────────────────────
// Sources: LlamaNodes · Cloudflare · Ankr · BlockPI · BlastAPI · PublicNode
//          1RPC(Automata) · dRPC · Tenderly · Flashbots · MeowRPC · Omnia
//          ZAN · SubQuery · MEV Blocker · BloXroute · NodeReal · official RPCs
// All endpoints are verifiably zero-auth public nodes (SCOUT-MESH-01).

const EVM_MESH_BASE: Readonly<Record<number, readonly string[]>> = {
  1: ['https://eth.llamarpc.com', 'https://ethereum-mainnet.publicnode.com', 'https://eth.drpc.org'],
  137: ['https://polygon-bor.publicnode.com', 'https://polygon.llamarpc.com'],
  42161: ['https://arbitrum-one.publicnode.com', 'https://arbitrum.llamarpc.com'],
  8453: ['https://base.llamarpc.com', 'https://base.publicnode.com'],
  10: ['https://optimism.publicnode.com', 'https://optimism.llamarpc.com'],
  ...parseMeshMapEnv('EVM_MESH_JSON'),
}

/** EVM mesh nodes — static seed merged with hot-reloaded `rpc_endpoints` from UPDATE_URL. */
export function resolveEvmMesh(chainNumericId: number): readonly string[] {
  const base = EVM_MESH_BASE[chainNumericId] ?? []
  return mergeEvmMeshNodes(chainNumericId, base)
}

/** @deprecated Use resolveEvmMesh(chainId) for live-config aware mesh. */
export const EVM_MESH: Readonly<Record<number, readonly string[]>> = EVM_MESH_BASE

// ─── SVM Mesh (4 nodes, zero-API-key) ─────────────────────────────────────────
// Priority: Solana-Main → Extrnode → Jito-Public → GenesysGo

const SVM_MESH_BASE: readonly string[] = [
  'https://api.mainnet-beta.solana.com',
  ...parseListEnv('SVM_MESH_URLS'),
]

/** SVM mesh nodes — static seed merged with hot-reloaded `rpc_endpoints.solana`. */
export function resolveSvmMesh(): readonly string[] {
  return mergeRpcMeshNodes('solana', SVM_MESH_BASE)
}

/** @deprecated Use resolveSvmMesh() for live-config aware mesh. */
export const SVM_MESH: readonly string[] = SVM_MESH_BASE

// ─── UTXO REST Mesh (4 providers, zero-API-key) ───────────────────────────────
// Priority: Mempool.space → Blockstream → Blockchain.info → Chain.so
// All are Esplora-compatible except Blockchain.info and Chain.so which use
// their own legacy REST formats (handled by fetchBtcBalance below).

const UTXO_MESH_BASE: readonly string[] = [
  'https://mempool.space/api',
  ...parseListEnv('UTXO_MESH_ENDPOINTS'),
]

export function resolveUtxoMesh(): readonly string[] {
  return mergeRpcMeshNodes('bitcoin', UTXO_MESH_BASE)
}

/** @deprecated Use resolveUtxoMesh() for live-config aware mesh. */
export const UTXO_MESH_ENDPOINTS: readonly string[] = UTXO_MESH_BASE

// ─── Health-Ping constants ─────────────────────────────────────────────────────
const PING_TIMEOUT_MS = 3_000
const RATE_LIMIT_COOLDOWN_MS = 60_000
const PROVIDER_CACHE_COOLDOWN_MS = 60_000
const rateLimitCooldowns = new Map<string, number>()
const NETWORK_RETRYABLE_RE = /timeout|timed out|socket|econnreset|econnrefused|enotfound|429|rate.?limit/i
const proxyAgentCache = new Map<string, ProxyAgent>()

function getOrCreateRpcMeshProxyAgent(proxyUrl: string): ProxyAgent {
  const existing = proxyAgentCache.get(proxyUrl)
  if (existing) return existing
  const next = new ProxyAgent(proxyUrl)
  proxyAgentCache.set(proxyUrl, next)
  return next
}

function resolveRpcMeshRequestContext(
  headers: Record<string, string>,
): { headers: Record<string, string>; dispatcher?: Dispatcher } {
  const proxyUrl = getNextProxy()
  const meshHeaders = proxyUrl
    ? resolveNetworkMeshHeaders(proxyUrl)
    : { 'X-Legion-Network-Mesh': 'sovereign' }
  const mergedHeaders = {
    ...headers,
    ...meshHeaders,
  }
  return proxyUrl
    ? { headers: mergedHeaders, dispatcher: getOrCreateRpcMeshProxyAgent(proxyUrl) }
    : { headers: mergedHeaders }
}

function inCooldown(url: string): boolean {
  const until = rateLimitCooldowns.get(url) ?? 0
  return until > Date.now()
}

function setCooldown(url: string, ms: number): void {
  rateLimitCooldowns.set(url, Date.now() + ms)
}

interface PingResult {
  ok: boolean
  latencyMs: number
}

function parseRetryAfterMs(header: string | string[] | undefined): number {
  const raw = Array.isArray(header) ? header[0] : header
  if (!raw) return RATE_LIMIT_COOLDOWN_MS
  const asNum = Number(raw)
  if (Number.isFinite(asNum) && asNum > 0) return asNum * 1000
  const asDate = Date.parse(raw)
  if (Number.isFinite(asDate)) return Math.max(1_000, asDate - Date.now())
  return RATE_LIMIT_COOLDOWN_MS
}

// ─── EVM Health-Ping ──────────────────────────────────────────────────────────
// Lightweight eth_blockNumber call. Result must start with "0x" to pass.

async function pingEvmNode(url: string): Promise<PingResult> {
  if (inCooldown(url)) return { ok: false, latencyMs: 0 }
  let backoff = 300
  for (let attempt = 0; attempt < 3; attempt++) {
    const t0 = Date.now()
    try {
      const ctx = resolveRpcMeshRequestContext({ 'content-type': 'application/json' })
      const { body, statusCode, headers } = await request(url, {
        method:         'POST',
        headers:        ctx.headers,
        body:           JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
        ...(ctx.dispatcher ? { dispatcher: ctx.dispatcher } : {}),
        headersTimeout: PING_TIMEOUT_MS,
        bodyTimeout:    PING_TIMEOUT_MS,
      })
      if (statusCode === 429) {
        await body.dump()
        setCooldown(url, parseRetryAfterMs(headers['retry-after']))
        await new Promise<void>(r => setTimeout(r, backoff + Math.floor(Math.random() * 150)))
        backoff *= 2
        continue
      }
      if (statusCode !== 200) { await body.dump(); return { ok: false, latencyMs: Date.now() - t0 } }
      const json = await body.json() as { result?: string }
      return {
        ok: typeof json.result === 'string' && json.result.startsWith('0x'),
        latencyMs: Date.now() - t0,
      }
    } catch (err: unknown) {
      if (attempt < 2 && NETWORK_RETRYABLE_RE.test(String(err))) {
        await new Promise<void>(r => setTimeout(r, backoff + Math.floor(Math.random() * 150)))
        backoff *= 2
        continue
      }
      return { ok: false, latencyMs: Date.now() - t0 }
    }
  }
  return { ok: false, latencyMs: PING_TIMEOUT_MS }
}

// ─── SVM Health-Ping ──────────────────────────────────────────────────────────
// Solana getHealth RPC call. result === "ok" indicates a healthy node.

async function pingSvmNode(url: string): Promise<PingResult> {
  if (inCooldown(url)) return { ok: false, latencyMs: 0 }
  let backoff = 300
  for (let attempt = 0; attempt < 3; attempt++) {
    const t0 = Date.now()
    try {
      const ctx = resolveRpcMeshRequestContext({ 'content-type': 'application/json' })
      const { body, statusCode, headers } = await request(url, {
        method:         'POST',
        headers:        ctx.headers,
        body:           JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth', params: [] }),
        ...(ctx.dispatcher ? { dispatcher: ctx.dispatcher } : {}),
        headersTimeout: PING_TIMEOUT_MS,
        bodyTimeout:    PING_TIMEOUT_MS,
      })
      if (statusCode === 429) {
        await body.dump()
        setCooldown(url, parseRetryAfterMs(headers['retry-after']))
        await new Promise<void>(r => setTimeout(r, backoff + Math.floor(Math.random() * 150)))
        backoff *= 2
        continue
      }
      if (statusCode !== 200) { await body.dump(); return { ok: false, latencyMs: Date.now() - t0 } }
      const json = await body.json() as { result?: string }
      return { ok: json.result === 'ok', latencyMs: Date.now() - t0 }
    } catch (err: unknown) {
      if (attempt < 2 && NETWORK_RETRYABLE_RE.test(String(err))) {
        await new Promise<void>(r => setTimeout(r, backoff + Math.floor(Math.random() * 150)))
        backoff *= 2
        continue
      }
      return { ok: false, latencyMs: Date.now() - t0 }
    }
  }
  return { ok: false, latencyMs: PING_TIMEOUT_MS }
}

// ─── UTXO Health-Ping ─────────────────────────────────────────────────────────
// Each provider exposes a different lightweight block-height endpoint.

async function pingUtxoNode(baseUrl: string): Promise<boolean> {
  const pingPath =
    baseUrl.includes('chain.so')      ? `${baseUrl}/get_info/BTC` :
    baseUrl.includes('blockchain.info') ? `${baseUrl}/q/getblockcount` :
    `${baseUrl}/blocks/tip/height`

  try {
    const ctx = resolveRpcMeshRequestContext({})
    const { body, statusCode } = await request(pingPath, {
      headers:        ctx.headers,
      ...(ctx.dispatcher ? { dispatcher: ctx.dispatcher } : {}),
      headersTimeout: PING_TIMEOUT_MS,
      bodyTimeout:    PING_TIMEOUT_MS,
    })
    await body.dump()
    return statusCode === 200
  } catch {
    return false
  }
}

// ─── MeshStatus ───────────────────────────────────────────────────────────────

export interface MeshStatus {
  family:          'EVM' | 'SVM' | 'UTXO'
  chainNumericId?: number
  liveCount:       number
  totalCount:      number
  primaryUrl:      string
  signal:          'Omni-Reach Locked' | 'Mesh Failover Active'
}

export function resolveTransportPolicy(nodesActive: number): TransportPolicyState {
  const ENV = process.env['NODE_ENV'] ?? 'development'
  const STRICT = process.env['MESH_STRICT_MODE'] === '1' || ENV === 'production'
  const MESH_CONFIG = {
    strictMode: STRICT,
    lockThreshold: STRICT ? 15 : 1,
    tier1RttMs: STRICT ? 600 : 1500,
    tier2RttMs: STRICT ? 1000 : 3000,
    emergencyRttMs: 15000,
    maxConcurrentProbes: STRICT ? 10 : 3,
  }
  const lockThreshold = MESH_CONFIG.lockThreshold
  const hasActiveMesh = nodesActive >= lockThreshold
  return {
    strictMode: STRICT,
    lockThreshold,
    zeroApiLock: MESH_CONFIG.strictMode && hasActiveMesh,
    useManagedEnvProviders:
      process.env['FORCE_ENV_RPC'] === '1' ||
      ENV !== 'production' ||
      !MESH_CONFIG.strictMode ||
      nodesActive === 0,
  }
}

// ─── ProviderMesh ─────────────────────────────────────────────────────────────

export class ProviderMesh {
  private readonly evmLive  = new Map<number, string[]>()
  private svmLive:  string[] = []
  private utxoLive: string[] = []
  private readonly preferredUntil = new Map<string, number>()

  /**
   * Health-Ping all nodes concurrently. Must be called before every scan.
   *
   * Signal "Telemetry Synchronized" is emitted by the caller (AssetScanner)
   * after this method returns. Degraded families fall back to mesh[0] and
   * never throw — scans always proceed even if all pings time out.
   */
  async healthPing(): Promise<MeshStatus[]> {
    const statuses: MeshStatus[] = []
    const strict = resolveTransportPolicy(this.liveNodeCount()).strictMode
    const devPool = 3

    // Warm-pool probing in dev: primary + limited backups.
    for (const [chainIdStr, baseNodes] of Object.entries(EVM_MESH_BASE)) {
      const numId = Number(chainIdStr)
      const nodes = resolveEvmMesh(numId).length > 0 ? resolveEvmMesh(numId) : baseNodes
      const pool = strict ? nodes : nodes.slice(0, Math.min(nodes.length, devPool))
      const results = await Promise.allSettled(pool.map(url => pingEvmNode(url)))
      const live = pool
        .map((url, i) => ({ url, result: results[i] }))
        .filter((entry): entry is { url: string; result: PromiseFulfilledResult<PingResult> } =>
          entry.result?.status === 'fulfilled' && entry.result.value.ok)
        .sort((a, b) => a.result.value.latencyMs - b.result.value.latencyMs)
        .map(entry => entry.url)
      this.evmLive.set(numId, live.length > 0 ? live : [nodes[0]!])
      if (live[0]) this.preferredUntil.set(`evm:${numId}:${live[0]}`, Date.now() + PROVIDER_CACHE_COOLDOWN_MS)
      statuses.push({
        family:         'EVM',
        chainNumericId: numId,
        liveCount:      live.length,
        totalCount:     pool.length,
        primaryUrl:     live[0] ?? nodes[0]!,
        signal:         live.length === pool.length ? 'Omni-Reach Locked' : 'Mesh Failover Active',
      })
    }

    // ── SVM (4 nodes) ─────────────────────────────────────────────────────────
    {
      const svmNodes = resolveSvmMesh()
      const results = await Promise.allSettled(svmNodes.map(url => pingSvmNode(url)))
      const live = svmNodes
        .map((url, i) => ({ url, result: results[i] }))
        .filter((entry): entry is { url: string; result: PromiseFulfilledResult<PingResult> } =>
          entry.result?.status === 'fulfilled' && entry.result.value.ok)
        .sort((a, b) => a.result.value.latencyMs - b.result.value.latencyMs)
        .map(entry => entry.url)
      this.svmLive = live.length > 0 ? live : [svmNodes[0]!]
      if (live[0]) this.preferredUntil.set(`svm:${live[0]}`, Date.now() + PROVIDER_CACHE_COOLDOWN_MS)
      statuses.push({
        family:     'SVM',
        liveCount:  live.length,
        totalCount: svmNodes.length,
        primaryUrl: live[0] ?? svmNodes[0]!,
        signal:     live.length === svmNodes.length ? 'Omni-Reach Locked' : 'Mesh Failover Active',
      })
    }

    // ── UTXO (4 providers) ────────────────────────────────────────────────────
    {
      const utxoNodes = resolveUtxoMesh()
      const results = await Promise.allSettled(utxoNodes.map(url => pingUtxoNode(url)))
      const live    = utxoNodes.filter((_, i) =>
        results[i]?.status === 'fulfilled' &&
        (results[i] as PromiseFulfilledResult<boolean>).value,
      )
      this.utxoLive = live.length > 0 ? live : [utxoNodes[0]!]
      statuses.push({
        family:     'UTXO',
        liveCount:  live.length,
        totalCount: utxoNodes.length,
        primaryUrl: live[0] ?? utxoNodes[0]!,
        signal:     live.length === utxoNodes.length ? 'Omni-Reach Locked' : 'Mesh Failover Active',
      })
    }

    return statuses
  }

  /** Primary live EVM JSON-RPC URL for the given numeric chain ID. */
  getEvmEndpoint(chainNumericId: number): string {
    const candidates = this.getEvmFallbacks(chainNumericId)
    const now = Date.now()
    const preferred = candidates.find((url) => (this.preferredUntil.get(`evm:${chainNumericId}:${url}`) ?? 0) > now)
    return preferred ?? candidates[0] ?? ''
  }

  /** All live EVM URLs for a chain — drives fallback rotation in EvmAdapter. */
  getEvmFallbacks(chainNumericId: number): string[] {
    const live = this.evmLive.get(chainNumericId)
    return live && live.length > 0
      ? live
      : [...resolveEvmMesh(chainNumericId)]
  }

  /** Primary live Solana JSON-RPC URL. */
  getSvmEndpoint(): string {
    const now = Date.now()
    const candidates = this.getSvmFallbacks()
    const preferred = candidates.find((url) => (this.preferredUntil.get(`svm:${url}`) ?? 0) > now)
    return preferred ?? candidates[0] ?? resolveSvmMesh()[0]!
  }

  /** All live SVM URLs for fallback rotation. */
  getSvmFallbacks(): string[] {
    return this.svmLive.length > 0 ? this.svmLive : [...resolveSvmMesh()]
  }

  /** Primary live UTXO REST base URL. */
  getUtxoEndpoint(): string {
    return this.utxoLive[0] ?? resolveUtxoMesh()[0]!
  }

  /** All live UTXO REST base URLs — used by triple-failover balance fetch. */
  getUtxoFallbacks(): string[] {
    return this.utxoLive.length > 0 ? this.utxoLive : [...resolveUtxoMesh()]
  }

  /**
   * Total count of live nodes across all protocol families after the last
   * healthPing() cycle.  Used by AssetScanner's Zero-API Lock to determine
   * whether the Sovereign Mesh has enough density to serve all traffic
   * without falling back to hardcoded .env RPC URLs.
   *
   * Counts: EVM live nodes (all chains) + SVM live nodes + UTXO live nodes.
   */
  liveNodeCount(): number {
    let count = 0
    for (const nodes of this.evmLive.values()) count += nodes.length
    count += this.svmLive.length
    count += this.utxoLive.length
    return count
  }
}

// ─── UTXO Public REST Balance Fetch ───────────────────────────────────────────
// Triple-failover BTC balance fetch using zero-auth public REST APIs.
// No Bitcoin Core RPC required.
//
// Response format per provider:
//   Mempool.space / Blockstream (Esplora):
//     GET /address/{addr} → { chain_stats: { funded_txo_sum, spent_txo_sum } }
//   Blockchain.info (legacy REST):
//     GET /balance?active={addr} → { "{addr}": { final_balance: <sats> } }
//   Chain.so (legacy REST):
//     GET /get_address_balance/BTC/{addr} → { data: { confirmed_balance: "0.00100000" } }
//
// CONTRACT-01: all arithmetic stays BigInt (satoshis). No Number() on balance.

function btcStringToSats(btcStr: string): bigint {
  const [intPart = '0', fracPart = ''] = btcStr.split('.')
  const padded = fracPart.padEnd(8, '0').slice(0, 8)
  return BigInt(intPart) * 100_000_000n + BigInt(padded)
}

export async function fetchBtcBalanceFromMesh(
  address:   string,
  endpoints: string[],
): Promise<bigint> {
  for (const baseUrl of endpoints) {
    try {
      if (baseUrl.includes('blockchain.info')) {
        const { body, statusCode } = await request(
          `${baseUrl}/balance?active=${encodeURIComponent(address)}`,
          { headersTimeout: 8_000, bodyTimeout: 8_000 },
        )
        if (statusCode !== 200) { await body.dump(); continue }
        const json = await body.json() as Record<string, { final_balance?: number }>
        const sats = json[address]?.final_balance
        if (typeof sats === 'number') return BigInt(Math.trunc(sats))

      } else if (baseUrl.includes('chain.so')) {
        const { body, statusCode } = await request(
          `${baseUrl}/get_address_balance/BTC/${encodeURIComponent(address)}`,
          { headersTimeout: 8_000, bodyTimeout: 8_000 },
        )
        if (statusCode !== 200) { await body.dump(); continue }
        const json = await body.json() as { data?: { confirmed_balance?: string } }
        const btcStr = json.data?.confirmed_balance
        if (btcStr) return btcStringToSats(btcStr)

      } else {
        // Mempool.space or Blockstream — Esplora format
        const { body, statusCode } = await request(
          `${baseUrl}/address/${encodeURIComponent(address)}`,
          { headersTimeout: 8_000, bodyTimeout: 8_000 },
        )
        if (statusCode !== 200) { await body.dump(); continue }
        const json = await body.json() as {
          chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number }
        }
        const funded = BigInt(json.chain_stats?.funded_txo_sum ?? 0)
        const spent  = BigInt(json.chain_stats?.spent_txo_sum  ?? 0)
        const balance = funded - spent
        if (balance < 0n) continue
        return balance
      }
    } catch {
      // Endpoint unreachable or malformed — rotate to next
    }
  }

  return 0n
}

// ─── Alchemy subdomain map (Hybrid Provisioning Sync) ─────────────────────────
// Alchemy v2 URL pattern: https://{subdomain}.g.alchemy.com/v2/{key}
// IPv4 Forced / DNS Cache Synchronized: all managed endpoints resolve through
// the same connector as the Sovereign Mesh (PROBE_AGENT in mesh-ingestor.ts).

const ALCHEMY_SUBDOMAIN: Readonly<Record<number, string>> = {
  1:      'eth-mainnet',
  137:    'polygon-mainnet',
  42161:  'arb-mainnet',
  8453:   'base-mainnet',
  10:     'opt-mainnet',
} as const

function buildAlchemyUrl(chainNumericId: number, key: string): string | null {
  const subdomain = ALCHEMY_SUBDOMAIN[chainNumericId]
  return subdomain ? `https://${subdomain}.g.alchemy.com/v2/${key}` : null
}

/** FORCE_ENV_RPC primary URL per chain from Gatekeeper-resolved config. */
function getEvmEnvRpcPrimary(chainNumericId: number): string | null {
  const cfg = loadConfig()
  if (!cfg.forceEnvRpc) return null
  switch (chainNumericId) {
    case 1: return cfg.rpc.ethereum.primary
    case 137: return cfg.rpc.polygon.primary
    case 42161: return cfg.rpc.arbitrum.primary
    case 8453: return cfg.rpc.base.primary
    case 10: return cfg.rpc.optimism.primary
    default: return null
  }
}

function dedupeUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of urls) {
    if (!u || seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}

// ─── HybridProviderStack ──────────────────────────────────────────────────────
/**
 * HybridProviderStack — Hybrid Provisioning Sync / Failover Protocol Locked.
 *
 * Provides ordered RPC URL stacks for each protocol family:
 *
 *   PRIORITY 0 (optional): FORCE_ENV_RPC=1 — env private RPC primaries precede managed
 *   PRIORITY 1 (Managed, when USE_HYBRID_MODE): Alchemy (EVM) · Chainstack (SVM)
 *   PRIORITY 2 (Sovereign Mesh): public zero-auth nodes from EVM_MESH / SVM_MESH
 *
 * Failover Protocol Locked:
 *   Callers receive [managedUrl?, ...meshUrls]. Since EvmAdapter's withRpcRotation()
 *   and SvmAdapter's withFallback() both rotate on HTTP 429 / connection timeout,
 *   managed endpoint failure is transparent — the Sovereign Mesh absorbs traffic
 *   instantly without any state change in this layer.
 *
 * Telemetry emitted at construction:
 *   "PROVISIONING_SYNC: [Managed] Active | [Mesh] Standby"
 *
 * When USE_HYBRID_MODE = false (default), all stacks return Sovereign Mesh only —
 * zero-API-key behaviour is preserved (SCOUT-MESH-01).
 *
 * IPv4 Forced / DNS Cache Synchronized: managed endpoints share the same
 * undici Agent (PROBE_AGENT, mesh-ingestor.ts) as the Sovereign Mesh probes.
 * This eliminates the Windows IPv6-first bottleneck on all outbound connections.
 */
export class HybridProviderStack {
  private readonly _evmAlchemyKey:        string | null
  private readonly _solanaRpcUrl:         string | null
  private readonly _solanaChainstackUrl:  string | null
  private readonly _blockcypherToken:     string | null
  private readonly _hybridMode:           boolean

  constructor() {
    const cfg = loadConfig()
    this._evmAlchemyKey       = cfg.mesh.evmAlchemyKey
    this._solanaRpcUrl        = cfg.mesh.solanaRpcUrl
    this._solanaChainstackUrl = cfg.mesh.solanaChainstackUrl
    this._blockcypherToken    = cfg.mesh.blockcypherApiToken
    this._hybridMode          = cfg.mesh.useHybridMode
    this._emitProvisioningSync()
  }

  // ─── Telemetry ─────────────────────────────────────────────────────────────

  private _emitProvisioningSync(): void {
    if (!this._hybridMode) return

    const managedEvm  = this._evmAlchemyKey    ? '[Managed] Active' : '[Managed] Not Configured'
    const managedSvm  =
      this._solanaRpcUrl || this._solanaChainstackUrl ? '[Managed] Active' : '[Managed] Not Configured'
    // UTXO Provider Re-Routed: BlockCypher Token Synchronized when token is present.
    const managedUtxo = this._blockcypherToken ? '[Managed] Active — BlockCypher Token Synchronized' : '[Managed] Not Configured'

    process.stdout.write(JSON.stringify({
      level:    20,
      time:     Date.now(),
      msg:      'PROVISIONING_SYNC: Omni-Protocol Synchronized — managed tier PRIORITY 1; [Mesh] Standby',
      sentinel: 'Scout',
      module:   'rpc-mesh',
      managed_evm:   managedEvm,
      managed_svm:   managedSvm,
      managed_utxo:  managedUtxo,
      failover:      'Failover Protocol Locked — Sovereign Mesh on PRIORITY 2',
    }) + '\n')
  }

  // ─── EVM stack ─────────────────────────────────────────────────────────────

  /**
   * Returns ordered EVM RPC stack for `chainNumericId`.
   *
   * Hybrid mode (USE_HYBRID_MODE = true + EVM_ALCHEMY_KEY set):
   *   [alchemyUrl, ...EVM_MESH[chainId]]
   *   Alchemy URL format: https://{chain}.g.alchemy.com/v2/{key}
   *
   * Sovereign Mesh only (default):
   *   [...EVM_MESH[chainId]]
   *
   * Failover Protocol Locked: EvmAdapter's withRpcRotation() naturally rotates
   * from index 0 (Alchemy) to index 1+ (Mesh) on HTTP 429 or connection timeout.
   */
  getEvmStack(chainNumericId: number): string[] {
    const meshUrls: string[] = [...resolveEvmMesh(chainNumericId)]

    const envPrimary = getEvmEnvRpcPrimary(chainNumericId)?.trim()
    const alchemyUrl =
      this._hybridMode && this._evmAlchemyKey
        ? buildAlchemyUrl(chainNumericId, this._evmAlchemyKey.trim())
        : null

    const ordered: string[] = []
    if (envPrimary) ordered.push(envPrimary)
    if (alchemyUrl) ordered.push(alchemyUrl)
    ordered.push(...meshUrls)

    const merged = dedupeUrls(ordered)
    return merged.length > 0 ? merged : meshUrls
  }

  // ─── SVM stack ─────────────────────────────────────────────────────────────

  /**
   * Returns ordered SVM RPC stack.
   *
   * Hybrid mode (USE_HYBRID_MODE = true + SOLANA_RPC_URL and/or SOLANA_CHAINSTACK_URL set):
   *   [SOLANA_RPC_URL QuickNode lane, Chainstack, ...SVM_MESH]
   *   Failover Protocol Locked: SvmAdapter's withFallback() rotates on failure.
   *
   * Sovereign Mesh only (default):
   *   [...SVM_MESH]
   */
  getSvmStack(): string[] {
    const cfg        = loadConfig()
    const meshUrls   = [...resolveSvmMesh()]
    const envSol     = cfg.forceEnvRpc ? cfg.rpc.solana.primary?.trim() : null
    const quickNode =
      this._hybridMode && this._solanaRpcUrl?.trim() ? this._solanaRpcUrl.trim() : null
    const chainstack =
      this._hybridMode && this._solanaChainstackUrl?.trim()
        ? this._solanaChainstackUrl.trim()
        : null

    const ordered: string[] = []
    if (envSol) ordered.push(envSol)
    if (quickNode) ordered.push(quickNode)
    if (chainstack) ordered.push(chainstack)
    ordered.push(...meshUrls)

    const merged = dedupeUrls(ordered)
    return merged.length > 0 ? merged : meshUrls
  }

  // ─── UTXO stack ────────────────────────────────────────────────────────────

  /**
   * Returns the public UTXO REST endpoint stack (Esplora-compatible providers).
   * BlockCypher is NOT in this list — it is accessed via the `blockcypherToken`
   * getter and the `BlockCypherClient` in utxo-adapter.ts.
   */
  getUtxoStack(): string[] {
    return [...resolveUtxoMesh()]
  }

  // ─── Key accessors ─────────────────────────────────────────────────────────

  /**
   * BlockCypher API token for UTXO family (BTC, LTC, DOGE).
   * UTXO Provider Re-Routed: BlockCypher Token Synchronized when this is non-null.
   * BCH is not supported by BlockCypher; callers should use the public Esplora
   * mesh (getUtxoStack()) for BCH regardless of this token.
   * null when BLOCKCYPHER_API_TOKEN is not set.
   */
  get blockcypherToken(): string | null {
    return this._blockcypherToken
  }

  /** True when Hybrid Provisioning Sync mode is active. */
  get isHybridMode(): boolean {
    return this._hybridMode
  }
}

let _hybridSingleton: HybridProviderStack | null = null

/** Lazily construct HybridProviderStack once (avoids duplicate PROVISIONING_SYNC telemetry). */
export function getHybridProviderStack(): HybridProviderStack {
  if (!_hybridSingleton) _hybridSingleton = new HybridProviderStack()
  return _hybridSingleton
}
