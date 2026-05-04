/**
 * @module @legion/core/logic/scout
 * Recursive Predator — institutional discovery registry (staking, LP, NFT floor priority).
 */

import { encodeFunctionData, parseAbi, type Address } from 'viem'

import { estimateUniswapV3MainnetLpUsd } from './recursive-predator-uniswap-v3.js'

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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
  }
}

function lamportsToSolString(raw: bigint): number {
  return Number(raw) / 1e9
}

/**
 * Recursive Predator fusion — parallel probes for Lido stETH, Marinade mSOL, JitoSOL; LP venues registered for Dispatcher mesh.
 */
export async function runRecursivePredatorFusionUsd(params: {
  evmRpcUrl: string
  solRpcUrl: string
  evmHolder?: Address | null
  solOwnerBase58?: string | null
  ethUsd: number
  solUsd: number
}): Promise<RecursivePredatorFusionUsd> {
  const out = baseRecursivePredatorFusionShell()
  const evm = params.evmHolder
  const rpcEvm = params.evmRpcUrl.trim()
  const rpcSol = params.solRpcUrl.trim()

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

  const sol = params.solOwnerBase58?.trim()
  if (sol && rpcSol) {
    tasks.push(
      (async () => {
        const raw = await probeRecursivePredatorSplMintBalanceRaw(rpcSol, sol, RECURSIVE_PREDATOR_MSOL_MINT)
        if (raw != null && raw > 0n) {
          out.staked_msol_usd = lamportsToSolString(raw) * params.solUsd
        }
      })(),
    )
    const jitoMint = resolveRecursivePredatorJitoSolMint()
    if (jitoMint) {
      tasks.push(
        (async () => {
          const raw = await probeRecursivePredatorSplMintBalanceRaw(rpcSol, sol, jitoMint)
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

  const solTrimmed = params.solOwnerBase58?.trim()
  if (solTrimmed && rpcSol) {
    tasks.push(
      (async () => {
        out.lp_raydium_usd = await probeRecursivePredatorRaydiumLpUsd(
          rpcSol,
          solTrimmed,
          params.solUsd,
        )
      })(),
    )
  }

  await Promise.allSettled(tasks)

  /** Pancake V3 (BNB) — venue pinned; desk extends via dedicated mesh when cross-chain density is required. */
  out.lp_pancake_v3_usd = 0

  /** NFT floor — Punks / Apes instant liquidation priority once holder ↔ collection proofs land on the mesh. */
  out.nft_floor_signal_usd = 0

  return out
}
