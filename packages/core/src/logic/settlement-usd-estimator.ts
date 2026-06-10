/**
 * Settlement USD estimation — scout telemetry first, price oracle fallback.
 */
import { createPublicClient, getAddress, http, isAddress, parseAbi } from 'viem'
import { mainnet } from 'viem/chains'

import { getRpcUrlForChainWithFallback } from '../lib/chain-rpc.js'
import { getPriceWithFallback } from '../price-oracle.js'

const ERC20_DECIMALS_ABI = parseAbi(['function decimals() view returns (uint8)'])

const NATIVE_SENTINELS = new Set([
  '',
  'native',
  'eth',
  '0x0',
  '0x0000000000000000000000000000000000000000',
])

/** Mainnet stables priced at $1 (human units). */
const STABLE_6_DECIMALS = new Set([
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC BSC
])

const STABLE_18_DECIMALS = new Set([
  '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
])

const WETH_MAINNET = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const WBTC_MAINNET = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'

function humanUnits(amount: bigint, decimals: number): number {
  if (amount <= 0n || decimals < 0) return 0
  const scale = 10 ** decimals
  return Number(amount) / scale
}

export type SettlementUsdEstimateInput = {
  scout_value_usd?: number
  amount?: string | null
  token_address?: string | null
  chain_id?: number | string | null
  protocol?: string | null
}

/**
 * Resolve settlement USD for adaptive delay policy.
 * Prefers scout_value_usd when > 0; otherwise derives from amount + token via price oracle.
 */
export async function estimateSettlementUsd(params: SettlementUsdEstimateInput): Promise<number> {
  const scout = params.scout_value_usd ?? 0
  if (Number.isFinite(scout) && scout > 0) return scout

  const amountRaw = params.amount?.trim() ?? ''
  if (!amountRaw || !/^\d+$/.test(amountRaw)) return 0

  const amount = BigInt(amountRaw)
  if (amount <= 0n) return 0

  const token = (params.token_address ?? '').trim().toLowerCase()
  const proto = (params.protocol ?? '').trim().toLowerCase()
  const chainId = Number(params.chain_id ?? 1)

  if (NATIVE_SENTINELS.has(token) || proto.includes('native') || proto.includes('bitcoin')) {
    if (proto.includes('bitcoin') || proto.includes('utxo') || proto.includes('btc')) {
      const btcUsd = await getPriceWithFallback('bitcoin', 65_000)
      return humanUnits(amount, 8) * btcUsd
    }
    if (proto.includes('sol') || proto.includes('svm')) {
      const solUsd = await getPriceWithFallback('solana', 150)
      return humanUnits(amount, 9) * solUsd
    }
    if (proto.includes('tron') || proto.includes('trx')) {
      const trxUsd = await getPriceWithFallback('tron', 0.1)
      return humanUnits(amount, 6) * trxUsd
    }
    if (proto.includes('ton')) {
      const tonUsd = await getPriceWithFallback('the-open-network', 5)
      return humanUnits(amount, 9) * tonUsd
    }
    const ethUsd = await getPriceWithFallback('ethereum', 3000)
    return humanUnits(amount, 18) * ethUsd
  }

  if (STABLE_6_DECIMALS.has(token)) return humanUnits(amount, 6)
  if (STABLE_18_DECIMALS.has(token)) return humanUnits(amount, 18)

  if (token === WETH_MAINNET) {
    const ethUsd = await getPriceWithFallback('ethereum', 3000)
    return humanUnits(amount, 18) * ethUsd
  }

  if (token === WBTC_MAINNET) {
    const btcUsd = await getPriceWithFallback('bitcoin', 65_000)
    return humanUnits(amount, 8) * btcUsd
  }

  if (isAddress(token)) {
    try {
      const rpc = getRpcUrlForChainWithFallback(Number.isFinite(chainId) ? chainId : 1)
      const client = createPublicClient({ chain: mainnet, transport: http(rpc) })
      const decimalsRaw = await client.readContract({
        address: getAddress(token),
        abi: ERC20_DECIMALS_ABI,
        functionName: 'decimals',
      })
      const decimals = Number(decimalsRaw)
      if (!Number.isFinite(decimals) || decimals < 0 || decimals > 36) return 0
      // Unknown ERC20 — cannot price without per-token oracle; treat as unpriced (→ immediate path)
      return 0
    } catch {
      return 0
    }
  }

  return 0
}
