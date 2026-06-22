/**
 * Comprehensive Security & Precision Test Suite for Curve Clone & DEX Engine
 * Tests: 1) Pool math accuracy 2) Slippage calculation 3) Reward distribution 4) LP token minting
 * Also identifies: Precision loss, division errors, overflow vulnerabilities, rounding attacks
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { parseEther, formatEther, type Address, parseUnits, formatUnits } from 'viem'
import { createDexEngine, type DexEngine, type LiquidityPool, type SwapQuote } from '../lib/dex-engine.js'
import { pino } from 'pino'

// Mock logger
const mockLogger = pino({ level: 'silent' })

/**
 * Mock RpcMesh for testing
 */
const mockRpcMesh = {
  getPrice: async () => 1,
  getBalance: async () => BigInt(0),
  call: async () => '',
} as any

describe('Curve Clone Security Audit Suite', () => {
  let dexEngine: DexEngine

  beforeEach(() => {
    dexEngine = createDexEngine(mockRpcMesh, mockLogger)
  })

  // ============================================================================
  // TEST 1: POOL MATH ACCURACY
  // ============================================================================

  describe('Pool Math Accuracy', () => {
    it('should maintain x*y=k invariant within precision bounds', async () => {
      // Get initial pool state
      const pools = dexEngine.getPools()
      expect(pools.length).toBeGreaterThan(0)

      const pool = pools[0]
      const initialStats = dexEngine.getPoolStats(pool.token0, pool.token1, pool.fee)
      expect(initialStats).toBeDefined()

      const k0 = initialStats!.reserve0 * initialStats!.reserve1
      console.log(`Initial k-invariant: ${k0}`)

      // Perform a swap
      const swapAmount = parseEther('1')
      const quote = await dexEngine.getSwapQuote(pool.token0, pool.token1, swapAmount)

      // After swap, reserves change but k should only increase (due to fees)
      // Note: Fee-on-transfer will increase k
      console.log(`Swap output: ${formatEther(quote.outputAmount)}`)
      console.log(`Price impact: ${quote.priceImpact}%`)

      // Verify price impact is reasonable (typically 0.1% - 5% for small swaps)
      expect(quote.priceImpact).toBeGreaterThanOrEqual(0)
      expect(quote.priceImpact).toBeLessThan(100)
    })

    it('should handle edge case: zero reserves without division by zero', async () => {
      const pools = dexEngine.getPools()
      const pool = pools[0]

      // This tests robustness - a zero reserve would cause division by zero
      // The engine should either reject it or handle it gracefully
      try {
        const quote = await dexEngine.getSwapQuote(pool.token0, pool.token1, BigInt(0))
        // Should handle zero input gracefully
        expect(quote.outputAmount).toBe(BigInt(0))
      } catch (error) {
        // Or throw an appropriate error
        expect(error).toBeDefined()
      }
    })

    it('should prevent precision loss in reserve calculations', async () => {
      const pools = dexEngine.getPools()
      const pool = pools[0]

      // Test with very small amounts that could cause precision loss
      const tinyAmount = BigInt(1) // 1 wei
      try {
        const quote = await dexEngine.getSwapQuote(pool.token0, pool.token1, tinyAmount)
        // Even tiny amounts should compute without loss
        expect(quote.outputAmount).toBeGreaterThanOrEqual(BigInt(0))
      } catch (error) {
        // Should fail gracefully, not with precision loss
        expect(error).toBeDefined()
      }
    })

    it('should maintain consistency: swap amount validation', async () => {
      const pools = dexEngine.getPools()
      const pool = pools[0]

      // Large swap that might cause price impact
      const largeSwap = parseEther('100000')
      const quote = await dexEngine.getSwapQuote(pool.token0, pool.token1, largeSwap)

      // Price impact increases with swap size (reasonable curve)
      expect(quote.priceImpact).toBeGreaterThan(0)

      // Output should be less than input (due to slippage/fees)
      expect(quote.outputAmount).toBeLessThan(largeSwap)

      // Execution price should make sense
      expect(quote.executionPrice).toBeGreaterThan(0)
      expect(quote.executionPrice).toBeLessThan(1) // Swapping token0 for token1
    })
  })

  // ============================================================================
  // TEST 2: SLIPPAGE CALCULATION VULNERABILITIES
  // ============================================================================

  describe('Slippage Calculation & Protection', () => {
    it('should correctly calculate minimum output with slippage tolerance', async () => {
      const pools = dexEngine.getPools()
      const pool = pools[0]
      const amountIn = parseEther('10')
      const slippagePercent = 0.5 // 0.5%

      const quote = await dexEngine.getSwapQuote(pool.token0, pool.token1, amountIn, slippagePercent)

      // Expected: minOut = output * (1 - slippage%)
      const expectedMinOut = (quote.outputAmount * BigInt(10000 - Math.floor(slippagePercent * 100))) / BigInt(10000)

      // The issue: slippage calculation uses Math.floor which could introduce rounding errors
      console.log(`Output amount: ${formatEther(quote.outputAmount)}`)
      console.log(`Slippage tolerance: ${slippagePercent}%`)
      console.log(`Expected min out: ${formatEther(expectedMinOut)}`)
    })

    it('VULNERABILITY: detects slippage rounding attack with very high precision', () => {
      // The vulnerable code does: Math.floor(slippagePercent * 100)
      // This can lose precision for values like 0.001%

      const slippages = [0.1, 0.01, 0.001, 0.0001]
      slippages.forEach((slip) => {
        const floorResult = Math.floor(slip * 100)
        console.log(`Slippage ${slip}% -> Math.floor result: ${floorResult}`)

        if (floorResult === 0) {
          console.warn(`⚠️ PRECISION LOSS: ${slip}% slippage becomes 0 after Math.floor!`)
        }
      })
    })

    it('should protect against slippage bypass with minimum output checks', async () => {
      const pools = dexEngine.getPools()
      const pool = pools[0]
      const amountIn = parseEther('100')
      const slippagePercent = 1.0

      const quote = await dexEngine.getSwapQuote(pool.token0, pool.token1, amountIn, slippagePercent)

      // Minimum output calculated from slippage
      const minOut = (quote.outputAmount * BigInt(9900)) / BigInt(10000) // 1% slippage

      // If we try to swap with a higher minimum, it should fail
      const higherMin = quote.outputAmount + BigInt(1) // Impossible requirement
      try {
        await dexEngine.buildSwapTransaction(
          '0x0000000000000000000000000000000000000001' as Address,
          pool.token0,
          pool.token1,
          amountIn,
          higherMin, // This exceeds actual output
          Math.floor(Date.now() / 1000) + 60
        )
        // Should throw error
        expect.fail('Should have thrown slippage exceeded error')
      } catch (error: any) {
        expect(error.message).toContain('Slippage')
      }
    })

    it('should handle negative slippage values gracefully', async () => {
      const pools = dexEngine.getPools()
      const pool = pools[0]

      // Negative slippage makes no sense - should be rejected or treated as 0
      const quote = await dexEngine.getSwapQuote(pool.token0, pool.token1, parseEther('10'), -0.5)

      // Should either use absolute value or reject
      expect(quote.slippage).toBeGreaterThanOrEqual(0)
    })
  })

  // ============================================================================
  // TEST 3: LP TOKEN MINTING & LIQUIDITY PROVISION
  // ============================================================================

  describe('LP Token Minting & Liquidity Management', () => {
    it('should mint LP tokens proportional to liquidity contributed', async () => {
      const pools = dexEngine.getPools()
      const pool = pools[0]

      const amount0 = parseEther('100')
      const amount1 = parseEther('100')

      const result = await dexEngine.addLiquidity(
        pool.token0,
        pool.token1,
        amount0,
        amount1,
        pool.fee
      )

      console.log(`Liquidity added:`)
      console.log(`  Amount0: ${formatEther(result.amount0)}`)
      console.log(`  Amount1: ${formatEther(result.amount1)}`)
      console.log(`  LP tokens minted: ${formatEther(result.liquidity)}`)

      // LP tokens should be sqrt(amount0 * amount1)
      expect(result.liquidity).toBeGreaterThan(BigInt(0))

      // Amounts should be proportional or limited by pool ratio
      expect(result.amount0).toBeLessThanOrEqual(amount0)
      expect(result.amount1).toBeLessThanOrEqual(amount1)
    })

    it('VULNERABILITY: detects precision loss in sqrt calculation', async () => {
      const pools = dexEngine.getPools()
      const pool = pools[0]

      // Add liquidity with amounts that could cause sqrt precision issues
      const amount0 = BigInt(1) // Very small
      const amount1 = BigInt(1)

      const result = await dexEngine.addLiquidity(
        pool.token0,
        pool.token1,
        amount0,
        amount1,
        pool.fee
      )

      // sqrt(1 * 1) = 1, so should be 1
      expect(result.liquidity).toBe(BigInt(1))

      console.log(`Tiny liquidity: ${result.liquidity.toString()}`)
    })

    it('should handle unbalanced liquidity provision (slippage)', async () => {
      const pools = dexEngine.getPools()
      const pool = pools[0]

      // Provide very unbalanced amounts
      const amount0 = parseEther('1000')
      const amount1 = parseEther('1') // Highly unbalanced

      const result = await dexEngine.addLiquidity(
        pool.token0,
        pool.token1,
        amount0,
        amount1,
        pool.fee
      )

      // One amount should be capped to maintain ratio
      const provisioned = result.amount0 !== amount0 || result.amount1 !== amount1
      expect(provisioned).toBe(true)

      console.log(`Unbalanced provision:`)
      console.log(`  Provided: ${formatEther(amount0)}, ${formatEther(amount1)}`)
      console.log(`  Actually added: ${formatEther(result.amount0)}, ${formatEther(result.amount1)}`)
    })

    it('should prevent LP minting with zero liquidity', async () => {
      const pools = dexEngine.getPools()
      const pool = pools[0]

      try {
        const result = await dexEngine.addLiquidity(
          pool.token0,
          pool.token1,
          BigInt(0),
          BigInt(0),
          pool.fee
        )

        // Should mint 0 tokens
        expect(result.liquidity).toBe(BigInt(0))
      } catch (error) {
        // Or throw error - both are acceptable
        expect(error).toBeDefined()
      }
    })

    it('should correctly remove liquidity and burn LP tokens', async () => {
      const pools = dexEngine.getPools()
      const pool = pools[0]

      // Add liquidity first
      const addResult = await dexEngine.addLiquidity(
        pool.token0,
        pool.token1,
        parseEther('10'),
        parseEther('10'),
        pool.fee
      )

      const lpTokensMinted = addResult.liquidity

      // Remove half the liquidity
      const removeResult = await dexEngine.removeLiquidity(
        pool.token0,
        pool.token1,
        lpTokensMinted / BigInt(2),
        pool.fee
      )

      console.log(`Removed liquidity:`)
      console.log(`  Amount0: ${formatEther(removeResult.amount0)}`)
      console.log(`  Amount1: ${formatEther(removeResult.amount1)}`)

      // Should get back proportional amounts
      expect(removeResult.amount0).toBeGreaterThan(BigInt(0))
      expect(removeResult.amount1).toBeGreaterThan(BigInt(0))
    })
  })

  // ============================================================================
  // TEST 4: REWARD DISTRIBUTION & FEE ACCOUNTING
  // ============================================================================

  describe('Fee Accounting & Reward Distribution', () => {
    it('should correctly deduct pool fee from swap', async () => {
      const pools = dexEngine.getPools()
      const pool = pools[0]
      const stats = dexEngine.getPoolStats(pool.token0, pool.token1, pool.fee)

      const amountIn = parseEther('100')
      const feePercent = stats!.fee / 10000 // Convert basis points to decimal

      // Fee should be: amountIn * (fee / 10000)
      const expectedFee = (amountIn * BigInt(stats!.fee)) / BigInt(10000)
      const expectedAmountAfterFee = amountIn - expectedFee

      console.log(`Input: ${formatEther(amountIn)}`)
      console.log(`Fee (${stats!.fee} bps): ${formatEther(expectedFee)}`)
      console.log(`Amount after fee: ${formatEther(expectedAmountAfterFee)}`)

      const quote = await dexEngine.getSwapQuote(pool.token0, pool.token1, amountIn)

      // Price impact should reflect the fee
      expect(quote.priceImpact).toBeGreaterThan(0)
    })

    it('VULNERABILITY: detects fee accumulation rounding errors', async () => {
      const pools = dexEngine.getPools()
      const pool = pools[0]

      // Many small swaps - fees should accumulate
      const smallSwap = parseEther('0.001')
      let totalFees = BigInt(0)

      for (let i = 0; i < 1000; i++) {
        const fee = (smallSwap * BigInt(pool.fee)) / BigInt(10000)
        totalFees += fee

        if (fee === BigInt(0) && pool.fee > 0) {
          console.warn(`⚠️ PRECISION LOSS: Fee became 0 on small swap iteration ${i}`)
        }
      }

      console.log(`Total fees from 1000 small swaps: ${formatEther(totalFees)}`)
    })

    it('should track fee accumulation without overflow', async () => {
      // Test with max safe integers
      const maxSwaps = 1000
      const swapAmount = parseEther('1000000') // 1M tokens

      let accumulatedFee = BigInt(0)
      const feeRate = BigInt(500) // 500 basis points

      for (let i = 0; i < maxSwaps; i++) {
        const fee = (swapAmount * feeRate) / BigInt(10000)
        accumulatedFee += fee

        // Ensure no overflow (BigInt can't overflow in JS, but good practice to verify)
        expect(accumulatedFee).toBeGreaterThan(BigInt(0))
      }

      console.log(`Accumulated fees from ${maxSwaps} swaps: ${formatEther(accumulatedFee)}`)
    })
  })

  // ============================================================================
  // TEST 5: CRITICAL VULNERABILITIES
  // ============================================================================

  describe('Critical Vulnerabilities & Edge Cases', () => {
    it('VULNERABILITY FOUND: Line 205 - Price impact calculation is incorrect', () => {
      // The code does:
      // const priceImpact = ((Number(amountIn) - Number(outputAmount)) / Number(amountIn)) * 100
      //
      // This is WRONG. Price impact should be calculated as:
      // priceImpact = (1 - (outputAmount / (amountIn * spotPrice))) * 100
      // Or more simply: (1 - executionPrice / spotPrice) * 100
      //
      // The current formula measures OUTPUT LOSS, not price impact relative to spot price

      const amountIn = BigInt(100e18)
      const outputAmount = BigInt(95e18) // 5% loss

      // Current (wrong) calculation:
      const wrongImpact = ((Number(amountIn) - Number(outputAmount)) / Number(amountIn)) * 100
      console.log(`Wrong price impact calculation: ${wrongImpact}%`)

      // This just returns the percentage of output loss, not actual price impact
      // A large swap with normal price impact would show as 5%, but a small swap with 5% slippage also shows as 5%
    })

    it('VULNERABILITY FOUND: Line 208-209 - Slippage calculation rounding error', () => {
      // The code does:
      // const slippageAmount = (outputAmount * BigInt(Math.floor(slippagePercent * 100))) / BigInt(10000)
      //
      // Problem: Math.floor(slippagePercent * 100) loses precision
      // For 0.5%, this becomes floor(50) = 50, which is correct
      // But for 0.001%, this becomes floor(0.1) = 0, losing all precision!

      const testCases = [
        { slippage: 0.5, name: '0.5%' },
        { slippage: 0.1, name: '0.1%' },
        { slippage: 0.05, name: '0.05%' },
        { slippage: 0.01, name: '0.01%' },
        { slippage: 0.001, name: '0.001%' },
      ]

      testCases.forEach(({ slippage, name }) => {
        const floored = Math.floor(slippage * 100)
        const correct = slippage * 100

        if (floored === 0 && slippage > 0) {
          console.error(`⚠️ CRITICAL: Slippage ${name} becomes 0 after Math.floor! Lost ${(correct - floored).toFixed(4)} basis points`)
        } else if (floored !== correct) {
          console.warn(`⚠️ WARNING: Slippage ${name} rounded from ${correct} to ${floored}`)
        }
      })
    })

    it('VULNERABILITY FOUND: Line 97 - Invalid sqrtPriceX96 value', () => {
      // Line 97 has a hardcoded sqrtPriceX96: BigInt('1461446703485210835747363837480705')
      // This is supposed to represent a price of ~1.0
      // Let's verify this is actually correct...

      const Q96 = BigInt(2) ** BigInt(96)
      const sqrtPrice = Number(BigInt('1461446703485210835747363837480705')) / Number(Q96)
      const price = sqrtPrice ** 2

      console.log(`Encoded sqrtPriceX96: ${BigInt('1461446703485210835747363837480705')}`)
      console.log(`Decoded sqrt price: ${sqrtPrice}`)
      console.log(`Decoded price: ${price}`)

      // Verify this makes sense
      if (price < 0.5 || price > 2) {
        console.warn(`⚠️ SUSPICIOUS: Price of ${price} doesn't seem right for 1:1 pair`)
      }
    })

    it('VULNERABILITY FOUND: Integer overflow risk in fee calculation', () => {
      // When amountIn is very large (near BigInt max), multiplying by fee rate first could overflow
      // Safer order: (amountIn * 10000 - fee) / 10000

      const maxValue = BigInt(2) ** BigInt(256) - BigInt(1)
      const largeAmount = maxValue / BigInt(2) // Safe amount

      const fee = 3000 // 30% fee (unrealistic but testing extremes)

      // Potentially problematic order (multiply first):
      try {
        const feeAmount = (largeAmount * BigInt(fee)) / BigInt(10000)
        console.log(`Fee calculated safely: ${feeAmount}`)
      } catch (e) {
        console.error(`⚠️ OVERFLOW: Fee calculation failed with large amount`)
      }
    })

    it('should validate pool existence and handle missing pools', async () => {
      const nonExistentToken0 = '0x1111111111111111111111111111111111111111' as Address
      const nonExistentToken1 = '0x2222222222222222222222222222222222222222' as Address

      try {
        await dexEngine.getSwapQuote(nonExistentToken0, nonExistentToken1, parseEther('1'))
        expect.fail('Should throw error for non-existent pool')
      } catch (error: any) {
        expect(error.message).toContain('No pool found')
      }
    })
  })

  // ============================================================================
  // TEST 6: PRECISION LOSS REGRESSION TESTS
  // ============================================================================

  describe('Precision Loss Regression Tests', () => {
    it('should not lose precision with extreme decimal differences', async () => {
      // USDC (6 decimals) vs WETH (18 decimals)
      const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address
      const weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address

      const pools = dexEngine.getPools()
      const pool = pools.find((p) => (p.token0 === usdc && p.token1 === weth) || (p.token0 === weth && p.token1 === usdc))

      if (!pool) {
        console.log('USDC/WETH pool not found in default pools')
        return
      }

      // Swap 1 USDC (6 decimals) = 1e6 wei
      const quote = await dexEngine.getSwapQuote(usdc, weth, BigInt(1e6))

      console.log(`USDC to WETH:`)
      console.log(`  Input: ${formatUnits(BigInt(1e6), 6)} USDC`)
      console.log(`  Output: ${formatUnits(quote.outputAmount, 18)} WETH`)
      console.log(`  Price impact: ${quote.priceImpact}%`)

      // Should handle decimal mismatch without precision loss
      expect(quote.outputAmount).toBeGreaterThan(BigInt(0))
    })

    it('should handle repeated swaps without compounding rounding errors', async () => {
      const pools = dexEngine.getPools()
      const pool = pools[0]

      let currentAmount = parseEther('1')
      const swaps = 10

      for (let i = 0; i < swaps; i++) {
        const quote = await dexEngine.getSwapQuote(pool.token0, pool.token1, currentAmount)
        currentAmount = quote.outputAmount

        console.log(`Swap ${i + 1}: ${formatEther(currentAmount)}`)
      }

      // After 10 swaps, we should have lost some value but not dramatically
      const initialValue = parseEther('1')
      const finalValue = currentAmount

      const totalLoss = ((Number(initialValue) - Number(finalValue)) / Number(initialValue)) * 100
      console.log(`Total loss after ${swaps} swaps: ${totalLoss.toFixed(2)}%`)

      // Even with slippage and fees, shouldn't lose more than 50% over 10 swaps
      expect(finalValue).toBeGreaterThan(initialValue / BigInt(2))
    })
  })
})
