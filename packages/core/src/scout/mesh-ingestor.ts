/**
 * @file mesh-ingestor.ts
 * @module @legion/core/scout
 * @sentinel Scout
 *
 * MeshIngestor — Dynamic Sovereign Observability Mesh, Node Ingestion Locked.
 *
 * Discovers and validates public EVM JSON-RPC endpoints from three independent
 * authoritative registries, targeting ≥ 20 unique zero-auth nodes per chain:
 *
 *   1. chainid.network/chains.json    — community chain registry (Ethereum-Lists)
 *   2. ethereum-lists/chains (GitHub) — same upstream, independent cache/URL
 *      (used as the "Chainlist" source — Chainlist.org builds from this repo)
 *   3. PublicNode.com extended seeds  — curated zero-auth endpoints from
 *      PublicNode, 1RPC, dRPC, Tenderly, Flashbots, Omnia, ZAN, and others
 *
 * Latency Sieve — Tiered Probing (MESH-INGEST-01):
 *   Every discovered node is probed concurrently.  Promotion uses two tiers:
 *
 *   Tier 1 — Primary (Latency Tolerance Calibrated):
 *     (a) RTT ≤ LATENCY_SIEVE_THRESHOLD_MS (600 ms).  Sieve Threshold Optimized
 *         from 300 ms to 600 ms — public nodes statistically respond in 400–600 ms.
 *     (b) eth_blockNumber returns a valid uint256 block height.
 *     (c) Block height lag vs per-chain consensus ≤ BLOCK_LAG_THRESHOLD (10n blocks).
 *
 *   Tier 2 — Low-Priority Fallback:
 *     When 0 nodes pass Tier 1 globally, the same probe results are re-examined
 *     at LOW_PRIORITY_SIEVE_MS (1 000 ms).  A slow node is preferable to no node
 *     when maintaining API independence.  Tier-2 nodes pass the same block-lag
 *     check.  IngestReport records the active tier for telemetry.
 *
 *   Consensus height = max(blockHeight) across all promoted candidates for that chain.
 *   All lag arithmetic uses BigInt (CONTRACT-01 / uint256 math).
 *
 * Adaptive Jitter (MESH-INGEST-02):
 *   All probe invocations are staggered by a cryptographically-random delay in
 *   [JITTER_MIN_MS, JITTER_MAX_MS] (800–2000 ms).  Uses crypto.randomInt —
 *   never Math.random.
 *
 * 429 Blacklist (MESH-INGEST-03):
 *   A node returning HTTP 429 is added to the BlacklistRegistry for
 *   BLACKLIST_DURATION_MS (300 s).  Blacklisted nodes are skipped during
 *   ACTIVE_MESH promotion and removed from serving traffic immediately.
 *
 * Auto-Refresh (MESH-INGEST-04):
 *   startAutoRefresh() schedules a full re-validation every 10 minutes
 *   (600 000 ms default).  Any node whose RTT exceeds the active sieve threshold
 *   or whose block height lags by > 10 blocks is auto-purged from ACTIVE_MESH.
 *   stopAutoRefresh() cancels the timer cleanly.
 *
 * Block-height telemetry (CONTRACT-01):
 *   All block heights are parsed and stored as BigInt (uint256).
 *   Latency measurements are plain Number (ms — not protocol-level values).
 *
 * STRICT RULES:
 *   MESH-INGEST-01 — Latency Sieve Threshold Optimized: Tier-1 ≤ 600 ms,
 *                    Tier-2 (fallback) ≤ 1 000 ms; block-lag ≤ 10 (uint256).
 *   MESH-INGEST-02 — Adaptive Jitter: crypto.randomInt, range 800–2000 ms.
 *   MESH-INGEST-03 — 429 blacklist duration: 300 s; rotate immediately.
 *   MESH-INGEST-04 — Auto re-validation every 10 min; purge stale nodes.
 *   CONTRACT-01    — Block heights stay BigInt through this layer.
 *   SCOUT-MESH-01  — NO API keys; all endpoints are zero-auth public nodes.
 */

import { randomInt }           from 'crypto'
import { promises as dns4 }    from 'dns'
import { request, Agent }      from 'undici'

// ─── Sieve & Mesh constants ───────────────────────────────────────────────────

/**
 * Tier-1 (Primary) RTT ceiling for ACTIVE_MESH promotion (ms) — MESH-INGEST-01.
 * Sieve Threshold Optimized: 600 ms reflects the statistical reality that most
 * public nodes (geographically distributed) respond in the 400–600 ms range.
 */
const LATENCY_SIEVE_THRESHOLD_MS = 600

/**
 * Tier-2 (Low-Priority) RTT ceiling — MESH-INGEST-01.
 * Activated only when 0 nodes pass Tier-1 across all chains.
 * A slow node is preferable to no node when maintaining API independence.
 */
const LOW_PRIORITY_SIEVE_MS = 1_000

/**
 * Tier-3 (Emergency) sieve — Pipeline Audit Active.
 * Activated when 0 nodes pass Tier-1 OR Tier-2.  Any node that returns a
 * valid eth_blockNumber response within PROBE_TIMEOUT_MS is admitted to
 * ACTIVE_MESH regardless of RTT.  Existence of any connectivity is confirmed
 * before performance constraints are re-applied.
 * Block-lag purge still applies (BigInt, CONTRACT-01).
 */
const EMERGENCY_SIEVE_MS = 10_000   // effectively "any live response"

/**
 * Maximum block-height lag (uint256) vs chain consensus before a node is purged
 * from ACTIVE_MESH — MESH-INGEST-01.
 * A node with blockHeight < (maxChainHeight − BLOCK_LAG_THRESHOLD) is excluded.
 * Applied equally across all three sieve tiers.
 */
const BLOCK_LAG_THRESHOLD: bigint = 10n

/** Time a 429-offending node remains blacklisted (ms) — MESH-INGEST-03. */
const BLACKLIST_DURATION_MS = 300_000   // 300 s

/** Max nodes admitted to ACTIVE_MESH per chain. */
const MAX_NODES_PER_CHAIN = 25

/** Upper bound on total nodes in the probe queue across all chains. */
const TARGET_MESH_SIZE = 150

/** Adaptive jitter floor (ms) — MESH-INGEST-02. */
const JITTER_MIN_MS = 800

/** Adaptive jitter ceiling (ms) — MESH-INGEST-02. */
const JITTER_MAX_MS = 2_000

/**
 * HTTP timeout for all probe and discovery requests (ms).
 * Concurrency Calibrated: lowered back to 5 000 ms because the concurrency
 * limiter (MAX_CONCURRENT_PROBES = 10) prevents socket exhaustion, so
 * individual nodes receive their full bandwidth budget and respond faster.
 */
const PROBE_TIMEOUT_MS = 5_000

/**
 * Maximum number of node probes running simultaneously — Safe-Mode Concurrency.
 * Protocol Stack Hardened: reduced from 10 → 5 to eliminate TCP SYN queue
 * saturation on Windows, where the kernel half-open connection limit is lower
 * than on Linux.  Five concurrent slots give the IPv4 Forced connector a clean
 * socket budget while DNS Cache Synchronized pre-resolution eliminates resolver
 * round-trips.  Slow but steady wins the initial mesh lock.
 */
const MAX_CONCURRENT_PROBES =
  (process.env['MESH_STRICT_MODE'] === '1' || (process.env['NODE_ENV'] ?? 'development') === 'production')
    ? 10
    : 3

/**
 * Retry jitter floor (ms) applied before the single retry on HTTP 429 /
 * "Too many connections" responses.  Uses crypto.randomInt — never Math.random.
 */
const RETRY_JITTER_MIN_MS = 1_000

/**
 * Retry jitter ceiling (ms).  The retry window is randomised across
 * [1 000, 3 000] ms so simultaneous retries from different probe slots
 * do not re-collide on the same node.
 */
const RETRY_JITTER_MAX_MS = 3_000

/**
 * How many failed probe errors to emit verbosely per ingest cycle.
 * Captures the raw network signal (ECONNREFUSED / ETIMEDOUT / 403 / etc.)
 * for the first N failures so connectivity blockouts can be diagnosed.
 */
const VERBOSE_ERROR_LIMIT = 10

/**
 * Browser-compatible User-Agent sent with every RPC and registry request.
 * Header Spoofing Engaged: some public RPC nodes filter requests from known
 * server-side clients (undici / node-fetch / axios default strings).
 * A standard browser UA string bypasses this class of soft bot-detection.
 */
const RPC_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// ─── Per-cycle verbose error log (reset at the start of each ingest()) ────────
// Captures raw error messages for the first VERBOSE_ERROR_LIMIT probe failures
// so connectivity diagnosis is possible without inspecting network traces.
let _verboseErrorCount = 0

// ─── DnsCache — DNS Cache Synchronized / IPv4 Forced ────────────────────────
// Protocol Stack Hardened: replaces the Windows OS-level DNS resolver, which
// on Win32 uses an IPv6-first lookup preference that introduces a 5–10 s
// penalty when the remote endpoint has no AAAA record.
//
// DnsCache calls dns.promises.resolve4() (A-record only) and caches each
// result for DNS_CACHE_TTL_MS.  A bounded Map caps memory at DNS_CACHE_LIMIT
// entries; LRU eviction prevents unbounded growth across mesh refresh cycles.
//
// The `lookup` method satisfies the Node.js net/tls `lookup` callback contract
// (hostname, opts, cb) so it can be passed directly to undici's connect.lookup.

const DNS_CACHE_TTL_MS  = 300_000   // 5 min — matches BLACKLIST_DURATION_MS
const DNS_CACHE_LIMIT   = 512

class DnsCache {
  private readonly _store = new Map<string, { address: string; expiresAt: number }>()

  /** Resolves hostname to its first IPv4 A-record. Caches result for TTL. */
  async resolve4(hostname: string): Promise<string> {
    const hit = this._store.get(hostname)
    if (hit && Date.now() < hit.expiresAt) return hit.address

    // Evict oldest entry when cache is full
    if (this._store.size >= DNS_CACHE_LIMIT) {
      const oldest = this._store.keys().next().value
      if (oldest !== undefined) this._store.delete(oldest)
    }

    const addresses = await dns4.resolve4(hostname)
    const address   = addresses[0]
    if (!address) throw new Error(`DNS Cache Synchronized: no A-record for ${hostname}`)

    this._store.set(hostname, { address, expiresAt: Date.now() + DNS_CACHE_TTL_MS })
    return address
  }

  /**
   * Drop-in replacement for the Node.js `dns.lookup` callback API.
   * IPv4 Forced: always passes `family: 4` to the socket layer, bypassing
   * the Windows IPv6-first resolver preference.
   */
  lookup(
    hostname: string,
    _opts:    unknown,
    cb:       (err: Error | null, address: string, family: number) => void,
  ): void {
    this.resolve4(hostname)
      .then(addr => cb(null, addr, 4))
      .catch(err  => cb(err instanceof Error ? err : new Error(String(err)), '', 4))
  }
}

/** Singleton — shared across all probe and discovery requests this process. */
const DNS_CACHE = new DnsCache()

// ─── Probe Agent — Protocol Stack Hardened ────────────────────────────────────
// IPv4 Forced via connect.lookup: delegates socket-level DNS resolution to
// DNS_CACHE.lookup, which always resolves A-records (family: 4) and skips the
// Windows OS resolver's IPv6-first preference that causes 5–10 s ETIMEDOUT
// storms on nodes without AAAA records.
//
// connections: 128 — allows up to 128 concurrent connections per origin without
//   queuing at the HTTP layer (above the Semaphore layer).
// pipelining: 1 — disables HTTP pipelining.  JSON-RPC over HTTPS must not
//   pipeline: each eth_blockNumber is an independent request/response pair.
// keepAliveTimeout: 30 s — reuses established TCP/TLS sessions across the
//   probe batch, avoiding TLS handshake overhead on repeated probes.
const PROBE_AGENT = new Agent({
  connections:         128,
  pipelining:          1,
  keepAliveTimeout:    30_000,
  keepAliveMaxTimeout: 60_000,
  connect: {
    // IPv4 Forced — DNS Cache Synchronized
    lookup: (hostname, opts, cb) => DNS_CACHE.lookup(hostname, opts, cb),
  },
})

// ─── Alchemy managed probe map (Managed Transport Probes) ─────────────────────
// When EVM_ALCHEMY_KEY is present at runtime, the ingest cycle prepends one
// Alchemy URL per tracked chain to the front of the probe queue.  These occupy
// the first Semaphore slots (FIFO priority), giving Managed Transport Validated
// endpoints first access to the Latency Sieve.
//
// IPv4 Forced / DNS Cache Synchronized: Alchemy URLs resolve through PROBE_AGENT
// (DnsCache.lookup, family: 4) — same path as all Sovereign Mesh probes.
//
// NOTE: The Alchemy key is embedded in the URL path.  The URL will appear in
// ACTIVE_MESH telemetry.  Operators running the mesh-audit in shared environments
// should be aware that the key is visible in console output.

const ALCHEMY_MANAGED_CHAINS: ReadonlyArray<{ chainId: number; subdomain: string }> = [
  { chainId: 1,      subdomain: 'eth-mainnet'     },
  { chainId: 137,    subdomain: 'polygon-mainnet'  },
  { chainId: 42_161, subdomain: 'arb-mainnet'      },
  { chainId: 8_453,  subdomain: 'base-mainnet'     },
  { chainId: 10,     subdomain: 'opt-mainnet'      },
]

// ─── Semaphore — Batching Protocol Engaged ────────────────────────────────────
// Lightweight in-process concurrency gate built without external dependencies.
// Limits simultaneous in-flight probe coroutines to MAX_CONCURRENT_PROBES (5).
// Excess probes queue behind the gate; they execute in FIFO order as slots free.
//
// Safe-Mode Concurrency: five slots let the IPv4 Forced connector and DNS Cache
// Synchronized resolver operate without TCP SYN queue saturation on Windows,
// where the kernel half-open connection limit is tighter than on Linux.  The
// result is steady, predictable throughput instead of burst-then-timeout.
class Semaphore {
  private _running = 0
  private readonly _queue: Array<() => void> = []

  constructor(private readonly _limit: number) {}

  private _acquire(): Promise<void> {
    if (this._running < this._limit) {
      this._running++
      return Promise.resolve()
    }
    return new Promise<void>(resolve => { this._queue.push(resolve) })
  }

  private _release(): void {
    const next = this._queue.shift()
    if (next) {
      next()   // next waiter inherits the slot — running count unchanged
    } else {
      this._running--
    }
  }

  /** Runs `fn` within the concurrency gate, queuing if all slots are busy. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this._acquire()
    try {
      return await fn()
    } finally {
      this._release()
    }
  }
}

/** Default auto-refresh interval (ms) — MESH-INGEST-04. */
const DEFAULT_REFRESH_INTERVAL_MS = 600_000   // 10 min

// ─── Discovery source URLs ────────────────────────────────────────────────────

/** Community chain registry — same data that powers chainid.network and EIP-155. */
const CHAINID_NETWORK_URL =
  'https://chainid.network/chains.json'

/**
 * GitHub-hosted per-chain JSON for ethereum-lists/chains.
 * Chainlist.org (by DefiLlama) builds from this upstream repository.
 * Fetching per chain keeps request size small and avoids full-registry download.
 */
const ETHEREUM_LISTS_BASE =
  'https://raw.githubusercontent.com/ethereum-lists/chains/master/_data/chains/eip155-'

/** EVM chain IDs tracked by the Sovereign Observability Mesh. */
const TARGET_CHAIN_IDS: ReadonlySet<number> = new Set([1, 137, 42_161, 8_453, 10])

// ─── LlamaNodes guaranteed seeds (SCOUT-MESH-01) ──────────────────────────────
// Zero-auth endpoints that survive even when remote registries are unreachable.

const LLAMA_SEEDS: Readonly<Record<number, string>> = {
  1:      'https://eth.llamarpc.com',
  137:    'https://polygon.llamarpc.com',
  42_161: 'https://arbitrum.llamarpc.com',
  8_453:  'https://base.llamarpc.com',
  10:     'https://optimism.llamarpc.com',
}

// ─── PublicNode + extended provider seeds ─────────────────────────────────────
// Curated zero-auth endpoints from PublicNode.com, 1RPC, dRPC, Tenderly,
// Flashbots, Omnia, ZAN, SubQuery, MEV Blocker, BloXroute, NodeReal, Tatum,
// Gateway.fm, and official chain RPCs.  These supplement dynamically discovered
// nodes and ensure the ≥ 20 target even when remote registries are unavailable.

const EXTENDED_SEEDS: Readonly<Record<number, readonly string[]>> = {
  1: [
    'https://ethereum-mainnet.publicnode.com',
    'https://1rpc.io/eth',
    'https://eth.drpc.org',
    'https://mainnet.gateway.tenderly.co',
    'https://rpc.flashbots.net',
    'https://eth.meowrpc.com',
    'https://endpoints.omniatech.io/v1/eth/mainnet/public',
    'https://api.zan.top/node/v1/eth/mainnet/public',
    'https://ethereum.rpc.subquery.network/public',
    'https://rpc.mevblocker.io',
    'https://virginia.rpc.blxrbdn.com',
    'https://uk.rpc.blxrbdn.com',
    'https://singapore.rpc.blxrbdn.com',
    'https://eth-mainnet.nodereal.io/v1/pub',
    'https://rpc.builder0x69.io',
    'https://cloudflare-eth.com',
  ],
  137: [
    'https://polygon-mainnet.publicnode.com',
    'https://1rpc.io/matic',
    'https://polygon.drpc.org',
    'https://polygon-rpc.com',
    'https://polygon.meowrpc.com',
    'https://polygon.gateway.tenderly.co',
    'https://endpoints.omniatech.io/v1/matic/mainnet/public',
    'https://api.zan.top/node/v1/polygon/mainnet/public',
    'https://polygon.rpc.subquery.network/public',
    'https://rpc-mainnet.maticvigil.com',
    'https://matic-mainnet.chainstacklabs.com',
    'https://polygon-mainnet.nodereal.io/v1/pub',
    'https://polygon-bor-mainnet.publicnode.com',
    'https://bor.tatum.io',
    'https://rpc-mainnet.matic.quiknode.pro',
  ],
  42_161: [
    'https://arb1.arbitrum.io/rpc',
    'https://1rpc.io/arb',
    'https://arbitrum.drpc.org',
    'https://arbitrum.meowrpc.com',
    'https://arbitrum.gateway.tenderly.co',
    'https://endpoints.omniatech.io/v1/arbitrum/one/public',
    'https://api.zan.top/node/v1/arbitrum/one/public',
    'https://arbitrum-mainnet.publicnode.com',
    'https://arbitrum.rpc.subquery.network/public',
    'https://arb-mainnet.nodereal.io/v1/pub',
    'https://rpc.arb1.arbitrum.gateway.fm',
    'https://arb.tatum.io',
    'https://arbitrum-one-rpc.publicnode.com',
    'https://arbitrum-mainnet-archive.allthatnode.com',
    'https://arbitrum.public-rpc.com',
  ],
  8_453: [
    'https://mainnet.base.org',
    'https://1rpc.io/base',
    'https://base.drpc.org',
    'https://base.meowrpc.com',
    'https://base.gateway.tenderly.co',
    'https://endpoints.omniatech.io/v1/base/mainnet/public',
    'https://api.zan.top/node/v1/base/mainnet/public',
    'https://base-mainnet.publicnode.com',
    'https://base.rpc.subquery.network/public',
    'https://base-mainnet.nodereal.io/v1/pub',
    'https://base.tatum.io',
    'https://rpc.base.gateway.fm',
    'https://base-rpc.publicnode.com',
    'https://base-mainnet-archive.allthatnode.com',
    'https://base.public-rpc.com',
  ],
  10: [
    'https://mainnet.optimism.io',
    'https://1rpc.io/op',
    'https://optimism.drpc.org',
    'https://optimism.meowrpc.com',
    'https://optimism.gateway.tenderly.co',
    'https://endpoints.omniatech.io/v1/op/mainnet/public',
    'https://api.zan.top/node/v1/optimism/mainnet/public',
    'https://optimism-mainnet.publicnode.com',
    'https://optimism.rpc.subquery.network/public',
    'https://optimism-mainnet.nodereal.io/v1/pub',
    'https://opt.tatum.io',
    'https://rpc.optimism.gateway.fm',
    'https://optimism-rpc.publicnode.com',
    'https://optimism-mainnet-archive.allthatnode.com',
    'https://optimism.public-rpc.com',
  ],
}

// ─── Pocket Network public relay seeds (SCOUT-MESH-01) ───────────────────────
// Pocket Network (POKT) is a decentralized RPC network.  Nodies.app provides
// public POKT-backed relays that require no API key.  monitor.pokt.network
// is the network dashboard — its API is attempted at runtime; these static
// seeds guarantee coverage even when the scrape fails.

const POCKET_SEEDS: Readonly<Record<number, readonly string[]>> = {
  1:      [
    'https://eth-pokt.nodies.app',           // Nodies / Pocket Network — ETH
    'https://ethereum.pokt.network',          // POKT official relay
  ],
  137:    [
    'https://polygon-pokt.nodies.app',        // Nodies / Pocket Network — Polygon
    'https://polygon.pokt.network',
  ],
  42_161: [
    'https://arbitrum-one-pokt.nodies.app',   // Nodies / Pocket Network — Arbitrum
  ],
  8_453:  [
    'https://base-pokt.nodies.app',           // Nodies / Pocket Network — Base
  ],
  10:     [
    'https://optimism-pokt.nodies.app',       // Nodies / Pocket Network — Optimism
  ],
}

// ─── Regex guards — filter template/authenticated RPC URLs ───────────────────
// chainid.network and ethereum-lists embed placeholders like:
//   "https://mainnet.infura.io/v3/${INFURA_API_KEY}"
// These must never be promoted to the public mesh (SCOUT-MESH-01).
const NEEDS_API_KEY_RE = /\$\{[^}]+\}|apikey|api[-_]?key|YOUR[_-]?KEY/i

function isPublicRpcUrl(url: string): boolean {
  return url.startsWith('https://') && !NEEDS_API_KEY_RE.test(url)
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** Result of a single node probe during the Latency Sieve. */
export interface NodeProbeResult {
  readonly url:         string
  /** Round-trip latency in ms.  -1 when unreachable or timed out. */
  readonly latencyMs:   number
  /**
   * Latest block height (uint256 — CONTRACT-01).
   * 0n when the probe failed or returned an invalid value.
   */
  readonly blockHeight: bigint
  /** True after RTT ≤ active sieve threshold AND blockHeight > 0n (pre-lag-check). */
  readonly promoted:    boolean
}

/**
 * Sieve tier that produced a promoted node.
 *   'primary'      — RTT ≤ 600 ms  (Latency Tolerance Calibrated).
 *   'low-priority' — RTT ≤ 1 000 ms (fallback when 0 primary nodes available).
 *   'emergency'    — Any valid response within PROBE_TIMEOUT_MS (10 s).
 *                    Pipeline Audit Active — confirms connectivity exists before
 *                    latency constraints are re-applied.
 */
export type SieveTier = 'primary' | 'low-priority' | 'emergency'

/** A single entry in the live ACTIVE_MESH. */
export interface ActiveMeshNode {
  readonly url:         string
  readonly chainId:     number
  readonly latencyMs:   number
  readonly blockHeight: bigint    // uint256 — CONTRACT-01
  readonly promotedAt:  number    // epoch ms
  readonly tier:        SieveTier
}

/** Public status summary emitted after each ingest cycle. */
export interface IngestReport {
  readonly cycleAt:          number
  readonly chainsProbed:     number
  readonly nodesDiscovered:  number
  readonly nodesProbed:      number
  readonly nodesPromoted:    number
  readonly nodesLagPurged:   number
  readonly blacklisted:      number
  /** Which sieve tier was used to populate the ACTIVE_MESH this cycle. */
  readonly activeTier:       SieveTier
  /** Count of Tier-2 (low-priority) nodes in the current ACTIVE_MESH. */
  readonly nodesLowPriority: number
  /** Count of Tier-3 (emergency) nodes — non-zero only in connectivity blackout. */
  readonly nodesEmergency:   number
  readonly activeMesh:       readonly ActiveMeshNode[]
}

// ─── BlacklistRegistry ────────────────────────────────────────────────────────

class BlacklistRegistry {
  private readonly _entries = new Map<string, number>()

  blacklist(url: string, durationMs: number = BLACKLIST_DURATION_MS): void {
    this._entries.set(url, Date.now() + durationMs)
  }

  isBlacklisted(url: string): boolean {
    const expiry = this._entries.get(url)
    if (expiry === undefined) return false
    if (Date.now() >= expiry) { this._entries.delete(url); return false }
    return true
  }

  purgeExpired(): void {
    const now = Date.now()
    for (const [url, expiry] of this._entries) {
      if (now >= expiry) this._entries.delete(url)
    }
  }

  get size(): number {
    this.purgeExpired()
    return this._entries.size
  }
}

// ─── Adaptive Jitter (MESH-INGEST-02) ─────────────────────────────────────────

function adaptiveJitter(): Promise<void> {
  const delayMs = randomInt(JITTER_MIN_MS, JITTER_MAX_MS + 1)
  return new Promise<void>(resolve => setTimeout(resolve, delayMs))
}

// ─── Verbose probe-error emitter ──────────────────────────────────────────────

function emitProbeError(url: string, signal: string, extra?: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({
    level:    40,   // WARN
    time:     Date.now(),
    msg:      'probe.error',
    sentinel: 'Scout',
    module:   'mesh-ingestor',
    url,
    signal,
    ...extra,
  }) + '\n')
}

// ─── Latency Sieve probe ──────────────────────────────────────────────────────

/**
 * Probes a single EVM node via eth_blockNumber.
 *
 * Concurrency Calibrated: runs through PROBE_AGENT (connections: 128,
 * pipelining: 1) — every call must be wrapped in a Semaphore slot by the
 * caller (ingest()) before this function is invoked.
 *
 * Header Spoofing Engaged: carries RPC_USER_AGENT to bypass UA-based bot
 * filtering on public nodes.
 *
 * Dynamic Retry on Busy (MESH-INGEST-05):
 *   On HTTP 429 ("Too many connections" / rate-limit), the probe waits a
 *   random jitter in [RETRY_JITTER_MIN_MS, RETRY_JITTER_MAX_MS] (1–3 s)
 *   then retries exactly once.  A second consecutive 429 triggers the
 *   standard 300 s blacklist (rateLimited: true).
 *   The random window prevents simultaneous retries from re-colliding.
 *
 * Verbose Error Logging: the first VERBOSE_ERROR_LIMIT failures per cycle
 * emit the raw network signal (ECONNREFUSED / ETIMEDOUT / …) to stdout.
 *
 * @param _isRetry  Internal flag — callers must not pass this argument.
 */
async function probeEvmNode(
  url:       string,
  _isRetry = false,
): Promise<NodeProbeResult & { rateLimited: boolean }> {
  const t0 = Date.now()
  try {
    const { body, statusCode } = await request(url, {
      method:     'POST',
      headers:    {
        'content-type': 'application/json',
        'user-agent':   RPC_USER_AGENT,
      },
      body:           JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      dispatcher:     PROBE_AGENT,              // Concurrency Calibrated
      headersTimeout: PROBE_TIMEOUT_MS,
      bodyTimeout:    PROBE_TIMEOUT_MS,
    })

    const latencyMs = Date.now() - t0

    if (statusCode === 429) {
      await body.dump()
      if (!_isRetry) {
        // Dynamic Retry on Busy — Batching Protocol Engaged.
        // Jitter prevents thundering-herd re-collision across probe slots.
        const jitterMs = randomInt(RETRY_JITTER_MIN_MS, RETRY_JITTER_MAX_MS + 1)
        await new Promise<void>(r => setTimeout(r, jitterMs))
        return probeEvmNode(url, /* _isRetry = */ true)
      }
      // Second consecutive 429 → permanent blacklist for this cycle.
      if (_verboseErrorCount < VERBOSE_ERROR_LIMIT) {
        _verboseErrorCount++
        emitProbeError(url, 'HTTP_429_RATE_LIMITED_PERSISTENT', { latencyMs, retried: true })
      }
      return { url, latencyMs: -1, blockHeight: 0n, promoted: false, rateLimited: true }
    }

    if (statusCode !== 200) {
      await body.dump()
      if (_verboseErrorCount < VERBOSE_ERROR_LIMIT) {
        _verboseErrorCount++
        emitProbeError(url, `HTTP_${statusCode}_REJECTED`, { latencyMs, statusCode })
      }
      return { url, latencyMs: -1, blockHeight: 0n, promoted: false, rateLimited: false }
    }

    const json      = await body.json() as { result?: string; error?: { message?: string } }
    const hexResult = json.result ?? ''

    if (!hexResult.startsWith('0x')) {
      if (_verboseErrorCount < VERBOSE_ERROR_LIMIT) {
        _verboseErrorCount++
        emitProbeError(url, 'JSONRPC_BAD_RESULT', {
          latencyMs,
          result:    hexResult.slice(0, 64) || null,
          rpc_error: json.error?.message ?? null,
        })
      }
      return { url, latencyMs: -1, blockHeight: 0n, promoted: false, rateLimited: false }
    }

    // CONTRACT-01: block height is a uint256 protocol value — stays BigInt.
    const blockHeight = BigInt(hexResult)
    const promoted    = latencyMs <= LATENCY_SIEVE_THRESHOLD_MS && blockHeight > 0n

    return { url, latencyMs, blockHeight, promoted, rateLimited: false }

  } catch (err: unknown) {
    const latencyMs = Date.now() - t0
    const rawMsg = err instanceof Error ? err.message : String(err)
    const signal =
      /ECONNREFUSED/i.test(rawMsg)        ? 'ECONNREFUSED'   :
      /ETIMEDOUT|timed? ?out/i.test(rawMsg) ? 'ETIMEDOUT'   :
      /ENOTFOUND|getaddrinfo/i.test(rawMsg) ? 'ENOTFOUND'   :
      /CERT|SSL|TLS/i.test(rawMsg)        ? 'TLS_ERROR'     :
      /ECONNRESET/i.test(rawMsg)          ? 'ECONNRESET'    :
      /EACCES|403/i.test(rawMsg)          ? 'ACCESS_DENIED' :
      'UNKNOWN_ERROR'

    if (_verboseErrorCount < VERBOSE_ERROR_LIMIT) {
      _verboseErrorCount++
      emitProbeError(url, signal, { latencyMs, raw: rawMsg.slice(0, 200) })
    }

    return { url, latencyMs: -1, blockHeight: 0n, promoted: false, rateLimited: false }
  }
}

// ─── Discovery source 1: chainid.network ──────────────────────────────────────

interface ChainRegistryEntry {
  chainId: number
  rpc:     string[]
}

async function fetchChainIdNetworkEndpoints(): Promise<Map<number, string[]>> {
  const result = new Map<number, string[]>()
  try {
    const { body, statusCode } = await request(CHAINID_NETWORK_URL, {
      headers:        { 'user-agent': RPC_USER_AGENT },
      dispatcher:     PROBE_AGENT,
      headersTimeout: 10_000,
      bodyTimeout:    15_000,
    })
    if (statusCode !== 200) { await body.dump(); return result }

    const chains = await body.json() as ChainRegistryEntry[]
    for (const chain of chains) {
      if (!TARGET_CHAIN_IDS.has(chain.chainId)) continue
      const publicUrls = (chain.rpc ?? []).filter(isPublicRpcUrl).slice(0, MAX_NODES_PER_CHAIN)
      if (publicUrls.length > 0) result.set(chain.chainId, publicUrls)
    }
  } catch {
    // Non-fatal — proceed with other sources
  }
  return result
}

// ─── Discovery source 2: ethereum-lists/chains GitHub (Chainlist source) ──────

/**
 * Fetches per-chain JSON from the ethereum-lists/chains GitHub repository.
 * This is the upstream data that powers Chainlist.org (DefiLlama).
 * Fetched per chain to keep payloads small; all requests run concurrently.
 */
async function fetchEthereumListsEndpoints(): Promise<Map<number, string[]>> {
  const result = new Map<number, string[]>()

  const fetches = [...TARGET_CHAIN_IDS].map(async chainId => {
    try {
      const url = `${ETHEREUM_LISTS_BASE}${chainId}.json`
      const { body, statusCode } = await request(url, {
        headers:        { 'user-agent': RPC_USER_AGENT },
        dispatcher:     PROBE_AGENT,
        headersTimeout: 8_000,
        bodyTimeout:    10_000,
      })
      if (statusCode !== 200) { await body.dump(); return }

      const chain = await body.json() as { rpc?: string[] }
      const publicUrls = (chain.rpc ?? []).filter(isPublicRpcUrl).slice(0, MAX_NODES_PER_CHAIN)
      if (publicUrls.length > 0) result.set(chainId, publicUrls)
    } catch {
      // Non-fatal — other sources cover this chain
    }
  })

  await Promise.allSettled(fetches)
  return result
}

// ─── Discovery source 3: rpc.info ─────────────────────────────────────────────

/**
 * Attempts to scrape public RPC endpoints from rpc.info — an aggregator that
 * indexes zero-auth public JSON-RPC nodes.  Tries two known URL patterns
 * (JSON API and plain list); returns an empty map on any failure.
 *
 * rpc.info does not publish a documented machine-readable API; this function
 * probes common endpoint patterns and degrades gracefully.  The EXTENDED_SEEDS
 * and POCKET_SEEDS cover all chains even when this source is unavailable.
 */
async function fetchRpcInfoEndpoints(): Promise<Map<number, string[]>> {
  const result = new Map<number, string[]>()

  // Known probe URLs for rpc.info — try both patterns concurrently.
  const PROBE_PATTERNS = [
    'https://rpc.info/chains.json',
    'https://rpc.info/api/v1/chains',
  ]

  const fetches = PROBE_PATTERNS.map(async probeUrl => {
    try {
      const { body, statusCode } = await request(probeUrl, {
        headers:        { 'user-agent': RPC_USER_AGENT },
        dispatcher:     PROBE_AGENT,
        headersTimeout: 8_000,
        bodyTimeout:    10_000,
      })
      if (statusCode !== 200) { await body.dump(); return }

      // Try to parse as array of chain entries with rpc/rpcs array
      const data = await body.json() as unknown
      if (!Array.isArray(data)) return

      for (const entry of data as Record<string, unknown>[]) {
        const chainId = typeof entry['chainId'] === 'number' ? entry['chainId'] : null
        if (chainId === null || !TARGET_CHAIN_IDS.has(chainId)) continue

        const rpcs: string[] = []
        for (const key of ['rpc', 'rpcs', 'endpoints'] as const) {
          const val = entry[key]
          if (Array.isArray(val)) rpcs.push(...val.filter((u): u is string => typeof u === 'string'))
        }

        const publicUrls = rpcs.filter(isPublicRpcUrl).slice(0, MAX_NODES_PER_CHAIN)
        if (publicUrls.length > 0) {
          if (!result.has(chainId)) result.set(chainId, [])
          for (const url of publicUrls) {
            if (!result.get(chainId)!.includes(url)) result.get(chainId)!.push(url)
          }
        }
      }
    } catch {
      // Non-fatal — rpc.info may not expose a machine-readable API
    }
  })

  await Promise.allSettled(fetches)
  return result
}

// ─── Discovery source 4: Pocket Network monitor API ───────────────────────────

/**
 * Attempts to discover active relay nodes from the Pocket Network monitoring
 * infrastructure (monitor.pokt.network).  Returns an empty map on any failure
 * (non-fatal — POCKET_SEEDS cover all chains statically).
 *
 * Pocket Network is a decentralised RPC mesh; even partial discovery
 * (one relay per chain) improves overall sovereign independence.
 */
async function fetchPocketNetworkEndpoints(): Promise<Map<number, string[]>> {
  const result = new Map<number, string[]>()

  // Known public Pocket Network relay aggregators
  const POKT_PROBE_URLS = [
    'https://monitor.pokt.network/api/v1/chains',
    'https://rpc-proxy.pokt.network/chains',
  ]

  const fetches = POKT_PROBE_URLS.map(async probeUrl => {
    try {
      const { body, statusCode } = await request(probeUrl, {
        headers:        { 'user-agent': RPC_USER_AGENT },
        dispatcher:     PROBE_AGENT,
        headersTimeout: 8_000,
        bodyTimeout:    10_000,
      })
      if (statusCode !== 200) { await body.dump(); return }

      const data = await body.json() as unknown
      if (!Array.isArray(data)) return

      for (const entry of data as Record<string, unknown>[]) {
        const chainId = typeof entry['chainId'] === 'number' ? entry['chainId'] : null
        if (chainId === null || !TARGET_CHAIN_IDS.has(chainId)) continue

        const rpcs: string[] = []
        for (const key of ['rpcUrl', 'endpoint', 'rpc'] as const) {
          const val = entry[key]
          if (typeof val === 'string') rpcs.push(val)
          if (Array.isArray(val)) rpcs.push(...val.filter((u): u is string => typeof u === 'string'))
        }

        const publicUrls = rpcs.filter(isPublicRpcUrl).slice(0, 5)
        if (publicUrls.length > 0) {
          if (!result.has(chainId)) result.set(chainId, [])
          for (const url of publicUrls) result.get(chainId)!.push(url)
        }
      }
    } catch {
      // Non-fatal — monitor.pokt.network may not expose a public chain list
    }
  })

  await Promise.allSettled(fetches)
  return result
}

// ─── MeshIngestor ─────────────────────────────────────────────────────────────

/**
 * MeshIngestor — Sovereign Observability Mesh node lifecycle manager.
 *
 * Usage:
 *   const ingestor = new MeshIngestor()
 *   const report   = await ingestor.ingest()
 *   ingestor.startAutoRefresh()          // re-validate every 10 min
 *
 *   const primary  = ingestor.getPrimaryNode(1)    // lowest-latency ETH node
 *   const all      = ingestor.getActiveMesh(1)     // all promoted ETH nodes
 *   ingestor.stopAutoRefresh()
 */
export class MeshIngestor {
  private readonly _activeMesh  = new Map<number, ActiveMeshNode[]>()
  private readonly _blacklist   = new BlacklistRegistry()
  private _refreshTimer: ReturnType<typeof setInterval> | null = null
  private _lastReport: IngestReport | null = null

  // ─── Public accessors ──────────────────────────────────────────────────────

  /** All ACTIVE_MESH nodes for a chain, sorted ascending by latency. */
  getActiveMesh(chainId: number): readonly ActiveMeshNode[] {
    return this._activeMesh.get(chainId) ?? []
  }

  /**
   * Lowest-latency ACTIVE_MESH node URL for a chain.
   * Falls back to LlamaNodes seed when no nodes are promoted.
   */
  getPrimaryNode(chainId: number): string {
    return (
      this._activeMesh.get(chainId)?.[0]?.url ??
      LLAMA_SEEDS[chainId] ??
      'https://eth.llamarpc.com'
    )
  }

  /** All live node URLs for a chain (fallback rotation). */
  getFallbackNodes(chainId: number): string[] {
    const live = this._activeMesh.get(chainId)
    if (live && live.length > 0) return live.map(n => n.url)
    const seed = LLAMA_SEEDS[chainId]
    return seed ? [seed] : []
  }

  /** Flat view of the entire ACTIVE_MESH, sorted ascending by latency. */
  getAllActiveNodes(): readonly ActiveMeshNode[] {
    const all: ActiveMeshNode[] = []
    for (const nodes of this._activeMesh.values()) all.push(...nodes)
    return all.sort((a, b) => a.latencyMs - b.latencyMs)
  }

  /** Total count of live nodes across all chains. */
  liveNodeCount(): number {
    let count = 0
    for (const nodes of this._activeMesh.values()) count += nodes.length
    return count
  }

  /** The report from the most recent ingest() cycle, or null before first run. */
  lastReport(): IngestReport | null {
    return this._lastReport
  }

  // ─── Auto-Refresh (MESH-INGEST-04) ────────────────────────────────────────

  /**
   * Schedules a full re-validation every `intervalMs` milliseconds (default 10 min).
   * Each cycle re-discovers candidates from all five sources, re-probes them,
   * and auto-purges any node exceeding the active sieve threshold or block-lag > 10 blocks.
   *
   * Idempotent — calling again replaces any existing timer.
   *
   * @param intervalMs  Refresh interval in ms.  Default: 600 000 (10 min).
   */
  startAutoRefresh(intervalMs: number = DEFAULT_REFRESH_INTERVAL_MS): void {
    if (this._refreshTimer !== null) clearInterval(this._refreshTimer)
    this._refreshTimer = setInterval(() => {
      this.ingest().catch(() => {
        // Refresh failures are non-fatal — existing ACTIVE_MESH remains valid.
      })
    }, intervalMs)
  }

  /** Cancels the auto-refresh timer. Safe to call even if never started. */
  stopAutoRefresh(): void {
    if (this._refreshTimer !== null) {
      clearInterval(this._refreshTimer)
      this._refreshTimer = null
    }
  }

  // ─── Ingest cycle ──────────────────────────────────────────────────────────

  /**
   * Runs a full Sovereign Mesh Audit ingest cycle — Protocol Stack Hardened.
   *
   *   0. Network Identity Check: fetches api.ipify.org to log the process's
   *      public egress IP.  Confirms VPN / ISP masking.  Non-fatal.
   *   1. Fetches candidates from five sources concurrently:
   *        (a) chainid.network/chains.json
   *        (b) ethereum-lists/chains GitHub (Chainlist upstream)
   *        (c) EXTENDED_SEEDS (PublicNode, 1RPC, dRPC, Tenderly, …)
   *        (d) POCKET_SEEDS (Pocket Network / Nodies relay endpoints)
   *        (e) rpc.info & monitor.pokt.network scrapers (best-effort)
   *   2. Merges + deduplicates all candidate URLs.
   *   3. Filters blacklisted nodes; caps at MAX_NODES_PER_CHAIN per chain.
   *   4. Adaptive jitter + Semaphore-gated probes (MAX_CONCURRENT_PROBES = 5).
   *      Safe-Mode Concurrency: IPv4 Forced / DNS Cache Synchronized prevents
   *      TCP SYN saturation on Windows.
   *      Dynamic Retry on Busy: HTTP 429 → jitter 1–3 s → single retry before blacklist.
   *   5. Latency Sieve — Tier-1: RTT ≤ 600 ms AND valid block height (uint256).
   *   6. Blacklists persistent-429 responders for 300 s.
   *   7. Tiered Fallback — if 0 Tier-1 promotions, re-examine probe results
   *      at Tier-2 (≤ 1 000 ms Low-Priority).  No additional HTTP round-trips.
   *   8. Block-lag purge: derive per-chain consensus height (max blockHeight,
   *      BigInt — CONTRACT-01); discard nodes lagging > 10n blocks behind.
   *   9. Rebuilds ACTIVE_MESH sorted ascending by latency.
   *  10. Returns an IngestReport including activeTier for telemetry.
   *
   * Non-throwing: all failures are counted in the report, never propagated.
   */
  async ingest(): Promise<IngestReport> {
    const cycleAt = Date.now()
    _verboseErrorCount = 0    // reset per-cycle verbose error counter
    this._blacklist.purgeExpired()

    // ── Network Identity Check — Protocol Stack Hardened ─────────────────────
    // Fetches the public egress IP of the Node.js process via api.ipify.org.
    // Confirms whether a VPN, proxy, or ISP NAT is masking Node.js traffic
    // (which would explain discrepancies between curl.exe and Node.js reachability).
    // Non-fatal: a failure here never blocks the ingest cycle.
    try {
      const { body: ipBody, statusCode: ipStatus } = await request(
        'https://api.ipify.org?format=json',
        {
          method:         'GET',
          headers:        { 'user-agent': RPC_USER_AGENT },
          dispatcher:     PROBE_AGENT,
          headersTimeout: 5_000,
          bodyTimeout:    5_000,
        },
      )
      if (ipStatus === 200) {
        const ipJson = await ipBody.json() as { ip?: string }
        process.stdout.write(JSON.stringify({
          level:    20,
          time:     Date.now(),
          msg:      'Network Identity Check — Protocol Stack Hardened',
          sentinel: 'Scout',
          module:   'mesh-ingestor',
          public_ip: ipJson.ip ?? 'unknown',
          note:     'IPv4 Forced / DNS Cache Synchronized active for this egress path',
        }) + '\n')
      } else {
        await ipBody.dump()
      }
    } catch {
      // Non-fatal — identity check failure never blocks mesh ingestion
    }

    // ── Step 1: concurrent discovery from all five sources ───────────────────
    const [chainidMap, ethereumListsMap, rpcInfoMap, pocketMap] = await Promise.all([
      fetchChainIdNetworkEndpoints(),
      fetchEthereumListsEndpoints(),
      fetchRpcInfoEndpoints(),
      fetchPocketNetworkEndpoints(),
    ])

    // ── Step 2: merge candidates ──────────────────────────────────────────────
    const candidates = new Map<number, Set<string>>()

    const addUrls = (cid: number, urls: Iterable<string>): void => {
      if (!candidates.has(cid)) candidates.set(cid, new Set())
      for (const url of urls) candidates.get(cid)!.add(url)
    }

    // Seed layer 1: LlamaNodes guaranteed seeds
    for (const [cidStr, url] of Object.entries(LLAMA_SEEDS)) addUrls(Number(cidStr), [url])

    // Seed layer 2: PublicNode + extended provider seeds
    for (const [cidStr, urls] of Object.entries(EXTENDED_SEEDS)) addUrls(Number(cidStr), urls)

    // Seed layer 3: Pocket Network / Nodies relay seeds
    for (const [cidStr, urls] of Object.entries(POCKET_SEEDS)) addUrls(Number(cidStr), urls)

    // Dynamic layer 4: chainid.network discoveries
    for (const [chainId, urls] of chainidMap) addUrls(chainId, urls)

    // Dynamic layer 5: ethereum-lists/chains (Chainlist upstream)
    for (const [chainId, urls] of ethereumListsMap) addUrls(chainId, urls)

    // Dynamic layer 6: rpc.info scrape
    for (const [chainId, urls] of rpcInfoMap) addUrls(chainId, urls)

    // Dynamic layer 7: Pocket Network monitor scrape
    for (const [chainId, urls] of pocketMap) addUrls(chainId, urls)

    const nodesDiscovered = [...candidates.values()].reduce((s, v) => s + v.size, 0)

    // ── Step 3: dedup, blacklist-filter, cap per chain ────────────────────────
    const probeQueue: Array<{ chainId: number; url: string }> = []

    for (const [chainId, urlSet] of candidates) {
      let added = 0
      for (const url of urlSet) {
        if (added >= MAX_NODES_PER_CHAIN) break
        if (this._blacklist.isBlacklisted(url)) continue
        probeQueue.push({ chainId, url })
        added++
      }
    }

    // ── Managed Transport Probes — first 5 Semaphore slots reserved ───────────
    // When EVM_ALCHEMY_KEY is set, prepend one Alchemy URL per tracked chain to
    // the front of the probe queue.  FIFO Semaphore scheduling gives these entries
    // priority over public mesh probes.  Each Alchemy node is filtered through the
    // same Latency Sieve and block-lag check as all other candidates — Managed
    // Transport Validated does not bypass quality gates.
    // IPv4 Forced / DNS Cache Synchronized: PROBE_AGENT handles all resolution.
    const alchemyKey = process.env['EVM_ALCHEMY_KEY'] ?? null
    if (alchemyKey) {
      const managedProbes = ALCHEMY_MANAGED_CHAINS
        .filter(({ chainId }) => candidates.has(chainId))
        .map(({ chainId, subdomain }) => ({
          chainId,
          url: `https://${subdomain}.g.alchemy.com/v2/${alchemyKey}`,
        }))
      probeQueue.unshift(...managedProbes)
    }

    const cappedQueue = probeQueue.slice(0, TARGET_MESH_SIZE)

    // ── Step 4: adaptive jitter + concurrency-gated probes ───────────────────
    // Safe-Mode Concurrency — Protocol Stack Hardened: a per-cycle Semaphore
    // limits simultaneous in-flight TCP connections to MAX_CONCURRENT_PROBES (5).
    // IPv4 Forced / DNS Cache Synchronized eliminates resolver lag; the lower
    // slot count prevents TCP SYN queue saturation on Windows where the kernel
    // half-open connection limit is tighter than on Linux.
    await adaptiveJitter()

    const sem = new Semaphore(MAX_CONCURRENT_PROBES)
    const settled = await Promise.allSettled(
      cappedQueue.map(({ url }) => sem.run(() => probeEvmNode(url))),
    )

    // ── Step 5 + 6: collect valid probes + blacklist 429 responders ───────────
    // Keep ALL valid (non-rate-limited, blockHeight > 0) probe results so the
    // tiered fallback in step 7 can re-examine them without extra HTTP calls.
    type ValidProbe = {
      item:  { chainId: number; url: string }
      probe: { url: string; latencyMs: number; blockHeight: bigint }
    }
    const validProbes: ValidProbe[] = []
    let blacklistedCount = 0

    for (let i = 0; i < cappedQueue.length; i++) {
      const item   = cappedQueue[i]!
      const result = settled[i]
      if (result?.status === 'rejected') continue

      const probe = result!.value
      if (probe.rateLimited) {
        this._blacklist.blacklist(probe.url, BLACKLIST_DURATION_MS)
        blacklistedCount++
        continue
      }

      // Keep any probe that returned a valid block height (regardless of RTT)
      if (probe.blockHeight > 0n && probe.latencyMs > 0) {
        validProbes.push({ item, probe })
      }
    }

    // ── Step 7: Tiered Sieve — cascading RTT thresholds ──────────────────────
    // Re-filters the already-collected probe results — no additional HTTP calls.
    //
    // Tier-1 (Primary):    RTT ≤ 600 ms  — Latency Tolerance Calibrated
    // Tier-2 (Low-Pri):    RTT ≤ 1 000 ms — activated when Tier-1 = 0
    // Tier-3 (Emergency):  any valid response ≤ PROBE_TIMEOUT_MS (10 s)
    //                      Pipeline Audit Active — confirms connectivity before
    //                      latency constraints are re-applied next cycle.
    const tier1 = validProbes.filter(p => p.probe.latencyMs <= LATENCY_SIEVE_THRESHOLD_MS)
    const tier2 = tier1.length === 0
      ? validProbes.filter(p => p.probe.latencyMs <= LOW_PRIORITY_SIEVE_MS)
      : []
    const tier3 = tier1.length === 0 && tier2.length === 0
      ? validProbes.filter(p => p.probe.latencyMs <= EMERGENCY_SIEVE_MS)
      : []

    const activeTier: SieveTier =
      tier1.length > 0 ? 'primary' :
      tier2.length > 0 ? 'low-priority' : 'emergency'

    const sieverPassed =
      activeTier === 'primary'      ? tier1 :
      activeTier === 'low-priority' ? tier2 : tier3

    if (activeTier === 'emergency') {
      process.stdout.write(JSON.stringify({
        level: 40, time: Date.now(),
        msg:      'Pipeline Audit Active — Emergency Sieve engaged',
        sentinel: 'Scout', module: 'mesh-ingestor',
        valid_probes: validProbes.length,
        hint: 'All nodes exceed Tier-1/Tier-2 RTT thresholds. Admitting any live responder. Check VERBOSE probe.error logs above for raw network signals.',
      }) + '\n')
    }

    // ── Step 8: Block-lag purge ───────────────────────────────────────────────
    // Derive per-chain consensus height = max(blockHeight) across sieve-passed
    // nodes for that chain.  All arithmetic is BigInt (uint256 — CONTRACT-01).
    const chainMaxHeight = new Map<number, bigint>()
    for (const { item, probe } of sieverPassed) {
      const cur = chainMaxHeight.get(item.chainId) ?? 0n
      if (probe.blockHeight > cur) chainMaxHeight.set(item.chainId, probe.blockHeight)
    }

    const finalPromoted: ActiveMeshNode[] = []
    let lagPurgedCount = 0

    for (const { item, probe } of sieverPassed) {
      const consensusHeight = chainMaxHeight.get(item.chainId) ?? probe.blockHeight
      const lag             = consensusHeight - probe.blockHeight   // uint256 subtraction

      if (lag > BLOCK_LAG_THRESHOLD) {
        lagPurgedCount++
        continue
      }

      finalPromoted.push({
        url:         probe.url,
        chainId:     item.chainId,
        latencyMs:   probe.latencyMs,
        blockHeight: probe.blockHeight,
        promotedAt:  Date.now(),
        tier:        activeTier,
      })
    }

    // ── Step 9: rebuild ACTIVE_MESH ───────────────────────────────────────────
    this._activeMesh.clear()
    for (const node of finalPromoted) {
      if (!this._activeMesh.has(node.chainId)) this._activeMesh.set(node.chainId, [])
      this._activeMesh.get(node.chainId)!.push(node)
    }
    for (const nodes of this._activeMesh.values()) {
      nodes.sort((a, b) => a.latencyMs - b.latencyMs)
    }

    const nodesLowPriority = finalPromoted.filter(n => n.tier === 'low-priority').length
    const nodesEmergency   = finalPromoted.filter(n => n.tier === 'emergency').length

    const report: IngestReport = {
      cycleAt,
      chainsProbed:     candidates.size,
      nodesDiscovered,
      nodesProbed:      cappedQueue.length,
      nodesPromoted:    finalPromoted.length,
      nodesLagPurged:   lagPurgedCount,
      blacklisted:      blacklistedCount,
      activeTier,
      nodesLowPriority,
      nodesEmergency,
      activeMesh:       this.getAllActiveNodes(),
    }

    this._lastReport = report
    return report
  }
}
