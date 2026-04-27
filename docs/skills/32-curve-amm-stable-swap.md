# SKILL-32: CURVE AMM — STABLE SWAP & DEEP LIQUIDITY EXTRACTION

SOURCE: https://github.com/curvefi/curve-contract

CATEGORY: LIQUIDITY — Scout / Closer Sentinels

[STRICT_RULES]
• ALWAYS use `get_dy` to simulate output BEFORE calling `exchange` — never submit blind swaps on Curve
• Curve pool addresses MUST be resolved via `Registry.find_pool_for_coins(tokenA, tokenB)` — never hardcode pool addresses
• Use `exchange_underlying` only for metapools (e.g., 3CRV meta) — use `exchange` for base pools to save gas
• `get_dy` uses indices (i, j) not token addresses — get correct indices via `Registry.get_coin_indices(pool, from, to)`
• Slippage check: `actual_out >= get_dy * (1 - MAX_SLIPPAGE)` — Curve has low but non-zero slippage on stable swaps
• For CryptoSwap (volatile) pools: `calc_token_amount` for LP math, different invariant from StableSwap
• NEVER use `exchange` with `min_dy = 0` — always compute minimum output from `get_dy` with slippage buffer
• Gauge rewards: call `claim_rewards(addr)` on LiquidityGauge after staking LP tokens — never leave rewards unclaimed
• Metapool unwrapping: `remove_liquidity_one_coin` to exit to underlying — check bonus vs direct swap first
• `Registry.vy` is the source of truth for all deployed pools — use it for discovery, not external APIs

[MENTAL_MODEL]
• Curve StableSwap = AMM optimized for correlated assets (stablecoins, LSTs) — lower slippage than Uniswap for these pairs
• `get_dy(i, j, dx)` → output amount for swapping dx of token[i] to token[j] — pure view, no gas cost
• `exchange(i, j, dx, min_dy)` → execute swap — reverts if actual output < min_dy
• Registry = on-chain directory of all Curve pools — `find_pool_for_coins(a, b)` returns best pool address
• LP tokens = proof of liquidity provision; stake in Gauge to earn CRV emissions + protocol fees
• Metapool: one asset paired with 3CRV (USDC/USDT/DAI) — provides exposure to entire Curve stable ecosystem
• A parameter (amplification): higher A = tighter peg, lower slippage near 1:1, less resilient to depegs
• CryptoSwap pools (Tricrypto): use different invariant for volatile assets (WBTC/ETH/USDT) — higher slippage tolerance

[REAL_API]
=== Registry Contract (Ethereum Mainnet) ===
const CURVE_REGISTRY = '0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f6'
const CURVE_ADDRESS_PROVIDER = '0x0000000022D53366457F9d5E68Ec105046FC4383'

const REGISTRY_ABI = parseAbi([
  'function find_pool_for_coins(address from, address to) view returns (address)',
  'function find_pool_for_coins(address from, address to, uint256 i) view returns (address)',
  'function get_coin_indices(address pool, address from, address to) view returns (int128, int128, bool)',
  'function get_best_rate(address from, address to, uint256 amount) view returns (address, uint256)'
])

const POOL_ABI = parseAbi([
  'function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)',
  'function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)',
  'function exchange_underlying(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)',
  'function calc_withdraw_one_coin(uint256 token_amount, int128 i) view returns (uint256)',
  'function remove_liquidity_one_coin(uint256 token_amount, int128 i, uint256 min_amount) returns (uint256)'
])

=== Viem: Find Best Pool and Quote ===
import { createPublicClient, http, parseAbi } from 'viem'
import { mainnet } from 'viem/chains'

export async function createCurveScout(rpcUrl: string) {
  const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) })

  async function getBestQuote(fromToken: `0x${string}`, toToken: `0x${string}`, amountIn: bigint) {
    // Registry finds best pool automatically
    const [bestPool, bestOutput] = await client.readContract({
      address: CURVE_REGISTRY, abi: REGISTRY_ABI,
      functionName: 'get_best_rate',
      args: [fromToken, toToken, amountIn]
    })
    return { pool: bestPool, amountOut: bestOutput }
  }

  async function getSwapQuote(pool: `0x${string}`, i: number, j: number, dx: bigint) {
    return client.readContract({
      address: pool, abi: POOL_ABI,
      functionName: 'get_dy',
      args: [i, j, dx]
    })
  }

  return { getBestQuote, getSwapQuote }
}

[LEGION USE CASES]
• Stable arb scanner: query `get_best_rate` across USDC/USDT/DAI triangle every block — capture depeg spreads >3 bps
• LST arb: monitor stETH/ETH Curve pool `get_dy` vs spot price — flash loan arb when spread > gas threshold
• LP position monitor: track gauge APY + CRV emissions via `claimable_reward` — optimize entry/exit timing
• Metapool exit routing: `calc_withdraw_one_coin` all coins to find cheapest exit path from LP position
• Slippage map: build `amountIn → get_dy` curve to find optimal chunk size for large trades on Curve
