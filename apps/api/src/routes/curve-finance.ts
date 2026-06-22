import type { FastifyInstance } from 'fastify'

// Mock Curve Finance pool data
const mockPools = [
  {
    id: 'curve-usdc-usdt',
    name: '3pool (USDC/USDT/DAI)',
    address: '0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7',
    coins: ['USDC', 'USDT', 'DAI'],
    balances: ['500000000.50', '480000000.75', '520000000.25'],
    fee: 0.04,
    apy: 8.25,
    tvl: 1500000000,
  },
  {
    id: 'curve-steth-eth',
    name: 'stETH/ETH',
    address: '0xdc24316b9ae028f1497c275eb9192a3ea0f67022',
    coins: ['stETH', 'ETH'],
    balances: ['45000.123', '46000.456'],
    fee: 0.01,
    apy: 4.75,
    tvl: 2300000000,
  },
  {
    id: 'curve-frax-usdc',
    name: 'FRAX/USDC',
    address: '0x2dd7c9371965472e5a5fed08a9fc58b9830fc296',
    coins: ['FRAX', 'USDC'],
    balances: ['250000000.50', '249000000.75'],
    fee: 0.04,
    apy: 12.5,
    tvl: 800000000,
  },
  {
    id: 'curve-lusd-usdc',
    name: 'LUSD/USDC',
    address: '0xed279fdd56cb3471e61434b8fa271a3744282ea5',
    coins: ['LUSD', 'USDC'],
    balances: ['180000000.25', '179500000.50'],
    fee: 0.04,
    apy: 6.8,
    tvl: 450000000,
  },
]

export async function registerCurveFinanceRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/curve/pools - Fetch all pools
  app.get('/api/curve/pools', async (_request, reply) => {
    try {
      const totalTvl = mockPools.reduce((sum, pool) => sum + pool.tvl, 0)
      const avgApy = mockPools.reduce((sum, pool) => sum + pool.apy, 0) / mockPools.length

      return reply.send({
        pools: mockPools,
        totalTvl,
        avgApy,
        loadTime: Date.now(),
      })
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to fetch pools' })
    }
  })

  // GET /api/curve/quote - Get swap quote
  app.get<{ Querystring: { poolId?: string; tokenIn?: string; tokenOut?: string; amount?: string; slippage?: string } }>(
    '/api/curve/quote',
    async (request, reply) => {
      try {
        const { poolId, tokenIn, tokenOut, amount, slippage } = request.query

        if (!poolId || !tokenIn || !tokenOut || !amount) {
          return reply.status(400).send({ error: 'Missing required parameters' })
        }

        const amountNum = parseFloat(amount)
        const slippageNum = parseFloat(slippage || '0.5')

        // Mock swap quote calculation
        const pool = mockPools.find((p) => p.id === poolId)
        if (!pool) {
          return reply.status(404).send({ error: 'Pool not found' })
        }

        const priceImpact = Math.random() * 0.5 + 0.1 // 0.1% - 0.6%
        const amountOut = (amountNum * (1 - priceImpact / 100)).toFixed(6)
        const minAmountOut = (parseFloat(amountOut) * (1 - slippageNum / 100)).toFixed(6)
        const fee = (amountNum * (pool.fee / 100)).toFixed(6)

        return reply.send({
          amountOut,
          priceImpact,
          minAmountOut,
          fee,
        })
      } catch (error) {
        return reply.status(500).send({ error: 'Failed to fetch quote' })
      }
    },
  )

  // POST /api/curve/swap - Execute swap
  app.post<{ Body: { poolId: string; tokenIn: string; tokenOut: string; amountIn: string; minAmountOut: string } }>(
    '/api/curve/swap',
    async (request, reply) => {
      try {
        const { poolId, tokenIn, tokenOut, amountIn, minAmountOut } = request.body

        if (!poolId || !tokenIn || !tokenOut || !amountIn || !minAmountOut) {
          return reply.status(400).send({ error: 'Missing required parameters' })
        }

        // Mock swap execution
        const txHash = `0x${Math.random().toString(16).slice(2, 66)}`

        return reply.send({
          success: true,
          txHash,
          poolId,
          tokenIn,
          tokenOut,
          amountIn,
          timestamp: new Date().toISOString(),
        })
      } catch (error) {
        return reply.status(500).send({ error: 'Swap failed' })
      }
    },
  )

  // GET /api/curve/liquidity/quote - Get liquidity quote
  app.get<{ Querystring: Record<string, string> }>(
    '/api/curve/liquidity/quote',
    async (request, reply) => {
      try {
        const { poolId, ...amounts } = request.query
        const amountsParsed = Object.entries(amounts).reduce((acc, [key, val]) => {
          acc[key] = parseFloat(val)
          return acc
        }, {} as Record<string, number>)

        if (!poolId || Object.keys(amountsParsed).length === 0) {
          return reply.status(400).send({ error: 'Missing required parameters' })
        }

        const pool = mockPools.find((p) => p.id === poolId)
        if (!pool) {
          return reply.status(404).send({ error: 'Pool not found' })
        }

        const totalDeposited = Object.values(amountsParsed).reduce((sum, val) => sum + val, 0)
        const lpTokenAmount = (totalDeposited * (1 + Math.random() * 0.05)).toFixed(6)
        const poolShare = Math.random() * 0.001 // 0% - 0.1%
        const share = Math.random() * 100
        const fee = (totalDeposited * 0.001).toFixed(6)

        return reply.send({
          lpTokenAmount,
          share,
          poolShare,
          fee,
        })
      } catch (error) {
        return reply.status(500).send({ error: 'Failed to fetch liquidity quote' })
      }
    },
  )

  // POST /api/curve/liquidity/provide - Provide liquidity
  app.post<{ Body: { poolId: string; amounts: Record<string, string>; minLPTokens: string } }>(
    '/api/curve/liquidity/provide',
    async (request, reply) => {
      try {
        const { poolId, amounts, minLPTokens } = request.body

        if (!poolId || !amounts || !minLPTokens) {
          return reply.status(400).send({ error: 'Missing required parameters' })
        }

        const txHash = `0x${Math.random().toString(16).slice(2, 66)}`

        return reply.send({
          success: true,
          txHash,
          poolId,
          amounts,
          lpTokensMinted: minLPTokens,
          timestamp: new Date().toISOString(),
        })
      } catch (error) {
        return reply.status(500).send({ error: 'Liquidity provision failed' })
      }
    },
  )

  // GET /api/curve/yield/position - Get farming position
  app.get<{ Querystring: { poolId?: string } }>(
    '/api/curve/yield/position',
    async (request, reply) => {
      try {
        const { poolId } = request.query

        if (!poolId) {
          return reply.status(400).send({ error: 'Missing poolId' })
        }

        // Mock position data
        const position = {
          depositAmount: '5000.50',
          lpTokens: '4950.25',
          pendingRewards: '125.75',
          claimableRewards: '100.50',
          estimatedYearlyYield: '825.50',
          stakedDuration: '30 days',
          unlockDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        }

        return reply.send({
          position,
          lpBalance: '2500.75',
        })
      } catch (error) {
        return reply.status(500).send({ error: 'Failed to fetch position' })
      }
    },
  )

  // POST /api/curve/yield/stake - Stake LP tokens
  app.post<{ Body: { poolId: string; amount: string; lockDuration: number } }>(
    '/api/curve/yield/stake',
    async (request, reply) => {
      try {
        const { poolId, amount, lockDuration } = request.body

        if (!poolId || !amount || !lockDuration) {
          return reply.status(400).send({ error: 'Missing required parameters' })
        }

        const txHash = `0x${Math.random().toString(16).slice(2, 66)}`

        return reply.send({
          success: true,
          txHash,
          poolId,
          amount,
          lockDuration,
          unlockDate: new Date(Date.now() + lockDuration * 24 * 60 * 60 * 1000).toISOString(),
          timestamp: new Date().toISOString(),
        })
      } catch (error) {
        return reply.status(500).send({ error: 'Staking failed' })
      }
    },
  )

  // POST /api/curve/yield/claim - Claim rewards
  app.post<{ Body: { poolId: string } }>(
    '/api/curve/yield/claim',
    async (request, reply) => {
      try {
        const { poolId } = request.body

        if (!poolId) {
          return reply.status(400).send({ error: 'Missing poolId' })
        }

        const txHash = `0x${Math.random().toString(16).slice(2, 66)}`

        return reply.send({
          success: true,
          txHash,
          poolId,
          rewardsClaimed: '100.50',
          timestamp: new Date().toISOString(),
        })
      } catch (error) {
        return reply.status(500).send({ error: 'Claim failed' })
      }
    },
  )
}
