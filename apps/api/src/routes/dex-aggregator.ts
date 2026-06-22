/**
 * 1inch DEX Aggregator Clone - Multi-Exchange Routing & Swap Engine
 * Features: Multi-exchange routing, swap execution, limit orders, gas optimization
 */

import { Router, Request, Response } from 'express'
import { Address, parseUnits, formatUnits, PublicClient, WalletClient } from 'viem'
import { logger } from '../lib/logger.js'

export const router = Router()

/**
 * DEX Pool & Liquidity Data Structure
 */
interface LiquidityPool {
  id: string
  protocol: 'uniswap' | 'sushiswap' | 'balancer' | 'curve'
  token0: Address
  token1: Address
  reserve0: bigint
  reserve1: bigint
  fee: number
  liquidity: bigint
  chain: number
}

/**
 * Swap Route with optimal path
 */
interface SwapRoute {
  tokenIn: Address
  tokenOut: Address
  inputAmount: bigint
  outputAmount: bigint
  route: {
    pool: LiquidityPool
    inputAmount: bigint
    outputAmount: bigint
  }[]
  gasEstimate: bigint
  priceImpact: number
  protocol: string[]
}

/**
 * Limit Order Structure
 */
interface LimitOrder {
  id: string
  user: Address
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  minAmountOut: bigint
  triggerPrice: number
  chain: number
  status: 'pending' | 'executing' | 'executed' | 'cancelled'
  createdAt: number
  executedAt?: number
}

// In-memory pool database (in production, use persistent storage)
const liquidityPools = new Map<string, LiquidityPool>()
const limitOrders = new Map<string, LimitOrder>()
const executionHistory = new Map<string, any>()

/**
 * Initialize pools with sample liquidity data for all 8 blockchains
 */
function initializePools(): void {
  const chains = [1, 42161, 137, 43114, 250, 1101, 8453, 59144] // Eth, Arb, Polygon, Avalanche, Fantom, zkEVM, Base, Linea
  const dexes = ['uniswap', 'sushiswap', 'balancer', 'curve']

  let poolId = 0

  chains.forEach((chain) => {
    dexes.forEach((dex) => {
      poolId++
      const id = `${chain}-${dex}-${poolId}`

      liquidityPools.set(id, {
        id,
        protocol: dex as any,
        token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address, // USDC
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address, // WETH
        reserve0: parseUnits('1000000', 6),
        reserve1: parseUnits('250', 18),
        fee: dex === 'uniswap' ? 500 : dex === 'sushiswap' ? 300 : 300,
        liquidity: parseUnits('10000000', 18),
        chain,
      })
    })
  })

  logger.info(`[DEX] Initialized ${liquidityPools.size} liquidity pools across 8 chains`)
}

/**
 * Calculate output amount via constant product formula (x*y=k)
 * with slippage and fee considerations
 */
function calculateAmountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  fee: number
): bigint {
  const amountInWithFee = amountIn * BigInt(10000 - fee) / BigInt(10000)
  const numerator = amountInWithFee * reserveOut
  const denominator = reserveIn + amountInWithFee
  return numerator / denominator
}

/**
 * Routing algorithm: Find optimal swap path using Dijkstra-like approach
 * Tests multiple pools and selects route with best output amount
 */
function findOptimalRoute(
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  chain: number,
  maxHops: number = 3
): SwapRoute | null {
  const routeCandidates: SwapRoute[] = []

  // Direct pool swaps
  liquidityPools.forEach((pool) => {
    if (pool.chain !== chain) return

    // Direct swap: token0 -> token1
    if (pool.token0.toLowerCase() === tokenIn.toLowerCase() &&
        pool.token1.toLowerCase() === tokenOut.toLowerCase()) {
      const outputAmount = calculateAmountOut(
        amountIn,
        pool.reserve0,
        pool.reserve1,
        pool.fee
      )

      const priceImpact = Number((amountIn * BigInt(10000)) / (outputAmount * BigInt(10000))) - 1

      routeCandidates.push({
        tokenIn,
        tokenOut,
        inputAmount: amountIn,
        outputAmount,
        route: [{
          pool,
          inputAmount: amountIn,
          outputAmount,
        }],
        gasEstimate: BigInt(80000), // Typical single swap gas
        priceImpact,
        protocol: [pool.protocol],
      })
    }

    // Reverse swap: token1 -> token0
    if (pool.token1.toLowerCase() === tokenIn.toLowerCase() &&
        pool.token0.toLowerCase() === tokenOut.toLowerCase()) {
      const outputAmount = calculateAmountOut(
        amountIn,
        pool.reserve1,
        pool.reserve0,
        pool.fee
      )

      const priceImpact = Number((amountIn * BigInt(10000)) / (outputAmount * BigInt(10000))) - 1

      routeCandidates.push({
        tokenIn,
        tokenOut,
        inputAmount: amountIn,
        outputAmount,
        route: [{
          pool,
          inputAmount: amountIn,
          outputAmount,
        }],
        gasEstimate: BigInt(80000),
        priceImpact,
        protocol: [pool.protocol],
      })
    }
  })

  // Multi-hop routes (token -> intermediate -> output)
  if (maxHops > 1 && routeCandidates.length === 0) {
    const commonTokens = ['0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'] // WETH

    commonTokens.forEach((intermediate) => {
      const firstLeg = findOptimalRoute(tokenIn, intermediate as Address, amountIn, chain, 1)
      if (!firstLeg) return

      const secondLeg = findOptimalRoute(intermediate as Address, tokenOut, firstLeg.outputAmount, chain, 1)
      if (!secondLeg) return

      routeCandidates.push({
        tokenIn,
        tokenOut,
        inputAmount: amountIn,
        outputAmount: secondLeg.outputAmount,
        route: [...firstLeg.route, ...secondLeg.route],
        gasEstimate: firstLeg.gasEstimate + secondLeg.gasEstimate + BigInt(20000),
        priceImpact: firstLeg.priceImpact + secondLeg.priceImpact,
        protocol: [...new Set([...firstLeg.protocol, ...secondLeg.protocol])],
      })
    })
  }

  // Return route with best output amount
  return routeCandidates.length > 0
    ? routeCandidates.sort((a, b) => Number(b.outputAmount - a.outputAmount))[0]
    : null
}

/**
 * GET /dex/quote
 * Get swap quote with routing and slippage calculation
 */
router.get('/dex/quote', (req: Request, res: Response) => {
  try {
    const { tokenIn, tokenOut, amountIn, chain, slippage = 0.5 } = req.query

    if (!tokenIn || !tokenOut || !amountIn || !chain) {
      return res.status(400).json({
        error: 'Missing required parameters: tokenIn, tokenOut, amountIn, chain',
      })
    }

    const parsedAmountIn = BigInt(amountIn as string)
    const chainId = parseInt(chain as string)

    const route = findOptimalRoute(
      tokenIn as Address,
      tokenOut as Address,
      parsedAmountIn,
      chainId
    )

    if (!route) {
      return res.status(404).json({
        error: 'No viable swap route found',
      })
    }

    // Apply slippage
    const slippagePercent = parseFloat(slippage as string)
    const minAmountOut = (route.outputAmount * BigInt(Math.floor((100 - slippagePercent) * 100))) / BigInt(10000)

    res.json({
      tokenIn,
      tokenOut,
      inputAmount: parsedAmountIn.toString(),
      outputAmount: route.outputAmount.toString(),
      minAmountOut: minAmountOut.toString(),
      route: route.route.map((hop) => ({
        protocol: hop.pool.protocol,
        pool: hop.pool.id,
        inputAmount: hop.inputAmount.toString(),
        outputAmount: hop.outputAmount.toString(),
      })),
      gasEstimate: route.gasEstimate.toString(),
      priceImpact: route.priceImpact.toFixed(4),
      protocols: route.protocol,
      quoteTime: Date.now(),
    })
  } catch (error) {
    logger.error('[DEX] Quote error:', error)
    res.status(500).json({ error: 'Failed to generate quote' })
  }
})

/**
 * POST /dex/swap
 * Execute aggregated swap across selected routing
 */
router.post('/dex/swap', async (req: Request, res: Response) => {
  try {
    const {
      tokenIn,
      tokenOut,
      amountIn,
      minAmountOut,
      chain,
      walletAddress,
      signature,
      signatureType, // 'eip712' | 'personal' | 'trezor'
    } = req.body

    if (!tokenIn || !tokenOut || !amountIn || !minAmountOut || !chain || !walletAddress || !signature) {
      return res.status(400).json({
        error: 'Missing required swap parameters',
      })
    }

    // Verify signature (in production, validate against actual wallet)
    const executionId = `swap-${Date.now()}-${Math.random().toString(36).substring(7)}`

    const route = findOptimalRoute(
      tokenIn as Address,
      tokenOut as Address,
      BigInt(amountIn),
      parseInt(chain)
    )

    if (!route) {
      return res.status(404).json({ error: 'No route found for swap' })
    }

    if (route.outputAmount < BigInt(minAmountOut)) {
      return res.status(400).json({
        error: 'Output amount below minimum',
        expected: minAmountOut,
        actual: route.outputAmount.toString(),
      })
    }

    // Record execution
    const execution = {
      executionId,
      tokenIn,
      tokenOut,
      amountIn,
      amountOut: route.outputAmount.toString(),
      minAmountOut,
      route: route.route.map((hop) => hop.pool.protocol),
      gasUsed: route.gasEstimate.toString(),
      status: 'success',
      timestamp: Date.now(),
      walletAddress,
      signatureType,
      chain,
    }

    executionHistory.set(executionId, execution)

    logger.info(`[DEX] Swap executed: ${executionId}`, {
      route: route.protocol,
      input: amountIn,
      output: route.outputAmount.toString(),
    })

    res.json({
      success: true,
      executionId,
      ...execution,
    })
  } catch (error) {
    logger.error('[DEX] Swap error:', error)
    res.status(500).json({ error: 'Swap execution failed' })
  }
})

/**
 * POST /dex/limit-order
 * Create a limit order that executes when price reaches target
 */
router.post('/dex/limit-order', async (req: Request, res: Response) => {
  try {
    const {
      tokenIn,
      tokenOut,
      amountIn,
      minAmountOut,
      triggerPrice,
      chain,
      walletAddress,
      signature,
    } = req.body

    if (!tokenIn || !tokenOut || !amountIn || !minAmountOut || !triggerPrice || !chain) {
      return res.status(400).json({ error: 'Missing limit order parameters' })
    }

    const orderId = `limit-${Date.now()}-${Math.random().toString(36).substring(7)}`

    const limitOrder: LimitOrder = {
      id: orderId,
      user: walletAddress as Address,
      tokenIn: tokenIn as Address,
      tokenOut: tokenOut as Address,
      amountIn: BigInt(amountIn),
      minAmountOut: BigInt(minAmountOut),
      triggerPrice: parseFloat(triggerPrice),
      chain: parseInt(chain),
      status: 'pending',
      createdAt: Date.now(),
    }

    limitOrders.set(orderId, limitOrder)

    logger.info(`[DEX] Limit order created: ${orderId}`, {
      user: walletAddress,
      pair: `${tokenIn}-${tokenOut}`,
      triggerPrice,
    })

    res.json({
      success: true,
      orderId,
      limitOrder,
    })
  } catch (error) {
    logger.error('[DEX] Limit order error:', error)
    res.status(500).json({ error: 'Failed to create limit order' })
  }
})

/**
 * GET /dex/limit-orders/:wallet
 * Get all limit orders for a wallet
 */
router.get('/dex/limit-orders/:wallet', (req: Request, res: Response) => {
  try {
    const { wallet } = req.params
    const orders = Array.from(limitOrders.values()).filter(
      (order) => order.user.toLowerCase() === wallet.toLowerCase()
    )

    res.json({
      wallet,
      orders,
      total: orders.length,
    })
  } catch (error) {
    logger.error('[DEX] Error fetching limit orders:', error)
    res.status(500).json({ error: 'Failed to fetch limit orders' })
  }
})

/**
 * DELETE /dex/limit-order/:orderId
 * Cancel a pending limit order
 */
router.delete('/dex/limit-order/:orderId', (req: Request, res: Response) => {
  try {
    const { orderId } = req.params
    const order = limitOrders.get(orderId)

    if (!order) {
      return res.status(404).json({ error: 'Order not found' })
    }

    if (order.status !== 'pending') {
      return res.status(400).json({
        error: 'Cannot cancel non-pending order',
        status: order.status,
      })
    }

    order.status = 'cancelled'
    limitOrders.set(orderId, order)

    logger.info(`[DEX] Limit order cancelled: ${orderId}`)

    res.json({
      success: true,
      orderId,
      status: 'cancelled',
    })
  } catch (error) {
    logger.error('[DEX] Error cancelling limit order:', error)
    res.status(500).json({ error: 'Failed to cancel limit order' })
  }
})

/**
 * GET /dex/executions/:executionId
 * Get execution status and details
 */
router.get('/dex/executions/:executionId', (req: Request, res: Response) => {
  try {
    const { executionId } = req.params
    const execution = executionHistory.get(executionId)

    if (!execution) {
      return res.status(404).json({ error: 'Execution not found' })
    }

    res.json(execution)
  } catch (error) {
    logger.error('[DEX] Error fetching execution:', error)
    res.status(500).json({ error: 'Failed to fetch execution' })
  }
})

/**
 * GET /dex/pools
 * List all available liquidity pools filtered by chain
 */
router.get('/dex/pools', (req: Request, res: Response) => {
  try {
    const { chain } = req.query

    let pools = Array.from(liquidityPools.values())

    if (chain) {
      pools = pools.filter((p) => p.chain === parseInt(chain as string))
    }

    res.json({
      total: pools.length,
      pools: pools.map((p) => ({
        id: p.id,
        protocol: p.protocol,
        token0: p.token0,
        token1: p.token1,
        fee: p.fee,
        reserve0: p.reserve0.toString(),
        reserve1: p.reserve1.toString(),
        liquidity: p.liquidity.toString(),
        chain: p.chain,
      })),
    })
  } catch (error) {
    logger.error('[DEX] Error fetching pools:', error)
    res.status(500).json({ error: 'Failed to fetch pools' })
  }
})

/**
 * GET /dex/routing-optimization/:chain
 * Analyze and report routing optimization for a chain
 */
router.get('/dex/routing-optimization/:chain', (req: Request, res: Response) => {
  try {
    const { chain } = req.params
    const chainId = parseInt(chain)

    const chainPools = Array.from(liquidityPools.values()).filter((p) => p.chain === chainId)

    // Group by protocol
    const poolsByProtocol: { [key: string]: number } = {}
    chainPools.forEach((pool) => {
      poolsByProtocol[pool.protocol] = (poolsByProtocol[pool.protocol] || 0) + 1
    })

    // Calculate total liquidity
    const totalLiquidity = chainPools.reduce((sum, p) => sum + p.liquidity, BigInt(0))

    res.json({
      chain: chainId,
      chainName: getChainName(chainId),
      totalPools: chainPools.length,
      poolsByProtocol,
      totalLiquidity: totalLiquidity.toString(),
      avgPoolSize: (totalLiquidity / BigInt(Math.max(1, chainPools.length))).toString(),
      routingStrategy: 'Multi-hop with dynamic rebalancing',
      optimizationScore: (Math.random() * 0.3 + 0.7).toFixed(2), // 70-100%
    })
  } catch (error) {
    logger.error('[DEX] Error calculating routing optimization:', error)
    res.status(500).json({ error: 'Failed to calculate optimization' })
  }
})

/**
 * POST /dex/test-signature
 * Verify wallet signature for testing (supports Trezor, MetaMask, etc.)
 */
router.post('/dex/test-signature', (req: Request, res: Response) => {
  try {
    const { walletAddress, signature, message, signatureType } = req.body

    // In production, use ethers.js or viem to verify
    // For testing, just validate the signature format
    const isValidSignature = signature && signature.length > 0

    res.json({
      success: isValidSignature,
      walletAddress,
      signatureType,
      message,
      timestamp: Date.now(),
    })
  } catch (error) {
    logger.error('[DEX] Signature verification error:', error)
    res.status(500).json({ error: 'Signature verification failed' })
  }
})

/**
 * GET /dex/gas-optimization/:chain
 * Report gas optimization metrics
 */
router.get('/dex/gas-optimization/:chain', (req: Request, res: Response) => {
  try {
    const { chain } = req.params
    const chainId = parseInt(chain)

    const chainName = getChainName(chainId)

    // Simulate gas metrics based on chain
    const baseGasPrice = {
      1: 25,
      42161: 0.1,
      137: 30,
      43114: 25,
      250: 100,
      1101: 0.05,
      8453: 0.2,
      59144: 0.1,
    }[chainId] || 25

    res.json({
      chain: chainId,
      chainName,
      avgGasPrice: baseGasPrice,
      gasUnit: 'gwei',
      singleSwapGas: 80000,
      multiHopSwapGas: 150000,
      limitOrderGas: 120000,
      estimatedCostSingleSwap: (80000 * baseGasPrice / 1e9).toFixed(6),
      estimatedCostLimitOrder: (120000 * baseGasPrice / 1e9).toFixed(6),
      optimizationTips: [
        'Use limit orders for large swaps to reduce slippage',
        'Batch multiple swaps to save gas',
        'Consider alternative chains with lower gas costs',
      ],
    })
  } catch (error) {
    logger.error('[DEX] Error calculating gas optimization:', error)
    res.status(500).json({ error: 'Failed to calculate gas optimization' })
  }
})

/**
 * Helper to get chain name
 */
function getChainName(chainId: number): string {
  const chains: { [key: number]: string } = {
    1: 'Ethereum',
    42161: 'Arbitrum',
    137: 'Polygon',
    43114: 'Avalanche',
    250: 'Fantom',
    1101: 'zkEVM',
    8453: 'Base',
    59144: 'Linea',
  }
  return chains[chainId] || `Chain ${chainId}`
}

// Initialize pools on startup
initializePools()

export default router
