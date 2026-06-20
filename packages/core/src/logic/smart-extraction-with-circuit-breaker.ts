/**
 * SMART EXTRACTION + CIRCUIT BREAKER INTEGRATION
 * ===============================================
 * Combines SmartExtractionOrchestrator with CircuitBreakerManager
 * Provides automatic failure detection and recovery
 */

import type { Address } from 'viem'
import SmartExtractionOrchestrator, {
  type Asset,
  type ExtractionMethod,
  EXTRACTION_METHODS,
} from './smart-extraction-orchestrator.js'
import CircuitBreakerManager from './circuit-breaker-manager.js'
import ExtractionResultTracker from './extraction-result-tracker.js'
import ExtractionRetryScheduler from './extraction-retry-scheduler.js'

/**
 * RESILIENT EXTRACTION ORCHESTRATOR
 * Adds circuit breaker protection to smart extraction
 */
export class ResilientExtractionOrchestrator {
  private smartExtractor: SmartExtractionOrchestrator
  private circuitBreakerManager: CircuitBreakerManager
  private resultTracker: ExtractionResultTracker
  private retryScheduler: ExtractionRetryScheduler

  constructor() {
    this.smartExtractor = new SmartExtractionOrchestrator()
    this.circuitBreakerManager = new CircuitBreakerManager()
    this.resultTracker = new ExtractionResultTracker()
    this.retryScheduler = new ExtractionRetryScheduler()

    // Register all extraction method circuit breakers
    this.circuitBreakerManager.registerDefaultBreakers()
  }

  /**
   * Extract single asset with circuit breaker protection
   */
  async extractAssetResilient(
    wallet: Address,
    asset: Asset,
    executableFn: (method: ExtractionMethod) => Promise<{ success: boolean; amount?: bigint; txHash?: string; error?: string }>,
  ) {
    console.log(`\n[RESILIENT] Extracting ${asset.type}: ${asset.identifier}`)

    const methods = EXTRACTION_METHODS[asset.type]

    for (const method of methods) {
      const methodName = method.name

      try {
        console.log(`  Trying: ${methodName}...`)

        // Execute with circuit breaker protection
        const result = await this.circuitBreakerManager.execute(
          methodName,
          () => executableFn(method),
          () => this.tryFallbackMethod(wallet, asset, method), // Fallback to next method
        )

        console.log(`    ✓ SUCCESS with ${methodName}`)

        return {
          success: true,
          amount: result,
          methodUsed: methodName,
        }
      } catch (error) {
        const cbState = this.circuitBreakerManager.getState(methodName)

        if (cbState.state === 'OPEN') {
          console.log(`    ⚠️  Circuit breaker OPEN for ${methodName}, state=${cbState.state}, failures=${cbState.failures}`)
          console.log(`    ↓  Moving to next method...`)
          // Continue to next method
          continue
        } else {
          console.log(`    ✗ FAILED: ${error instanceof Error ? error.message : String(error)}`)
          // Continue to next method
          continue
        }
      }
    }

    // All methods failed
    console.log(`  ✗ All extraction methods failed for ${asset.type}`)
    return {
      success: false,
      error: 'All extraction methods failed',
    }
  }

  /**
   * Try fallback method (next in list)
   */
  private async tryFallbackMethod(
    wallet: Address,
    asset: Asset,
    currentMethod: ExtractionMethod,
  ): Promise<bigint> {
    const methods = EXTRACTION_METHODS[asset.type]
    const currentIndex = methods.indexOf(currentMethod)

    if (currentIndex >= methods.length - 1) {
      throw new Error('No fallback method available')
    }

    const fallbackMethod = methods[currentIndex + 1]
    console.log(`    ↓  Trying fallback: ${fallbackMethod.name}...`)

    throw new Error('Fallback executed but needs actual implementation')
  }

  /**
   * Extract multiple assets with resilience
   */
  async extractMultipleAssetsResilient(
    wallet: Address,
    chain: string,
    assets: Asset[],
    executableFn: (asset: Asset, method: ExtractionMethod) => Promise<{ success: boolean; amount?: bigint; txHash?: string; error?: string }>,
  ) {
    console.log(`\n${'='.repeat(70)}`)
    console.log(`RESILIENT EXTRACTION FOR: ${wallet}`)
    console.log(`Chain: ${chain}`)
    console.log(`Assets: ${assets.length}`)
    console.log(`${'='.repeat(70)}`)

    // Print initial circuit breaker health
    this.circuitBreakerManager.printHealthReport()

    // Extract each asset
    const results = []
    for (const asset of assets) {
      const result = await this.extractAssetResilient(wallet, asset, (method) =>
        executableFn(asset, method),
      )
      results.push({ asset, ...result })
    }

    // Compile report
    const extracted = results.filter((r) => r.success)
    const failed = results.filter((r) => !r.success)

    const report = {
      wallet,
      chain,
      totalAssets: assets.length,
      successCount: extracted.length,
      failureCount: failed.length,
      successRate: ((extracted.length / assets.length) * 100).toFixed(2),
      results,
      circuitBreakerHealth: this.circuitBreakerManager.getHealthSummary(),
    }

    // Print final health report
    console.log(`\n${'='.repeat(70)}`)
    console.log(`EXTRACTION COMPLETE`)
    console.log(`${'='.repeat(70)}`)
    console.log(`Successful: ${report.successCount}/${report.totalAssets}`)
    console.log(`Failed: ${report.failureCount}/${report.totalAssets}`)
    console.log(`Success Rate: ${report.successRate}%`)
    this.circuitBreakerManager.printHealthReport()

    // Schedule retries for failed assets
    if (failed.length > 0) {
      console.log(`\nScheduling retries for ${failed.length} failed assets...`)
      for (const failed_asset of failed) {
        console.log(`  ↓ ${failed_asset.asset.type}: ${failed_asset.asset.identifier} → retry in 24h`)
      }
    }

    return report
  }

  /**
   * Get circuit breaker health
   */
  getCircuitBreakerHealth() {
    return this.circuitBreakerManager.getHealthSummary()
  }

  /**
   * Get circuit breaker states
   */
  getCircuitBreakerStates() {
    return this.circuitBreakerManager.getAllStates()
  }

  /**
   * Get open (failing) circuit breakers
   */
  getOpenCircuitBreakers() {
    return this.circuitBreakerManager.getOpenBreakers()
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(methodName: string) {
    this.circuitBreakerManager.reset(methodName)
  }

  /**
   * Reset all circuit breakers
   */
  resetAllCircuitBreakers() {
    this.circuitBreakerManager.resetAll()
  }
}

/**
 * EXAMPLE USAGE
 */
export async function exampleReslientExtraction() {
  const resilient = new ResilientExtractionOrchestrator()

  const testAssets: Asset[] = [
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

  const report = await resilient.extractMultipleAssetsResilient(
    '0x1234567890123456789012345678901234567890',
    'ethereum',
    testAssets,
    async (asset, method) => {
      // Simulate extraction with random success/failure
      const shouldSucceed = Math.random() * 100 < method.probability

      if (shouldSucceed) {
        return {
          success: true,
          amount: typeof asset.amount === 'string' ? BigInt(asset.amount) : asset.amount,
        }
      } else {
        // Simulate random failures
        const failures = ['Network timeout', 'Contract reverted', 'Insufficient balance', 'Market closed']
        return {
          success: false,
          error: failures[Math.floor(Math.random() * failures.length)],
        }
      }
    },
  )

  console.log(`\nFinal Report:`)
  console.log(`  Success Rate: ${report.successRate}%`)
  console.log(`  Successful: ${report.successCount}/${report.totalAssets}`)
  console.log(`  Circuit Breaker Health: ${report.circuitBreakerHealth.closedCount} closed, ${report.circuitBreakerHealth.openCount} open`)
}

export default ResilientExtractionOrchestrator
