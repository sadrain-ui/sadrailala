/**
 * Flashloan arbitrage simulator — log-only Aave borrow → Uniswap v3 swap → repay on fork/testnet.
 * Never broadcasts; never targets production mainnet unless TESTNET=true.
 * Production path: `flashloan-executor.ts` (FLASHLOAN_ENABLED, mainnet, deployed receiver).
 */
import { createPublicClient, formatUnits, http, parseUnits, type Address } from 'viem'
import { sepolia } from 'viem/chains'

import {
  flashloanSimGuard,
  isSafeResearchForkUrl,
  type ResearchGuardSkip,
} from '../logic/security-research-guard.js'

export type FlashloanArbitrageSimParams = {
  /** DAI amount in human units (default 10_000). */
  borrow_amount_dai?: string
  /** Optional local Anvil / fork JSON-RPC (never mainnet unless TESTNET=true). */
  fork_url?: string
  /** Sepolia-style DAI address for fork bytecode probe. */
  dai_address?: Address
  /** Sepolia-style Uniswap v3 pool for fork probe. */
  pool_address?: Address
}

export type FlashloanArbitrageSimResult =
  | { ok: true; logs: string[]; profit_human: string; fork_block?: string }
  | { ok: false; skipped: true; reason: string }
  | ResearchGuardSkip

const DEFAULT_DAI_SEPOLIA = '0x94a9D9AC0a22568936eC3dA12a205bE9Bb740B12' as Address
const DEFAULT_POOL_SEPOLIA = '0x6Ae6Dba946048bE9c8bd1BFB1B1232acD7B0ee74' as Address

const FLASHLOAN_PREMIUM_BPS = 5n
const SWAP_FEE_BPS = 30n
const ARB_GAIN_BPS = 15n

function resolveForkUrl(override?: string): string | null {
  const raw =
    override?.trim() ||
    process.env['FLASHLOAN_SIM_FORK_URL']?.trim() ||
    process.env['ANVIL_FORK_URL']?.trim() ||
    ''
  if (!raw) return null
  if (!isSafeResearchForkUrl(raw)) return null
  return raw
}

function simulateProfitWei(borrowWei: bigint): {
  swapOut: bigint
  premium: bigint
  profit: bigint
} {
  const premium = (borrowWei * FLASHLOAN_PREMIUM_BPS) / 10_000n
  const afterSwap = (borrowWei * (10_000n - SWAP_FEE_BPS + ARB_GAIN_BPS)) / 10_000n
  const profit = afterSwap > borrowWei + premium ? afterSwap - borrowWei - premium : 0n
  return { swapOut: afterSwap, premium, profit }
}

async function probeFork(
  forkUrl: string,
  dai: Address,
  pool: Address,
): Promise<{ ok: boolean; block?: bigint; detail?: string }> {
  try {
    const client = createPublicClient({
      chain: sepolia,
      transport: http(forkUrl, { timeout: 8_000 }),
    })
    const block = await client.getBlockNumber()
    const daiCode = await client.getBytecode({ address: dai })
    const poolCode = await client.getBytecode({ address: pool })
    if (!daiCode || daiCode === '0x') {
      return { ok: false, detail: 'DAI contract not deployed on fork' }
    }
    if (!poolCode || poolCode === '0x') {
      return { ok: false, detail: 'Pool contract not deployed on fork (using math-only sim)' }
    }
    return { ok: true, block }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Simulate flashloan borrow (Aave) → Uniswap v3 swap → repay. Logs only; no broadcast.
 */
export async function simulateFlashloanArbitrage(
  params: FlashloanArbitrageSimParams = {},
): Promise<FlashloanArbitrageSimResult> {
  const guard = flashloanSimGuard()
  if (guard !== true) {
    return guard
  }

  const borrowHuman = params.borrow_amount_dai?.trim() || '10000'
  let borrowWei: bigint
  try {
    borrowWei = parseUnits(borrowHuman, 18)
  } catch {
    return { ok: false, skipped: true, reason: 'Invalid borrow_amount_dai' }
  }

  const dai = params.dai_address ?? DEFAULT_DAI_SEPOLIA
  const pool = params.pool_address ?? DEFAULT_POOL_SEPOLIA
  const forkUrl = resolveForkUrl(params.fork_url)

  const logs: string[] = []
  logs.push('[SIM] Flashloan arbitrage simulator — no broadcast, research only')

  let forkBlock: string | undefined
  if (forkUrl) {
    const probe = await probeFork(forkUrl, dai, pool)
    if (probe.block != null) {
      forkBlock = probe.block.toString()
      logs.push(`[SIM] Fork RPC ${forkUrl} at block ${forkBlock}`)
    } else {
      logs.push(`[SIM] Fork probe skipped: ${probe.detail ?? 'unavailable'} — math-only path`)
    }
  } else {
    logs.push('[SIM] No FLASHLOAN_SIM_FORK_URL / ANVIL_FORK_URL — math-only simulation')
  }

  const borrowDisplay = formatUnits(borrowWei, 18)
  logs.push(`[SIM] Borrowed ${borrowDisplay} DAI (Aave flashloan — simulated)`)
  console.info(logs[logs.length - 1])

  const { swapOut, premium, profit } = simulateProfitWei(borrowWei)
  const targetHuman = formatUnits(swapOut, 18)
  logs.push(`[SIM] Swapped ${borrowDisplay} DAI → ~${targetHuman} target token (Uniswap v3 — simulated)`)
  console.info(logs[logs.length - 1])

  const repayDisplay = formatUnits(borrowWei + premium, 18)
  logs.push(`[SIM] Repaid ${repayDisplay} DAI (principal + ${formatUnits(premium, 18)} fee)`)
  console.info(logs[logs.length - 1])

  const profitHuman = formatUnits(profit, 18)
  logs.push(`[SIM] Profit = ${profitHuman} DAI (simulated, no on-chain execution)`)
  console.info(logs[logs.length - 1])

  return {
    ok: true,
    logs,
    profit_human: profitHuman,
    ...(forkBlock ? { fork_block: forkBlock } : {}),
  }
}
