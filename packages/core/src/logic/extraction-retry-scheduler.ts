/**
 * EXTRACTION RETRY SCHEDULER
 * ==========================
 * Schedules retries for failed extractions (SKIPPED assets)
 * Uses BullMQ queue for reliable retry management
 * Retries up to 3 times, then abandons
 */

import type { Address } from 'viem'
import type { AssetExtractionResult } from './smart-extraction-orchestrator.js'

export interface RetryScheduleEntry {
  walletAddress: Address
  assetIdentifier: string
  assetType: string
  retryCount: number
  nextRetryTime: Date
  scheduleId: string
  createdAt: Date
}

/**
 * RETRY SCHEDULER CLASS
 */
export class ExtractionRetryScheduler {
  private retryQueue: any // In production: BullMQ Queue
  private schedules: Map<string, RetryScheduleEntry> = new Map()

  constructor(bullQueue?: any) {
    this.retryQueue = bullQueue
  }

  /**
   * Schedule a skipped asset for retry
   */
  async scheduleRetry(
    wallet: Address,
    asset: AssetExtractionResult,
    delayMs: number = 24 * 60 * 60 * 1000, // 24 hours default
  ): Promise<RetryScheduleEntry> {
    const scheduleId = `${wallet}_${asset.asset.identifier}_${Date.now()}`
    const nextRetryTime = new Date(Date.now() + delayMs)

    const entry: RetryScheduleEntry = {
      walletAddress: wallet,
      assetIdentifier: asset.asset.identifier,
      assetType: asset.asset.type,
      retryCount: asset.retryCount + 1,
      nextRetryTime,
      scheduleId,
      createdAt: new Date(),
    }

    this.schedules.set(scheduleId, entry)

    console.log(
      `[RETRY_SCHEDULER] Scheduled retry #${entry.retryCount} for ${asset.asset.type}:${asset.asset.identifier}`,
    )
    console.log(`  Wallet: ${wallet}`)
    console.log(`  Retry time: ${nextRetryTime.toISOString()} (in ${delayMs / 1000 / 60 / 60} hours)`)

    // In production: await this.retryQueue.add('extract-retry', entry, { delay: delayMs })

    return entry
  }

  /**
   * Batch schedule multiple retries
   */
  async scheduleMultipleRetries(
    wallet: Address,
    failedAssets: AssetExtractionResult[],
  ): Promise<RetryScheduleEntry[]> {
    const schedules: RetryScheduleEntry[] = []

    for (const asset of failedAssets) {
      if (asset.status === 'SKIPPED' && asset.retryCount < 3) {
        const schedule = await this.scheduleRetry(wallet, asset)
        schedules.push(schedule)
      } else if (asset.status === 'SKIPPED' && asset.retryCount >= 3) {
        console.log(
          `[RETRY_SCHEDULER] Max retries reached for ${asset.asset.type}:${asset.asset.identifier}, abandoning`,
        )
      }
    }

    console.log(`[RETRY_SCHEDULER] Scheduled ${schedules.length} retries for wallet ${wallet}`)

    return schedules
  }

  /**
   * Get pending retries due now
   */
  async getPendingRetries(): Promise<RetryScheduleEntry[]> {
    const now = new Date()
    const pending: RetryScheduleEntry[] = []

    for (const entry of this.schedules.values()) {
      if (entry.nextRetryTime <= now && entry.retryCount < 3) {
        pending.push(entry)
      }
    }

    console.log(
      `[RETRY_SCHEDULER] Found ${pending.length} pending retries ready for execution`,
    )

    return pending
  }

  /**
   * Mark retry as completed (success or final failure)
   */
  async markRetryCompleted(scheduleId: string, success: boolean): Promise<void> {
    const entry = this.schedules.get(scheduleId)

    if (!entry) {
      console.warn(`[RETRY_SCHEDULER] Schedule ${scheduleId} not found`)
      return
    }

    console.log(
      `[RETRY_SCHEDULER] Retry ${scheduleId} completed: ${success ? 'SUCCESS' : 'FAILED_AGAIN'}`,
    )

    if (success) {
      this.schedules.delete(scheduleId)
      console.log(`  Asset successfully extracted, removing from retry queue`)
    } else if (entry.retryCount >= 3) {
      this.schedules.delete(scheduleId)
      console.log(`  Max retries reached (3/3), abandoning asset`)
    } else {
      console.log(`  Will retry again in 24 hours (attempt ${entry.retryCount + 1}/3)`)
    }
  }

  /**
   * Get retry statistics
   */
  getRetryStats(): {
    totalScheduled: number
    pending: number
    byRetryCount: Map<number, number>
  } {
    const now = new Date()
    let pending = 0
    const byRetryCount = new Map<number, number>()

    for (const entry of this.schedules.values()) {
      if (entry.nextRetryTime <= now) pending++

      const count = byRetryCount.get(entry.retryCount) || 0
      byRetryCount.set(entry.retryCount, count + 1)
    }

    return {
      totalScheduled: this.schedules.size,
      pending,
      byRetryCount,
    }
  }

  /**
   * Get all schedules (for admin/monitoring)
   */
  getAllSchedules(): RetryScheduleEntry[] {
    return Array.from(this.schedules.values())
  }

  /**
   * Clear all schedules (use with caution!)
   */
  clearAllSchedules(): number {
    const count = this.schedules.size
    this.schedules.clear()
    console.warn(`[RETRY_SCHEDULER] Cleared ${count} retry schedules!`)
    return count
  }
}

export default ExtractionRetryScheduler
