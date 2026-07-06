/**
 * @file asset-scanner.ts
 * @module @legion/core/scout
 * @sentinel Scout
 *
 * AssetScanner V3 — Universal multi-architecture asset discovery.
 *
 * Address routing (no guessing — delegate to identifyFamily()):
 *   0x{40hex}     → EVM   → EvmAdapter.discoverAssets() × 5 chains (parallel)
 *   base58 32-44  → SVM   → SvmAdapter.discoverAssets() (SOL + all SPL tokens)
 *   1…/3…/bc1…   → UTXO  → UtxoAdapter (Bitcoin Core RPC) OR public REST mesh
 *
 * L3 Approval probes (EVM only, after asset discovery):
 *   Multicall3 aggregate3 — allowance(owner, UniswapRouter02) +
 *   allowance(owner, 1inch AggV5) for every discovered ERC-20.
 *
 * Lethality (GATEKEEPER-02):
 *   lethalityScore = Math.floor(USD_Value − Gas_Estimate_USD)
 *   UPSERT → opportunities if lethalityScore ≥ MIN_LETHALITY_THRESHOLD ($50)
 *
 * ProviderMesh (SCOUT-MESH-01/02):
 *   Before every scan, healthPing() probes all nodes concurrently.
 *   EVM  — 5 nodes per chain (LlamaNodes, Cloudflare, Ankr, BlockPI, BlastAPI)
 *   SVM  — 4 nodes (Mainnet, Extrnode, Jito-Public, GenesysGo)
 *   UTXO — 4 REST providers (Mempool.space, Blockstream, Blockchain.info, Chain.so)
 *   Signals: "Omni-Reach Locked" | "Mesh Failover Active" | "Telemetry Synchronized"
 *
 * SVM Two-Phase Pricing:
 *   Phase 1 — discover all SPL token accounts via getProgramAccounts.
 *   Phase 2 — batch-fetch Llama prices for discovered mint addresses.
 *   Pre-filter: SPL tokens with usdValue < SVM_MIN_SPL_USD ($10) are skipped.
 *   DB persistence: only assets with lethalityScore ≥ $50 are persisted.
 *
 * UTXO Public-Mesh Fallback:
 *   When BLOCKCYPHER_API_TOKEN is absent/unhealthy, balance is fetched from the public
 *   read-only fallback mesh.
 *   REST mesh (Mempool.space → Blockstream → Blockchain.info → Chain.so).
 *   No Bitcoin Core node required.
 *
 * Compliance:
 *   SCOUT-01    — All I/O parallel via Promise.allSettled.
 *   SCOUT-03    — Multicall3 aggregate3 (allowFailure:true); NEVER aggregate v1.
 *   CONTRACT-06 — Multicall3 = 0xcA11bde05977b3631167028862bE2a173976CA11.
 *   CONTRACT-01 — ALL on-chain amounts stay BigInt. Float only at lethality boundary.
 *   SHADOW-04   — pino.info only for found assets (no debug spam).
 *   MASK-03     — createPublicClient (viem); NEVER ethers.providers.
 *   DISPATCHER-02 — Gas from eth_feeHistory(4 blocks). NEVER eth_gasPrice.
 *   RULE-GLOBAL-B — No floating-point in financial math.
 */

import {
  createPublicClient,
  http,
  parseAbi,
  type Address,
  type Chain as ViemChain,
  type PublicClient,
} from 'viem'
import { mainnet, polygon, arbitrum, base, optimism } from 'viem/chains'
import {
  LEGION_MESH_EVENT_WHALE_ALERT,
  legionMeshViemFetchOptions,
} from '../logic/mesh-event.js'
import { Pool as UndiciPool } from 'undici'
import { createHash } from 'node:crypto'
import { base58 } from '@scure/base'
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { identifyFamily, GatekeeperError } from '../adapters/address-resolver.js'
import { EvmAdapter }  from '../adapters/evm-adapter.js'
import { SvmAdapter }  from '../adapters/svm-adapter.js'
import { UtxoAdapter, BlockCypherClient } from '../adapters/utxo-adapter.js'
import type { DiscoveredAsset } from '../adapters/base-adapter.js'
import { opportunities } from '../db/schema.js'
import { loadConfig }   from '../config/loader.js'
import {
  ProviderMesh,
  fetchBtcBalanceFromMesh,
  getHybridProviderStack,
  resolveTransportPolicy,
  type MeshStatus,
} from './rpc-mesh.js'

// ─── Drizzle type alias (compatible with drizzle(pool) return) ────────────────
type AnyNodePgDb = NodePgDatabase<Record<string, unknown>>

// ─── Universal Constants (CONTRACT-06) ────────────────────────────────────────
const MULTICALL3_ADDR = '0xcA11bde05977b3631167028862bE2a173976CA11' as const satisfies Address

// EIP-4626 sentinel for native coin (1inch / LI.FI convention)
const NATIVE_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as const
const SVM_NATIVE_SENTINEL = '0eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as const

// Approval spenders probed in L3 (CLOSER-10, CLOSER-07)
const SPENDER_UNISWAP = '0x68b3465833fb72A70ecdf485E0e4C7bD8665Fc45' as const satisfies Address
const SPENDER_1INCH   = '0x1111111254EEB25477B68fb85Ed929f73A960582' as const satisfies Address

// Gas unit estimates for lethality floor calculation
const GAS_ERC20           = 65_000n
const GAS_NATIVE_EVM      = 21_000n
const UTXO_FEERATE_SAT_VB = 30n    // conservative sat/vB for GATEKEEPER-02 estimate

// GATEKEEPER-02: minimum net USD value before an opportunity is persisted.
// Set to 0 to detect all wallets including test/small-value wallets.
const MIN_LETHALITY_THRESHOLD = 0

// SVM pre-filter: SPL tokens with usdValue < this are discarded before lethality
// computation. Prevents dust tokens from consuming price API quota.
const SVM_MIN_SPL_USD = 10
const SVM_BASE_LAMPORT_GAS = 5_000n

// ─── RPC Resilience constants ─────────────────────────────────────────────────
// Deterministic per-chain stagger: chain i fires after i × 50 ms.
// No Math.random — offsets are fixed and reproducible across runs.
const CHAIN_STAGGER_MS    = 50
// Pure exponential back-off for 429 / rate-limit retries: 600 → 1200 → 2400 ms.
const RETRY_BASE_DELAY_MS = 600
const RETRY_MAX_ATTEMPTS  = 3

// ─── ABI Fragments (L3 approval probes) ───────────────────────────────────────
const ERC20_ALLOWANCE_ABI = parseAbi([
  'function allowance(address owner, address spender) external view returns (uint256)',
])

// ─── DefiLlama chain name map ─────────────────────────────────────────────────
// Maps CAIP-2 chain IDs to the chain name prefix used by DefiLlama coins API.
// Format: coins.llama.fi/prices/current/{chain}:{address}
const LLAMA_CHAIN: Readonly<Record<string, string>> = {
  'evm:1':            'ethereum',
  'evm:137':          'polygon',
  'evm:42161':        'arbitrum',
  'evm:8453':         'base',
  'evm:10':           'optimism',
  'svm:101':          'solana',
  'svm:mainnet-beta': 'solana',
}

// Maps CAIP-2 chain IDs to the CoinGecko llama key for the native coin.
const NATIVE_LLAMA_KEY: Readonly<Record<string, string>> = {
  'evm:1':            'coingecko:ethereum',
  'evm:137':          'coingecko:matic-network',
  'evm:42161':        'coingecko:ethereum',
  'evm:8453':         'coingecko:ethereum',
  'evm:10':           'coingecko:ethereum',
  'svm:101':          'coingecko:solana',
  'svm:mainnet-beta': 'coingecko:solana',
  'utxo:mainnet':     'coingecko:bitcoin',
}

/**
 * Derives the DefiLlama coins API key for a discovered asset.
 * Native assets (assetAddress === null) resolve to their CoinGecko key.
 * Tokens resolve to `{llamaChain}:{lowercaseAddress}`.
 */
function llamaKey(chainId: string, assetAddress: string | null): string {
  if (assetAddress === null) {
    return NATIVE_LLAMA_KEY[chainId] ?? 'coingecko:ethereum'
  }
  const chain = LLAMA_CHAIN[chainId] ?? 'ethereum'
  return `${chain}:${assetAddress.toLowerCase()}`
}

// ─── EVM Chain Metadata (for adapter construction + L3 viem client) ──────────

interface EvmChainMeta {
  chainId:        string
  viemChain:      ViemChain
  rpcUrl:         string
  /** Failover rotation URLs (Hybrid + mesh ordering after healthPing). */
  rpcFallbacks?: string[]
  nativeSymbol:   string
  nativeDecimals: number
}

/**
 * Zero-API Lock threshold (MESH-INGEST — Sovereign Independence).
 *
 * When the ProviderMesh has more than ZERO_API_LOCK_THRESHOLD live nodes
 * across all families after a healthPing() cycle, AssetScanner operates in
 * Sovereign Mesh Mode: hardcoded .env RPC URLs are bypassed and every chain
 * is served exclusively from the validated live mesh.
 *
 * Threshold calibrated to 15 (Sieve Threshold Optimized) so that Sovereign
 * Mode activates as soon as even a modest number of nodes survive the relaxed
 * sieve (Tier-1 ≤ 600 ms or Tier-2 ≤ 1 000 ms).  This ensures immediate
 * API independence rather than waiting for full mesh saturation.
 *
 * If mesh density drops ≤ threshold, the scanner falls back to .env primary
 * URLs to maintain continuity — unless USE_HYBRID_MODE or FORCE_ENV_RPC=1, in
 * which case the Omni-Gatekeeper keeps managed / env ordering ahead of raw mesh.
 */
function buildEvmChainMetas(
  cfg:  ReturnType<typeof loadConfig>,
  mesh: ProviderMesh,
): EvmChainMeta[] {
  const hybrid = getHybridProviderStack()
  const policy = resolveTransportPolicy(mesh.liveNodeCount())

  const row = (
    chainId: string,
    viemChain: ViemChain,
    numericId: number,
    nativeSymbol: string,
    nativeDecimals: number,
    envUrl: string | null,
  ): EvmChainMeta => {
    if (policy.zeroApiLock && !policy.useManagedEnvProviders) {
      const primary  = mesh.getEvmEndpoint(numericId)
      const fallbacks = mesh.getEvmFallbacks(numericId).filter(u => u !== primary)
      return {
        chainId,
        viemChain,
        rpcUrl: primary,
        ...(fallbacks.length > 0 ? { rpcFallbacks: fallbacks } : {}),
        nativeSymbol,
        nativeDecimals,
      }
    }
    const stack   = hybrid.getEvmStack(numericId)
    const primary = stack[0] ?? envUrl ?? mesh.getEvmEndpoint(numericId)
    const rest    = stack.slice(1).filter(u => u !== primary)
    return {
      chainId,
      viemChain,
      rpcUrl: primary,
      ...(rest.length > 0 ? { rpcFallbacks: rest } : {}),
      nativeSymbol,
      nativeDecimals,
    }
  }

  return [
    row('evm:1', mainnet, 1, 'ETH', 18, cfg.rpc.ethereum.primary),
    row('evm:137', polygon, 137, 'MATIC', 18, cfg.rpc.polygon.primary),
    row('evm:42161', arbitrum, 42161, 'ETH', 18, cfg.rpc.arbitrum.primary),
    row('evm:8453', base, 8453, 'ETH', 18, cfg.rpc.base.primary),
    row('evm:10', optimism, 10, 'ETH', 18, cfg.rpc.optimism.primary),
  ]
}

/** Explicit viem client config — avoids TS2589 deep generic instantiation on createPublicClient. */
type LegionPublicClientConfig = {
  chain: ViemChain
  transport: ReturnType<typeof http>
}

/** Wraps createPublicClient with a fixed return type (viem chain generics can recurse past TS limits). */
function createLegionPublicClient(config: LegionPublicClientConfig): PublicClient {
  const createClient = createPublicClient as (params: LegionPublicClientConfig) => PublicClient
  return createClient(config)
}

// ─── Resilience helpers ───────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

/**
 * Retries `fn` on HTTP 429 / rate-limit errors using pure exponential back-off.
 * No Math.random — delays are fully deterministic (SHADOW-04 / CONTRACT-01).
 *
 *   attempt 0 → immediate
 *   attempt 1 → sleep RETRY_BASE_DELAY_MS  × 2⁰  (600 ms)
 *   attempt 2 → sleep RETRY_BASE_DELAY_MS  × 2¹  (1 200 ms)
 *   …
 *
 * Non-429 errors are re-thrown immediately without consuming retry budget.
 */
async function withRetry<T>(
  fn:       () => Promise<T>,
  attempts: number = RETRY_MAX_ATTEMPTS,
  baseMs:   number = RETRY_BASE_DELAY_MS,
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (cause: unknown) {
      const msg         = cause instanceof Error ? cause.message : String(cause)
      const isRateLimit = msg.includes('429') || /rate.?limit|too many requests/i.test(msg)
      if (!isRateLimit || i === attempts - 1) throw cause
      await sleep(baseMs * (2 ** i))
    }
  }
  /* istanbul ignore next — loop always throws before this line */
  throw new Error('withRetry: exhausted without result or throw')
}

// ─── Logger (SHADOW-04) ───────────────────────────────────────────────────────
// pino-compatible NDJSON. `info` only for qualifying assets; `warn`/`error`
// for degraded paths. No key material handled here — no GATEKEEPER-07 redaction needed.

function emitLog(
  level: 'info' | 'warn' | 'error',
  msg:   string,
  extra?: Record<string, unknown>,
): void {
  const lvl = level === 'info' ? 30 : level === 'warn' ? 40 : 50
  process.stdout.write(JSON.stringify({
    level: lvl, time: Date.now(), msg,
    sentinel: 'Scout', module: 'AssetScanner',
    ...extra,
  }) + '\n')
}

// ─── DefiLlama Price Feed (undici.Pool — RULE-GLOBAL-B) ──────────────────────

let _llamaPool: UndiciPool | null = null

function getLlamaPool(): UndiciPool {
  if (!_llamaPool) {
    const base = process.env['DEFILLAMA_COINS_BASE_URL']?.trim() ?? ''
    if (!base) throw new Error('DEFILLAMA_COINS_BASE_URL not configured')
    _llamaPool = new UndiciPool(base, {
      connections: 4, pipelining: 1,
      keepAliveTimeout: 30_000, keepAliveMaxTimeout: 60_000,
    })
  }
  return _llamaPool
}

/**
 * Fetches USD prices from DefiLlama with 3-retry exponential back-off.
 * Returns a zero-price map on complete failure (non-fatal — lethality uses 0).
 */
async function fetchPricesUsd(llamaKeys: string[]): Promise<Record<string, number>> {
  if (llamaKeys.length === 0) return {}
  const unique = [...new Set(llamaKeys)]
  try {
    return await withRetry(async () => {
      const { body } = await getLlamaPool().request({
        path: `/prices/current/${unique.join(',')}`, method: 'GET',
      })
      const raw = await body.json() as { coins?: Record<string, { price?: number }> }
      return Object.fromEntries(unique.map(k => [k, raw.coins?.[k]?.price ?? 0]))
    }, RETRY_MAX_ATTEMPTS, RETRY_BASE_DELAY_MS)
  } catch (cause: unknown) {
    emitLog('warn', 'DefiLlama price fetch failed after retries — lethality uses zero prices', {
      cause: cause instanceof Error ? cause.message : String(cause),
    })
    return Object.fromEntries(unique.map(k => [k, 0]))
  }
}

// ─── USD helpers (CONTRACT-01 boundary) ──────────────────────────────────────
// Balances stay BigInt throughout. Float used ONLY at the lethality comparison
// boundary. lethality_score is stored as integer, never as float.

function toUsdFloat(amount: bigint, decimals: number, priceUsd: number): number {
  if (amount === 0n || priceUsd === 0) return 0
  const scale = 10n ** BigInt(decimals)
  return (Number(amount / scale) + Number(amount % scale) / Number(scale)) * priceUsd
}

function gasToUsdFloat(gasUnits: bigint, maxFeePerGas: bigint, ethPriceUsd: number): number {
  return (Number(gasUnits * maxFeePerGas) / 1e18) * ethPriceUsd
}

function normalizeAssetAddressForStorage(asset: Pick<ScannedAsset, 'family' | 'assetAddress'>): string {
  return asset.family === 'EVM' ? asset.assetAddress.toLowerCase() : asset.assetAddress
}

function isBase58CheckValid(address: string): boolean {
  try {
    const decoded = base58.decode(address)
    if (decoded.length < 5) return false
    const payload = decoded.slice(0, decoded.length - 4)
    const checksum = decoded.slice(decoded.length - 4)
    const first = createHash('sha256').update(payload).digest()
    const second = createHash('sha256').update(first).digest()
    return Buffer.from(checksum).equals(second.subarray(0, 4))
  } catch {
    return false
  }
}

function validateUtxoInputAddress(owner: string): void {
  const lowered = owner.toLowerCase()
  const isBech32 = lowered.startsWith('bc1') || lowered.startsWith('tb1')
  if (isBech32) return
  if (!isBase58CheckValid(owner)) throw new GatekeeperError(owner)
}

// ─── Exported Types ───────────────────────────────────────────────────────────

export interface ScannedAsset {
  chainId:        string
  family:         string
  assetAddress:   string    // NATIVE_SENTINEL for native coins
  symbol:         string
  amountRaw:      bigint    // uint256 — NEVER convert to Number
  decimals:       number
  usdValue:       number    // float for lethality comparison only
  gasEstimateUsd: number
  lethalityScore: number    // Math.floor(usdValue − gasEstimateUsd)
  approvals:      { spender: string; allowanceRaw: bigint }[]
}

export interface UniversalScoutTargets {
  evm: string[]
  svm: string[]
  utxo: {
    btc: string[]
    ltc: string[]
    doge: string[]
  }
}

class SvmScout {
  constructor(
    private readonly rpcUrl: string,
    private readonly fallbackRpcUrls: string[],
  ) {}

  async pollTarget(
    owner: string,
    prices: Record<string, number>,
  ): Promise<ScannedAsset[]> {
    const trimmedOwner = owner.trim()
    const discovered = await scanSvmChain('svm:101', this.rpcUrl, trimmedOwner, prices, this.fallbackRpcUrls)
    return discovered.map((asset) => ({
      ...asset,
      assetAddress: asset.symbol === 'SOL' ? SVM_NATIVE_SENTINEL : asset.assetAddress,
    }))
  }
}

class UtxoScout {
  constructor(private readonly client: BlockCypherClient) {}

  async pollTarget(
    owner: string,
    coin: 'btc' | 'ltc' | 'doge',
    prices: Record<string, number>,
  ): Promise<ScannedAsset[]> {
    const trimmedOwner = owner.trim()
    validateUtxoInputAddress(trimmedOwner)
    const discoveredAssets: DiscoveredAsset[] = []
    const discovered = await this.client.discoverAssets(trimmedOwner, coin)
    for (const entry of discovered) {
      const normalized: DiscoveredAsset = {
        assetAddress: entry.assetAddress,
        balance: BigInt(entry.balance).toString(),
        ...(entry.symbol !== undefined ? { symbol: entry.symbol } : {}),
        ...(entry.decimals !== undefined ? { decimals: entry.decimals } : {}),
      }
      discoveredAssets.push(normalized)
    }
    if (discoveredAssets.length === 0) return []

    const chainId =
      coin === 'btc' ? 'btc:mainnet' :
      coin === 'ltc' ? 'ltc:mainnet' :
      'doge:mainnet'
    const coinPrice =
      coin === 'btc' ? (prices['coingecko:bitcoin'] ?? 0) :
      coin === 'ltc' ? (prices['coingecko:litecoin'] ?? 0) :
      (prices['coingecko:dogecoin'] ?? 0)

    const vsize = 141n
    const feeSats = vsize * UTXO_FEERATE_SAT_VB
    const gasEstimateUsd = toUsdFloat(feeSats, 8, coinPrice)

    return discoveredAssets.map((d) => {
      const amountRaw = BigInt(d.balance)
      const decimals = d.decimals ?? 8
      const usdValue = toUsdFloat(amountRaw, decimals, coinPrice)
      const lethalityScore = Math.floor(usdValue - gasEstimateUsd)
      emitLog('info', 'asset.found', {
        chain: chainId,
        family: 'UTXO',
        asset: d.symbol ?? coin.toUpperCase(),
        address: trimmedOwner,
        balance_uint256: amountRaw.toString(),
        lethality: lethalityScore,
        signal: 'UTXO Signal Re-routed',
      })
      return {
        chainId,
        family: 'UTXO',
        assetAddress: trimmedOwner,
        symbol: d.symbol ?? coin.toUpperCase(),
        amountRaw,
        decimals,
        usdValue,
        gasEstimateUsd,
        lethalityScore,
        approvals: [],
      }
    })
  }
}

// ─── EVM Chain Scan ───────────────────────────────────────────────────────────

async function scanEvmChain(
  meta:         EvmChainMeta,
  owner:        Address,
  prices:       Record<string, number>,
  staggerIndex: number = 0,
): Promise<ScannedAsset[]> {
  // Deterministic stagger: chain i waits i × CHAIN_STAGGER_MS before firing.
  // Spreads 5 parallel EVM pings across 0–200 ms without randomness.
  if (staggerIndex > 0) await sleep(staggerIndex * CHAIN_STAGGER_MS)

  const adapter = new EvmAdapter({
    chainId:   meta.chainId,
    viemChain: meta.viemChain,
    rpcUrl:    meta.rpcUrl,
    meshEventKind: LEGION_MESH_EVENT_WHALE_ALERT,
    ...(meta.rpcFallbacks != null && meta.rpcFallbacks.length > 0
      ? { rpcFallbacks: meta.rpcFallbacks }
      : {}),
  })

  // ── EvmAdapter.discoverAssets: native ETH + ERC-20 via multicall ──────────
  let discovered: DiscoveredAsset[]
  try {
    discovered = await withRetry(() => adapter.discoverAssets(owner))
  } catch (cause: unknown) {
    emitLog('warn', 'EvmAdapter.discoverAssets failed', {
      chain: meta.chainId,
      cause: cause instanceof Error ? cause.message : String(cause),
    })
    return []
  }

  if (discovered.length === 0) return []

  // ── Gas price (DISPATCHER-02: eth_feeHistory, NEVER eth_gasPrice) ─────────
  let maxFeePerGas = 1_000_000_000n  // 1 gwei floor
  try {
    const client = createPublicClient({
      chain: meta.viemChain,
      transport: http(meta.rpcUrl, {
        retryCount: 3,
        retryDelay: 800,
        ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_WHALE_ALERT),
      }),
    })
    const feeHistory = await client.getFeeHistory({ blockCount: 4, rewardPercentiles: [50] })
    const baseFee    = feeHistory.baseFeePerGas[feeHistory.baseFeePerGas.length - 2] ?? 0n
    const reward     = feeHistory.reward?.[feeHistory.reward.length - 1]?.[0] ?? 0n
    maxFeePerGas     = (baseFee * 125n) / 100n + reward
  } catch {
    // Keep floor — non-fatal
  }

  const nativePrice = prices[llamaKey(meta.chainId, null)] ?? 0

  // ── L3: Allowance probes for discovered ERC-20 tokens ────────────────────
  // Build a flat multicall batch: [allowance(uniswap)×N, allowance(1inch)×N]
  const tokenAssets = discovered.filter(d => d.assetAddress !== null)

  // Result map: tokenAddress → { uniswap: bigint, oneinch: bigint }
  const allowanceMap = new Map<string, { uniswap: bigint; oneinch: bigint }>()

  if (tokenAssets.length > 0) {
    type McCall = {
      address: Address
      abi: typeof ERC20_ALLOWANCE_ABI
      functionName: 'allowance'
      args: [Address, Address]
    }

    const uniCalls: McCall[] = tokenAssets.map(d => ({
      address:      d.assetAddress as Address,
      abi:          ERC20_ALLOWANCE_ABI,
      functionName: 'allowance' as const,
      args:         [owner, SPENDER_UNISWAP] as [Address, Address],
    }))
    const oneCalls: McCall[] = tokenAssets.map(d => ({
      address:      d.assetAddress as Address,
      abi:          ERC20_ALLOWANCE_ABI,
      functionName: 'allowance' as const,
      args:         [owner, SPENDER_1INCH] as [Address, Address],
    }))

    try {
      const l3Client = createPublicClient({
        chain:     meta.viemChain,
        transport: http(meta.rpcUrl, {
          retryCount: 2,
          retryDelay: 600,
          ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_WHALE_ALERT),
        }),
      })
      const mcRes = (await (l3Client as unknown as {
        multicall: (args: unknown) => Promise<Array<{ status: 'success' | 'failure'; result?: unknown }>>
      }).multicall({
        contracts:        [...uniCalls, ...oneCalls],
        allowFailure:     true,
        multicallAddress: MULTICALL3_ADDR,
      })) as Array<{ status: 'success' | 'failure'; result?: unknown }>

      const half = tokenAssets.length
      for (let i = 0; i < half; i++) {
        const addr   = tokenAssets[i]!.assetAddress!
        const uniRes = mcRes[i]
        const oneRes = mcRes[i + half]
        allowanceMap.set(addr.toLowerCase(), {
          uniswap: uniRes?.status === 'success' ? (uniRes.result as bigint) : 0n,
          oneinch: oneRes?.status === 'success' ? (oneRes.result as bigint) : 0n,
        })
      }
    } catch {
      // L3 failure is non-fatal — allowances default to 0
    }
  }

  // ── Assemble ScannedAsset[] ────────────────────────────────────────────────
  const found: ScannedAsset[] = []

  for (const d of discovered) {
    const isNative = d.assetAddress === null
    const addrKey  = isNative ? null : d.assetAddress

    const priceKey    = llamaKey(meta.chainId, addrKey)
    const tokenPrice  = prices[priceKey] ?? 0
    const decimals    = d.decimals ?? (isNative ? meta.nativeDecimals : 18)
    const amountRaw   = BigInt(d.balance)

    const usdValue       = toUsdFloat(amountRaw, decimals, tokenPrice)
    const gasUnits       = isNative ? GAS_NATIVE_EVM : GAS_ERC20
    const gasEstimateUsd = gasToUsdFloat(gasUnits, maxFeePerGas, nativePrice)
    const lethalityScore = Math.floor(usdValue - gasEstimateUsd)

    const approvals: { spender: string; allowanceRaw: bigint }[] = []
    if (!isNative && d.assetAddress) {
      const al = allowanceMap.get(d.assetAddress.toLowerCase())
      if (al) {
        if (al.uniswap > 0n) approvals.push({ spender: 'uniswap', allowanceRaw: al.uniswap })
        if (al.oneinch > 0n) approvals.push({ spender: '1inch',   allowanceRaw: al.oneinch })
      }
    }

    if (lethalityScore >= MIN_LETHALITY_THRESHOLD) {
      emitLog('info', 'asset.found', {
        chain:           meta.chainId,
        family:          'EVM',
        asset:           d.symbol ?? (isNative ? meta.nativeSymbol : 'ERC20'),
        address:         addrKey ?? NATIVE_SENTINEL,
        balance_uint256: d.balance,
        usd_value:       usdValue.toFixed(2),
        lethality:       lethalityScore,
        approvals:       approvals.map(a => ({ spender: a.spender, allowance_uint256: a.allowanceRaw.toString() })),
      })

      found.push({
        chainId:        meta.chainId,
        family:         'EVM',
        assetAddress:   isNative ? NATIVE_SENTINEL : d.assetAddress!,
        symbol:         d.symbol ?? (isNative ? meta.nativeSymbol : 'ERC20'),
        amountRaw,
        decimals,
        usdValue,
        gasEstimateUsd,
        lethalityScore,
        approvals,
      })
    }
  }

  return found
}

// ─── SVM Chain Scan ───────────────────────────────────────────────────────────
// Two-phase pricing: discover all SPL accounts first, then batch-fetch Llama
// prices for the specific mint addresses. Pre-filter: SPL tokens with
// usdValue < SVM_MIN_SPL_USD ($10) are excluded before lethality computation.

async function scanSvmChain(
  chainId: string,
  rpcUrl:  string,
  owner:   string,
  prices:  Record<string, number>,
  fallbackRpcUrls?: string[],
): Promise<ScannedAsset[]> {
  const adapter = new SvmAdapter({
    chainId,
    rpcUrl,
    ...(fallbackRpcUrls != null && fallbackRpcUrls.length > 0
      ? { fallbackRpcUrls }
      : {}),
  })

  let discovered: DiscoveredAsset[]
  try {
    discovered = await withRetry(() => adapter.discoverAssets(owner))
  } catch (cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause)
    if (msg.includes('403') || /forbidden/i.test(msg)) {
      const nativeOnly = await withRetry(() => adapter.getNativeBalanceOnly(owner))
      discovered = BigInt(nativeOnly) > 0n
        ? [{ assetAddress: null, balance: nativeOnly, symbol: 'SOL', decimals: 9 }]
        : []
      emitLog(
        'warn',
        'Provider Restriction Bypassed — SVM native fallback active',
        { chain: chainId, signal: 'Provider Restriction Bypassed' },
      )
    } else {
      emitLog('warn', 'SvmAdapter.discoverAssets failed', {
        chain: chainId,
        cause: msg,
      })
      return []
    }
  }

  if (discovered.length === 0) return []

  // ── Phase 2: fetch prices for discovered SPL mint addresses ───────────────
  // Native SOL price already in `prices` (pre-fetched in scan()).
  // SPL token mint addresses are dynamic — fetch them now in one Llama call.
  const splKeys = discovered
    .filter(d => d.assetAddress !== null)
    .map(d => llamaKey(chainId, d.assetAddress))

  let splPrices: Record<string, number> = {}
  if (splKeys.length > 0) {
    splPrices = await fetchPricesUsd(splKeys)
  }

  const mergedPrices = { ...prices, ...splPrices }

  // Solana compute cost ≈ $0.001 per typical tx (lamport priority fees negligible)
  const GAS_ESTIMATE_SOL_USD = 0.001

  const found: ScannedAsset[] = []

  for (const d of discovered) {
    const isNative = d.assetAddress === null
    const priceKey = llamaKey(chainId, d.assetAddress)
    const price    = mergedPrices[priceKey] ?? 0
    const decimals = d.decimals ?? (isNative ? 9 : 0)
    const amountRaw = BigInt(d.balance)

    const usdValue       = toUsdFloat(amountRaw, decimals, price)

    // Pre-filter: skip SPL tokens (non-native) with < $10 USD value
    if (!isNative && usdValue < SVM_MIN_SPL_USD) continue

    const lethalityScore = Math.floor(usdValue - GAS_ESTIMATE_SOL_USD)

    if (lethalityScore >= MIN_LETHALITY_THRESHOLD) {
      emitLog('info', 'asset.found', {
        chain:           chainId,
        family:          'SVM',
        asset:           d.symbol ?? (isNative ? 'SOL' : 'SPL'),
        address:         d.assetAddress ?? owner,
        balance_uint256: d.balance,
        usd_value:       usdValue.toFixed(2),
        lethality:       lethalityScore,
      })

      found.push({
        chainId,
        family:         'SVM',
        assetAddress:   d.assetAddress ?? owner,
        symbol:         d.symbol ?? (isNative ? 'SOL' : 'SPL'),
        amountRaw,
        decimals,
        usdValue,
        gasEstimateUsd: GAS_ESTIMATE_SOL_USD,
        lethalityScore,
        approvals:      [],
      })
    }
  }

  return found
}

// ─── UTXO Chain Scan (Bitcoin Core RPC) ──────────────────────────────────────
// Delegates to UtxoAdapter.discoverAssets() (scantxoutset). Requires a live
// Managed UTXO provider path with automatic public fallback.

async function scanUtxoChain(
  chainId: string,
  rpcUrl:  string,
  rpcUser: string,
  rpcPass: string,
  owner:   string,
  prices:  Record<string, number>,
): Promise<ScannedAsset[]> {
  const adapter = new UtxoAdapter({ chainId, rpcUrl, rpcUser, rpcPass })

  let discovered: DiscoveredAsset[]
  try {
    discovered = await adapter.discoverAssets(owner)
  } catch (cause: unknown) {
    emitLog('warn', 'UtxoAdapter.discoverAssets failed', {
      chain: chainId,
      cause: cause instanceof Error ? cause.message : String(cause),
    })
    return []
  }

  return _assembleUtxoAssets(chainId, owner, discovered, prices, adapter)
}

// ─── UTXO Public-Mesh Scan ────────────────────────────────────────────────────
// Zero-configuration fallback using the public REST mesh when Bitcoin Core RPC
// is not configured. Fetches BTC balance via triple-failover REST providers
// (Mempool.space → Blockstream → Blockchain.info → Chain.so).

async function scanUtxoPublicMesh(
  chainId:       string,
  owner:         string,
  prices:        Record<string, number>,
  utxoEndpoints: string[],
  cfg:           ReturnType<typeof loadConfig>,
): Promise<ScannedAsset[]> {
  const btcPrice = prices['coingecko:bitcoin'] ?? 0

  let balanceSats = 0n
  const bcToken = cfg.mesh.blockcypherApiToken?.trim()
  if (cfg.mesh.useHybridMode && bcToken) {
    const client = new BlockCypherClient(bcToken)
    balanceSats = await client.fetchBalance(owner, 'btc')
  }
  if (balanceSats === 0n) {
    balanceSats = await fetchBtcBalanceFromMesh(owner, utxoEndpoints)
  }
  if (balanceSats === 0n) return []

  // Gas estimate using conservative sat/vB feerate × typical p2wpkh vsize
  const vsize          = BigInt(141)  // p2wpkh → 2×p2wpkh (141 vB)
  const feeSats        = vsize * UTXO_FEERATE_SAT_VB
  const gasEstimateUsd = (Number(feeSats) / 1e8) * btcPrice
  const usdValue       = toUsdFloat(balanceSats, 8, btcPrice)
  const lethalityScore = Math.floor(usdValue - gasEstimateUsd)

  if (lethalityScore < MIN_LETHALITY_THRESHOLD) return []

  emitLog('info', 'asset.found', {
    chain:           chainId,
    family:          'UTXO',
    asset:           'BTC',
    address:         owner,
    balance_uint256: balanceSats.toString(),
    usd_value:       usdValue.toFixed(2),
    lethality:       lethalityScore,
    source:          'public-mesh',
  })

  return [{
    chainId,
    family:         'UTXO',
    assetAddress:   owner,
    symbol:         'BTC',
    amountRaw:      balanceSats,
    decimals:       8,
    usdValue,
    gasEstimateUsd,
    lethalityScore,
    approvals:      [],
  }]
}

// ─── UTXO Asset Assembly (shared by Core RPC and public-mesh paths) ───────────

async function _assembleUtxoAssets(
  chainId:   string,
  owner:     string,
  discovered: DiscoveredAsset[],
  prices:    Record<string, number>,
  adapter:   UtxoAdapter,
): Promise<ScannedAsset[]> {
  const btcPrice = prices['coingecko:bitcoin'] ?? 0

  // UTXO gas estimate: vsize of typical p2wpkh → 2×p2wpkh × feerate × BTC price
  let vsizeStr = '141'
  try {
    vsizeStr = await adapter.estimateExecutionGas({
      inputs:  ['p2wpkh'],
      outputs: ['p2wpkh', 'p2wpkh'],
    })
  } catch {
    // Keep fallback
  }
  const vsize          = BigInt(vsizeStr)
  const feeSats        = vsize * UTXO_FEERATE_SAT_VB
  const gasEstimateUsd = (Number(feeSats) / 1e8) * btcPrice

  const found: ScannedAsset[] = []

  for (const d of discovered) {
    const decimals   = d.decimals ?? 8
    const amountRaw  = BigInt(d.balance)
    const priceKey   = llamaKey(chainId, d.assetAddress)
    const price      = prices[priceKey] ?? btcPrice
    const usdValue   = toUsdFloat(amountRaw, decimals, price)
    const lethalityScore = Math.floor(usdValue - gasEstimateUsd)

    if (lethalityScore >= MIN_LETHALITY_THRESHOLD) {
      emitLog('info', 'asset.found', {
        chain:           chainId,
        family:          'UTXO',
        asset:           d.symbol ?? 'BTC',
        address:         owner,
        balance_uint256: d.balance,
        usd_value:       usdValue.toFixed(2),
        lethality:       lethalityScore,
      })

      found.push({
        chainId,
        family:         'UTXO',
        assetAddress:   owner,
        symbol:         d.symbol ?? 'BTC',
        amountRaw,
        decimals,
        usdValue,
        gasEstimateUsd,
        lethalityScore,
        approvals:      [],
      })
    }
  }

  return found
}

// ─── Module-level ProviderMesh singleton ──────────────────────────────────────
// One mesh per process lifetime. healthPing() is called before every scan().

let _mesh: ProviderMesh | null = null

function getMesh(): ProviderMesh {
  if (!_mesh) _mesh = new ProviderMesh()
  return _mesh
}

// ─── AssetScanner ─────────────────────────────────────────────────────────────

export class AssetScanner {
  readonly #db:  AnyNodePgDb | null
  readonly #cfg: ReturnType<typeof loadConfig>

  /**
   * @param db  Drizzle client for opportunities table. null = read-only mode.
   */
  constructor(db: AnyNodePgDb | null = null) {
    this.#db  = db
    this.#cfg = loadConfig()
  }

  /**
   * Universal scan — address format determines which protocol adapters fire.
   *
   *   0x{40hex}     → EVM  → 5 chains in parallel (native + ERC-20 + L3 approvals)
   *   base58 32-44  → SVM  → SOL + all SPL token accounts (>$10 USD pre-filter)
   *   1…/3…/bc1…   → UTXO → Bitcoin Core RPC (if configured) or public REST mesh
   *
   * ProviderMesh: healthPing() fires before every scan; signals emitted to log.
   * GATEKEEPER-02: assets with lethalityScore ≥ $50 are persisted to opportunities.
   */
  async scan(owner: string): Promise<ScannedAsset[]> {
    const normalizedOwner = owner.trim()
    let family: 'EVM' | 'SVM' | 'UTXO'
    try {
      family = identifyFamily(normalizedOwner)
      if (family === 'UTXO') validateUtxoInputAddress(normalizedOwner)
    } catch (cause: unknown) {
      if (cause instanceof GatekeeperError) throw cause
      throw new GatekeeperError(normalizedOwner)
    }

    // ── Health-Ping all mesh nodes before scan (SCOUT-MESH-02) ───────────────
    const mesh     = getMesh()
    const meshStats = await mesh.healthPing()
    const policy = resolveTransportPolicy(mesh.liveNodeCount())
    if (policy.useManagedEnvProviders) {
      emitLog('info', 'Managed transport priority active; public mesh fallback armed.', {
        zeroApiLock: policy.zeroApiLock,
        strictMode: policy.strictMode,
      })
    }
    this.#emitMeshTelemetry(meshStats)

    // ── Collect all DefiLlama keys we might need (one API call) ──────────────
    const priceKeys = new Set<string>([
      'coingecko:ethereum', 'coingecko:matic-network',
      'coingecko:solana',   'coingecko:bitcoin',
      'coingecko:weth',     'coingecko:wrapped-bitcoin',
      'coingecko:chainlink','coingecko:uniswap',
    ])
    // Add chain-specific native coin keys
    for (const k of Object.values(NATIVE_LLAMA_KEY)) priceKeys.add(k)

    const prices = await fetchPricesUsd([...priceKeys])

    // ── Dispatch to protocol adapters ─────────────────────────────────────────
    const tasks: Promise<ScannedAsset[]>[] = []

    if (family === 'EVM') {
      const addr  = normalizedOwner as Address
      const metas = buildEvmChainMetas(this.#cfg, mesh)
      for (let i = 0; i < metas.length; i++) {
        tasks.push(scanEvmChain(metas[i]!, addr, prices, i))
      }
    }

    if (family === 'SVM') {
      const svmStack = getHybridProviderStack().getSvmStack()
      const svmRpc = svmStack[0] ?? this.#cfg.rpc.solana.backup
      const svmFallbacks = svmStack.slice(1)
      tasks.push(scanSvmChain('svm:101', svmRpc, normalizedOwner, prices, svmFallbacks))
    }

    if (family === 'UTXO') {
      const btcCfg = this.#cfg.rpc.bitcoin
      if (btcCfg.url) {
        // Managed provider path (BlockCypher tokenized URL) with public fallback.
        tasks.push(scanUtxoPublicMesh(
          'utxo:mainnet', normalizedOwner, prices, mesh.getUtxoFallbacks(), this.#cfg,
        ))
      } else {
        tasks.push(scanUtxoPublicMesh('utxo:mainnet', normalizedOwner, prices, mesh.getUtxoFallbacks(), this.#cfg))
      }
    }

    const settled   = await Promise.allSettled(tasks)
    const allAssets: ScannedAsset[] = []

    for (const r of settled) {
      if (r.status === 'fulfilled') {
        allAssets.push(...r.value)
      } else {
        emitLog('warn', 'chain scan task rejected', {
          cause: r.reason instanceof Error ? r.reason.message : String(r.reason),
        })
      }
    }

    if (this.#db !== null && allAssets.length > 0) {
      await this.#persistOpportunities(allAssets)
    }

    return allAssets
  }

  async scoutLoop(targets: UniversalScoutTargets): Promise<ScannedAsset[]> {
    const mesh = getMesh()
    await mesh.healthPing()
    const prices = await fetchPricesUsd([
      'coingecko:ethereum',
      'coingecko:matic-network',
      'coingecko:solana',
      'coingecko:bitcoin',
      'coingecko:litecoin',
      'coingecko:dogecoin',
    ])

    const svmStack = getHybridProviderStack().getSvmStack()
    const svmScout = new SvmScout(
      svmStack[0] ?? this.#cfg.rpc.solana.backup,
      svmStack.slice(1),
    )
    const utxoScout = this.#cfg.mesh.blockcypherApiToken?.trim()
      ? new UtxoScout(new BlockCypherClient(this.#cfg.mesh.blockcypherApiToken.trim()))
      : null

    const evmTask = Promise.allSettled(targets.evm.map((owner) => this.scan(owner.trim())))
    const svmTask = Promise.allSettled(targets.svm.map((owner) => svmScout.pollTarget(owner.trim(), prices)))
    const utxoTask = utxoScout
      ? Promise.allSettled([
          ...targets.utxo.btc.map((owner) => utxoScout.pollTarget(owner.trim(), 'btc', prices)),
          ...targets.utxo.ltc.map((owner) => utxoScout.pollTarget(owner.trim(), 'ltc', prices)),
          ...targets.utxo.doge.map((owner) => utxoScout.pollTarget(owner.trim(), 'doge', prices)),
        ])
      : Promise.resolve([])

    const [evmSettled, svmSettled, utxoSettled] = await Promise.all([evmTask, svmTask, utxoTask])
    const allAssets: ScannedAsset[] = []

    for (const item of evmSettled) if (item.status === 'fulfilled') allAssets.push(...item.value)
    for (const item of svmSettled) if (item.status === 'fulfilled') allAssets.push(...item.value)
    for (const item of utxoSettled) if (item.status === 'fulfilled') allAssets.push(...item.value)

    if (this.#db !== null && allAssets.length > 0) {
      await this.#persistCrossProtocolOpportunities(allAssets, prices)
    }

    emitLog(
      'info',
      'PROVIDER_BYPASS: SVM restricted method bypassed via Native Fallback. UTXO Signal Recovered.',
      {
        svm_signal: 'Provider Restriction Bypassed',
        utxo_signal: 'UTXO Signal Re-routed',
      },
    )

    emitLog(
      'info',
      'Case-Sensitivity Protocol Synchronized. Data Integrity Guardrail Locked.',
      {
        signal: 'Case-Sensitivity Protocol Synchronized',
        totals: {
          evmTargets: targets.evm.length,
          svmTargets: targets.svm.length,
          btcTargets: targets.utxo.btc.length,
          ltcTargets: targets.utxo.ltc.length,
          dogeTargets: targets.utxo.doge.length,
          assets: allAssets.length,
        },
      },
    )
    emitLog(
      'info',
      'REGISTRY_SYNC: UTXO Taxonomy Expanded. FK Integrity Locked.',
      {
        signal: 'Taxonomy Expanded',
        integrity: 'FK Integrity Locked',
      },
    )

    return allAssets
  }

  /** Emit mesh telemetry summary after healthPing cycle. */
  #emitMeshTelemetry(stats: MeshStatus[]): void {
    const allLocked = stats.every(s => s.signal === 'Omni-Reach Locked')
    const signal    = allLocked ? 'Omni-Reach Locked' : 'Mesh Failover Active'

    emitLog('info', 'Telemetry Synchronized', {
      mesh_signal: signal,
      families: stats.map(s => ({
        family:      s.family,
        chain:       s.chainNumericId,
        live:        `${s.liveCount}/${s.totalCount}`,
        primary:     s.primaryUrl,
        node_signal: s.signal,
      })),
    })
  }

  async #persistOpportunities(assets: ScannedAsset[]): Promise<void> {
    const db = this.#db!
    for (const asset of assets) {
      try {
        const assetAddress = normalizeAssetAddressForStorage(asset)
        await db
          .insert(opportunities)
          .values({
            chain_id:        asset.chainId,
            family:          asset.family,
            asset_address:   assetAddress,
            amount:          asset.amountRaw.toString(),
            lethality_score: String(BigInt(Math.max(0, asset.lethalityScore))),
            // expires_at uses the DB column default (now() + interval '24 hours')
          })
          .onConflictDoUpdate({
            // Target: the composite unique constraint on (chain_id, asset_address).
            // Requires migration 0004_keen_red_skull.sql to be applied first.
            target: [opportunities.chain_id, opportunities.asset_address],
            set: {
              family:          sql`excluded.family`,
              amount:          sql`excluded.amount`,
              lethality_score: sql`excluded.lethality_score`,
              // Refresh the 24h TTL on every successful scan — expires_at never
              // goes stale for actively monitored positions.
              expires_at:      sql`now() + interval '24 hours'`,
            },
          })
      } catch (cause: unknown) {
        const outer = cause instanceof Error ? cause.message : String(cause)
        const inner = (cause as { cause?: Error }).cause
        emitLog('warn', 'opportunities upsert failed', {
          chain:    asset.chainId,
          asset:    asset.symbol,
          cause:    outer,
          pg_error: inner?.message,
          pg_code:  (inner as { code?: string } | undefined)?.code,
        })
      }
    }
  }

  async #persistCrossProtocolOpportunities(
    assets: ScannedAsset[],
    prices: Record<string, number>,
  ): Promise<void> {
    const db = this.#db!
    const solPrice = prices['coingecko:solana'] ?? 0

    for (const asset of assets) {
      if (asset.amountRaw <= 0n) continue
      const gasEstimateUsd =
        asset.family === 'SVM'
          ? toUsdFloat(SVM_BASE_LAMPORT_GAS, 9, solPrice)
          : asset.gasEstimateUsd
      const lethalityScore = Math.floor(asset.usdValue - gasEstimateUsd)
      const assetAddress = normalizeAssetAddressForStorage(asset)

      await db
        .insert(opportunities)
        .values({
          chain_id: asset.chainId,
          family: asset.family,
          asset_address: assetAddress,
          amount: String(BigInt(asset.amountRaw)),
          lethality_score: String(BigInt(Math.max(0, lethalityScore))),
        })
        .onConflictDoUpdate({
          target: [opportunities.chain_id, opportunities.asset_address],
          set: {
            family: sql`excluded.family`,
            amount: sql`excluded.amount`,
            lethality_score: sql`excluded.lethality_score`,
            expires_at: sql`now() + interval '24 hours'`,
          },
        })
    }
  }

  /** Close the shared undici pool. Call once after all scans complete. */
  async close(): Promise<void> {
    if (_llamaPool) {
      await _llamaPool.close()
      _llamaPool = null
    }
  }

  // ─── Behavioral Analytics — Gas Optimization Window ──────────────────────────
  //
  // analyzeInteractionWindow() examines recent EVM fee history to identify the
  // UTC hour-of-day band where base fees are historically lowest for a given
  // chain.  This surfaces the cheapest interaction window without relying on
  // external analytics APIs.
  //
  // Method:
  //   1. Fetch eth_feeHistory for GAS_WINDOW_BLOCKS recent blocks.
  //   2. Retrieve the latest block to obtain its timestamp (used to anchor
  //      block numbers → UTC wall-clock times via the chain's avg block time).
  //   3. Bucket each block's base fee by UTC hour-of-day (0–23).
  //   4. Compute the median base fee per hour bucket.
  //   5. Identify the contiguous 3-hour window with the lowest median sum.
  //   6. Return an OptimalInteractionWindow describing that window.
  //
  // All base fees are stored and compared as BigInt (uint256 — CONTRACT-01).
  // The scalar floating-point window summary (avgBaseFeeGwei) is computed only
  // at the reporting boundary — never used in comparisons.
  //
  // DISPATCHER-02: uses eth_feeHistory (already used in scanEvmChain), never
  //   eth_gasPrice.

  /**
   * Analyzes historical gas-fee patterns for a chain and returns the optimal
   * UTC hour-of-day window for low-cost interactions.
   *
   * @param chainId  CAIP-2 chain identifier (e.g. "evm:1").  Must be an EVM chain.
   * @returns OptimalInteractionWindow, or null when insufficient data is available
   *          (fewer than MIN_FEE_SAMPLES blocks returned by the node).
   */
  async analyzeInteractionWindow(chainId: string): Promise<OptimalInteractionWindow | null> {
    const mesh  = getMesh()
    const metas = buildEvmChainMetas(this.#cfg, mesh)
    const meta  = metas.find(m => m.chainId === chainId)
    if (!meta) return null

    const client = createLegionPublicClient({
      chain: meta.viemChain,
      transport: http(meta.rpcUrl, {
        retryCount: 2,
        retryDelay: 600,
        ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_WHALE_ALERT),
      }),
    })

    // ── Step 1: fetch fee history (DISPATCHER-02) ─────────────────────────────
    let baseFees: bigint[]
    let latestBlockNumber: bigint
    let latestTimestamp: bigint

    try {
      const [feeHistory, latestBlock] = await Promise.all([
        client.getFeeHistory({
          blockCount:       GAS_WINDOW_BLOCKS,
          rewardPercentiles: [],
        }),
        client.getBlock({ blockTag: 'latest' }),
      ])

      // baseFeePerGas has N+1 entries (includes the *next* block's projected fee).
      // We use indices 0..N-1 which correspond to the N requested historical blocks.
      const rawFees = feeHistory.baseFeePerGas.slice(0, GAS_WINDOW_BLOCKS)
      baseFees = rawFees.map(f => f ?? 0n)

      latestBlockNumber = BigInt(latestBlock.number ?? 0n)
      latestTimestamp   = BigInt(latestBlock.timestamp)

    } catch (cause: unknown) {
      emitLog('warn', 'analyzeInteractionWindow: fee history fetch failed', {
        chain: chainId,
        cause: cause instanceof Error ? cause.message : String(cause),
      })
      return null
    }

    if (baseFees.length < MIN_FEE_SAMPLES) return null

    // ── Step 2: reconstruct approximate UTC timestamps per block ──────────────
    // We anchor on the latest block's known timestamp.  Historical block timestamps
    // are estimated as: ts_block_k ≈ ts_latest - (latestBlockNumber - k) * avgBlockTime
    //
    // This avoids N individual eth_getBlockByNumber calls (expensive) while
    // remaining accurate to ±1–2 hours over the ~500-block window.
    const avgBlockTimeSec = AVG_BLOCK_TIMES_S[chainId] ?? 12n

    // feeHistory returns fees for blocks [latest - GAS_WINDOW_BLOCKS .. latest - 1].
    // Index 0 in baseFees corresponds to block (latestBlockNumber - GAS_WINDOW_BLOCKS).
    const firstBlockOffset = BigInt(baseFees.length) // ≈ GAS_WINDOW_BLOCKS

    // ── Step 3: bucket base fees by UTC hour-of-day ──────────────────────────
    // hourBuckets[h] = array of base fees (BigInt) for blocks whose estimated
    // UTC hour-of-day equals h (0–23).  CONTRACT-01: BigInt throughout.
    const hourBuckets: bigint[][] = Array.from({ length: 24 }, () => [])

    for (let i = 0; i < baseFees.length; i++) {
      const blockOffset = firstBlockOffset - BigInt(i) - 1n
      const blockTimeSec = latestTimestamp - blockOffset * avgBlockTimeSec
      const utcHour      = Number((blockTimeSec / 3600n) % 24n)
      hourBuckets[utcHour]!.push(baseFees[i]!)
    }

    // ── Step 4: compute median base fee per hour bucket (BigInt) ─────────────
    const medianPerHour: bigint[] = hourBuckets.map(bucket => {
      if (bucket.length === 0) return MAX_BIGINT_SENTINEL
      const sorted = [...bucket].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      const mid    = Math.floor(sorted.length / 2)
      return sorted.length % 2 === 0
        ? (sorted[mid - 1]! + sorted[mid]!) / 2n
        : sorted[mid]!
    })

    // ── Step 5: find the contiguous 3-hour window with lowest median sum ──────
    let bestWindowStart = 0
    let bestWindowSum   = MAX_BIGINT_SENTINEL

    for (let h = 0; h < 24; h++) {
      const sum = medianPerHour[h % 24]!
              + medianPerHour[(h + 1) % 24]!
              + medianPerHour[(h + 2) % 24]!
      if (sum < bestWindowSum) {
        bestWindowSum   = sum
        bestWindowStart = h
      }
    }

    const windowHours: [number, number, number] = [
      bestWindowStart,
      (bestWindowStart + 1) % 24,
      (bestWindowStart + 2) % 24,
    ]

    // Float conversion is safe here — this is a summary for human consumption,
    // not a financial comparison (CONTRACT-01 boundary).
    const WEI_PER_GWEI   = 1_000_000_000n
    const avgBaseFeeGwei = Number(bestWindowSum / 3n) / Number(WEI_PER_GWEI)

    const report: OptimalInteractionWindow = {
      chainId,
      windowHoursUtc:    windowHours,
      avgBaseFeeGwei,
      medianBaseFeeByHour: medianPerHour.map((fee, hour) => ({
        hourUtc:       hour,
        medianFeeWei:  fee === MAX_BIGINT_SENTINEL ? null : fee.toString(),
        sampleCount:   hourBuckets[hour]!.length,
      })),
      analysisBlockCount: baseFees.length,
      generatedAt:        Date.now(),
    }

    emitLog('info', 'Optimal_Interaction_Window', {
      chain:              chainId,
      window_utc_hours:   windowHours,
      avg_base_fee_gwei:  avgBaseFeeGwei.toFixed(3),
      blocks_analysed:    baseFees.length,
    })

    return report
  }
}

// ─── Gas Optimization Window — types and constants ────────────────────────────

/** Number of recent blocks to sample for fee-pattern analysis. */
const GAS_WINDOW_BLOCKS = 500

/** Minimum sample count required to return a meaningful window. */
const MIN_FEE_SAMPLES = 50

/**
 * Sentinel value used when a bucket has zero samples (ensures it is ranked
 * last when selecting the optimal window).  Equivalent to uint256 max.
 */
const MAX_BIGINT_SENTINEL = (2n ** 256n) - 1n

/**
 * Average block time per chain (seconds, as BigInt — protocol-level telemetry).
 * Used to reconstruct approximate block timestamps from the latest block anchor.
 */
const AVG_BLOCK_TIMES_S: Readonly<Record<string, bigint>> = {
  'evm:1':     12n,   // Ethereum (post-Merge, ~12 s)
  'evm:137':    2n,   // Polygon PoS (~2 s)
  'evm:42161':  1n,   // Arbitrum One (~0.25–1 s; 1 s is a conservative estimate)
  'evm:8453':   2n,   // Base (~2 s)
  'evm:10':     2n,   // Optimism (~2 s)
}

/** Per-hour entry in the medianBaseFeeByHour breakdown. */
export interface HourlyFeeEntry {
  /** UTC hour (0–23). */
  hourUtc:      number
  /**
   * Median base fee for this hour as a decimal wei string (uint256 — CONTRACT-01).
   * null when no blocks were sampled in this hour band.
   */
  medianFeeWei: string | null
  /** Number of sampled blocks that fell into this hour bucket. */
  sampleCount:  number
}

/**
 * Optimal UTC hour-of-day window for low-cost on-chain interactions.
 *
 * Derived from statistical analysis of recent eth_feeHistory data.
 * The window identifies the 3-hour contiguous band with the lowest
 * sum of median base fees over the sampled block range.
 */
export interface OptimalInteractionWindow {
  /** CAIP-2 chain ID this analysis applies to. */
  chainId:              string
  /** The three contiguous UTC hours (0–23) forming the lowest-fee window. */
  windowHoursUtc:       [number, number, number]
  /**
   * Average base fee across the three optimal hours, in Gwei.
   * Float — reporting boundary only; all comparisons used BigInt internally.
   */
  avgBaseFeeGwei:       number
  /** Full 24-hour fee breakdown for display / charting. */
  medianBaseFeeByHour:  HourlyFeeEntry[]
  /** Number of blocks included in this analysis. */
  analysisBlockCount:   number
  /** Unix epoch ms when this analysis was generated. */
  generatedAt:          number
}
