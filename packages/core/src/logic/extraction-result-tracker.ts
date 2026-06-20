/**
 * EXTRACTION RESULT TRACKER
 * ========================
 * Persists smart extraction results to database
 * Tracks which methods worked, retry schedules, etc.
 */

import type { Address } from 'viem'
import type { AssetExtractionResult, SmartExtractionReport } from './smart-extraction-orchestrator.js'

export interface ExtractionResultRecord {
  id: string
  wallet_address: Address
  chain: string
  asset_type: string
  asset_identifier: string
  amount_attempted: string
  amount_extracted: string | null
  method_primary: string
  method_fallback_1: string | null
  method_fallback_2: string | null
  method_worked: string | null
  status: 'EXTRACTED' | 'SKIPPED' | 'ABANDONED'
  retry_count: number
  next_retry_time: Date | null
  attempts_json: string // JSON serialized attempts
  error_log_json: string | null // JSON serialized errors
  created_at: Date
  updated_at: Date
}

/**
 * EXTRACTION RESULT TRACKER CLASS
 */
export class ExtractionResultTracker {
  private db: any // In production, would be actual DB connection

  constructor(dbConnection?: any) {
    this.db = dbConnection
  }

  /**
   * Save extraction report to database
   */
  async saveExtractionReport(report: SmartExtractionReport): Promise<void> {
    console.log(`[EXTRACTION_TRACKER] Saving ${report.results.length} results to database...`)

    const records: ExtractionResultRecord[] = report.results.map((result) => {
      const methodAttempts = result.attempts.map((a) => a.method.name)

      return {
        id: `${report.wallet}_${result.asset.identifier}_${Date.now()}`,
        wallet_address: report.wallet,
        chain: report.chain,
        asset_type: result.asset.type,
        asset_identifier: result.asset.identifier,
        amount_attempted: result.asset.amount.toString(),
        amount_extracted: result.amountExtracted?.toString() || null,
        method_primary: methodAttempts[0] || '',
        method_fallback_1: methodAttempts[1] || null,
        method_fallback_2: methodAttempts[2] || null,
        method_worked: result.methodUsed || null,
        status: result.status,
        retry_count: result.retryCount,
        next_retry_time: result.nextRetryTime,
        attempts_json: JSON.stringify(
          result.attempts.map((a) => ({
            method: a.method.name,
            success: a.success,
            error: a.error,
            duration: a.duration,
          })),
        ),
        error_log_json: result.attempts.filter((a) => a.error).length > 0 ? JSON.stringify(result.attempts.filter((a) => a.error)) : null,
        created_at: result.createdAt,
        updated_at: result.updatedAt,
      }
    })

    // In production: await this.db.insertMany(records)
    console.log(`[EXTRACTION_TRACKER] Would save ${records.length} records to database`)
    records.forEach((r) => {
      console.log(
        `  ${r.asset_type}: ${r.status} | Method: ${r.method_worked || 'NONE'} | Retries: ${r.retry_count}`,
      )
    })
  }

  /**
   * Get extraction history for wallet
   */
  async getExtractionHistory(wallet: Address, limit: number = 100): Promise<ExtractionResultRecord[]> {
    console.log(`[EXTRACTION_TRACKER] Fetching history for ${wallet} (limit: ${limit})`)

    // In production: return this.db.find({ wallet_address: wallet }).sort({ created_at: -1 }).limit(limit)
    return []
  }

  /**
   * Get pending retries (extraction_result where status='SKIPPED' and next_retry_time <= now)
   */
  async getPendingRetries(): Promise<ExtractionResultRecord[]> {
    const now = new Date()

    console.log(`[EXTRACTION_TRACKER] Fetching pending retries as of ${now.toISOString()}`)

    // In production:
    // return this.db.find({
    //   status: 'SKIPPED',
    //   next_retry_time: { $lte: now },
    //   retry_count: { $lt: 3 }
    // }).sort({ next_retry_time: 1 })

    return []
  }

  /**
   * Update extraction result after retry
   */
  async updateRetryResult(
    recordId: string,
    success: boolean,
    amountExtracted?: string,
    methodUsed?: string,
    errorLog?: string,
  ): Promise<void> {
    console.log(
      `[EXTRACTION_TRACKER] Updating record ${recordId}: ${success ? 'SUCCESS' : 'SKIPPED_AGAIN'}`,
    )

    // In production:
    // const nextRetryTime = success ? null : new Date(Date.now() + 24 * 60 * 60 * 1000)
    // await this.db.updateOne(
    //   { id: recordId },
    //   {
    //     $set: {
    //       status: success ? 'EXTRACTED' : 'SKIPPED',
    //       amount_extracted: amountExtracted || null,
    //       method_worked: methodUsed || null,
    //       retry_count: { $inc: 1 },
    //       next_retry_time: nextRetryTime,
    //       error_log_json: errorLog || null,
    //       updated_at: new Date()
    //     }
    //   }
    // )
  }

  /**
   * Get statistics for wallet
   */
  async getExtractionStats(wallet: Address): Promise<{
    totalAttempts: number
    successfulExtractions: number
    successRate: number
    totalExtracted: string
    averageRetries: number
  }> {
    console.log(`[EXTRACTION_TRACKER] Computing stats for ${wallet}`)

    // In production: query database and compute
    return {
      totalAttempts: 0,
      successfulExtractions: 0,
      successRate: 0,
      totalExtracted: '0',
      averageRetries: 0,
    }
  }
}

export default ExtractionResultTracker
