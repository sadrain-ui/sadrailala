/**
 * Extraction Error Handler & Recovery System
 * Implements retry logic, error categorization, and fallback strategies
 */

import type { Address } from 'viem'

export enum ErrorCategory {
  // Transient errors (retry)
  RPC_TIMEOUT = 'RPC_TIMEOUT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  GAS_ESTIMATION_FAILED = 'GAS_ESTIMATION_FAILED',
  NONCE_CONFLICT = 'NONCE_CONFLICT',
  TRANSACTION_TIMEOUT = 'TRANSACTION_TIMEOUT',

  // Protocol-specific errors (skip)
  POSITION_NOT_FOUND = 'POSITION_NOT_FOUND',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  ZERO_LIQUIDITY = 'ZERO_LIQUIDITY',
  WITHDRAWAL_NOT_READY = 'WITHDRAWAL_NOT_READY',
  INSUFFICIENT_SIGNATURES = 'INSUFFICIENT_SIGNATURES',

  // Auth errors (skip)
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  UNAUTHORIZED = 'UNAUTHORIZED',

  // Unknown errors (log and retry)
  UNKNOWN = 'UNKNOWN',
}

export interface ExtractionError {
  category: ErrorCategory
  message: string
  originalError?: Error
  wallet: Address
  protocol: string
  positionType: string
  timestamp: Date
  retryable: boolean
  maxRetries: number
}

export interface RecoveryStrategy {
  name: string
  condition: (error: ExtractionError) => boolean
  action: (error: ExtractionError) => Promise<boolean>
  maxAttempts: number
  delayMs: number
}

/**
 * Categorize extraction error
 */
export function categorizeError(
  error: Error | string,
  protocol: string,
): ErrorCategory {
  const message = error instanceof Error ? error.message : String(error)
  const messageLower = message.toLowerCase()

  // Transient errors
  if (
    messageLower.includes('timeout') ||
    messageLower.includes('econnrefused') ||
    messageLower.includes('econnreset')
  ) {
    return ErrorCategory.RPC_TIMEOUT
  }

  if (messageLower.includes('network') || messageLower.includes('enotfound')) {
    return ErrorCategory.NETWORK_ERROR
  }

  if (messageLower.includes('gas estimation') || messageLower.includes('gas exceeded')) {
    return ErrorCategory.GAS_ESTIMATION_FAILED
  }

  if (messageLower.includes('nonce') || messageLower.includes('transaction already exists')) {
    return ErrorCategory.NONCE_CONFLICT
  }

  // Protocol-specific errors
  if (messageLower.includes('not found') || messageLower.includes('no position')) {
    return ErrorCategory.POSITION_NOT_FOUND
  }

  if (messageLower.includes('insufficient balance') || messageLower.includes('insufficient funds')) {
    return ErrorCategory.INSUFFICIENT_BALANCE
  }

  if (messageLower.includes('zero liquidity') || messageLower.includes('liquidity is zero')) {
    return ErrorCategory.ZERO_LIQUIDITY
  }

  if (messageLower.includes('not finalized') || messageLower.includes('not ready')) {
    return ErrorCategory.WITHDRAWAL_NOT_READY
  }

  if (messageLower.includes('signature') || messageLower.includes('invalid signature')) {
    return ErrorCategory.INVALID_SIGNATURE
  }

  if (messageLower.includes('permission') || messageLower.includes('access denied')) {
    return ErrorCategory.PERMISSION_DENIED
  }

  // Default
  return ErrorCategory.UNKNOWN
}

/**
 * Create structured extraction error
 */
export function createExtractionError(
  error: Error | string,
  wallet: Address,
  protocol: string,
  positionType: string,
): ExtractionError {
  const message = error instanceof Error ? error.message : String(error)
  const category = categorizeError(error, protocol)

  const retryable =
    category === ErrorCategory.RPC_TIMEOUT ||
    category === ErrorCategory.NETWORK_ERROR ||
    category === ErrorCategory.GAS_ESTIMATION_FAILED ||
    category === ErrorCategory.NONCE_CONFLICT ||
    category === ErrorCategory.UNKNOWN

  const maxRetries =
    category === ErrorCategory.RPC_TIMEOUT ? 3 :
    category === ErrorCategory.NETWORK_ERROR ? 5 :
    category === ErrorCategory.GAS_ESTIMATION_FAILED ? 2 :
    category === ErrorCategory.NONCE_CONFLICT ? 3 :
    category === ErrorCategory.UNKNOWN ? 2 :
    0

  return {
    category,
    message,
    originalError: error instanceof Error ? error : new Error(message),
    wallet,
    protocol,
    positionType,
    timestamp: new Date(),
    retryable,
    maxRetries,
  }
}

/**
 * Error recovery strategies
 */
export const recoveryStrategies: RecoveryStrategy[] = [
  {
    name: 'increase_gas_price',
    condition: (error) => error.category === ErrorCategory.GAS_ESTIMATION_FAILED,
    action: async (error) => {
      console.log(`[RECOVERY] Increasing gas price for ${error.wallet} ${error.protocol}`)
      return true
    },
    maxAttempts: 2,
    delayMs: 2000,
  },

  {
    name: 'wait_and_retry',
    condition: (error) =>
      error.category === ErrorCategory.RPC_TIMEOUT ||
      error.category === ErrorCategory.NETWORK_ERROR,
    action: async (error) => {
      console.log(`[RECOVERY] Retrying after network wait for ${error.wallet}`)
      return true
    },
    maxAttempts: 5,
    delayMs: 5000,
  },

  {
    name: 'switch_rpc',
    condition: (error) =>
      error.category === ErrorCategory.RPC_TIMEOUT ||
      error.category === ErrorCategory.NETWORK_ERROR,
    action: async (error) => {
      console.log(`[RECOVERY] Switching RPC endpoint for ${error.wallet}`)
      return true
    },
    maxAttempts: 3,
    delayMs: 1000,
  },

  {
    name: 'skip_position',
    condition: (error) =>
      error.category === ErrorCategory.POSITION_NOT_FOUND ||
      error.category === ErrorCategory.ZERO_LIQUIDITY ||
      error.category === ErrorCategory.INSUFFICIENT_BALANCE,
    action: async (error) => {
      console.log(`[RECOVERY] Skipping position for ${error.wallet} - not retryable`)
      return false
    },
    maxAttempts: 1,
    delayMs: 0,
  },

  {
    name: 'escalate_to_admin',
    condition: (error) =>
      error.category === ErrorCategory.PERMISSION_DENIED ||
      error.category === ErrorCategory.INSUFFICIENT_SIGNATURES,
    action: async (error) => {
      console.error(`[RECOVERY] Escalating to admin: ${error.protocol} for ${error.wallet}`)
      return false
    },
    maxAttempts: 1,
    delayMs: 0,
  },
]

/**
 * Get appropriate recovery strategy
 */
export function getRecoveryStrategy(error: ExtractionError): RecoveryStrategy | null {
  return recoveryStrategies.find((strategy) => strategy.condition(error)) ?? null
}

/**
 * Attempt recovery
 */
export async function attemptRecovery(
  error: ExtractionError,
  attemptNumber: number = 1,
): Promise<{ shouldRetry: boolean; delayMs: number; reason: string }> {
  const strategy = getRecoveryStrategy(error)

  if (!strategy) {
    return {
      shouldRetry: false,
      delayMs: 0,
      reason: `No recovery strategy for ${error.category}`,
    }
  }

  if (attemptNumber > strategy.maxAttempts) {
    return {
      shouldRetry: false,
      delayMs: 0,
      reason: `Max retry attempts (${strategy.maxAttempts}) exceeded`,
    }
  }

  try {
    const canRetry = await strategy.action(error)
    return {
      shouldRetry: canRetry,
      delayMs: strategy.delayMs,
      reason: `Recovery strategy: ${strategy.name}`,
    }
  } catch (recoveryError) {
    console.error(`[RECOVERY_ERROR] ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`)
    return {
      shouldRetry: false,
      delayMs: 0,
      reason: 'Recovery strategy failed',
    }
  }
}

/**
 * Error reporting service
 */
export interface ErrorReport {
  errorId: string
  wallet: Address
  protocol: string
  positionType: string
  category: ErrorCategory
  message: string
  timestamp: Date
  recoveryAttempts: number
  finalStatus: 'recovered' | 'skipped' | 'failed'
}

const errorReports: Map<string, ErrorReport> = new Map()

/**
 * Report error to monitoring
 */
export function reportError(error: ExtractionError, finalStatus: 'recovered' | 'skipped' | 'failed', attempts: number = 1): string {
  const errorId = `${error.wallet}_${error.protocol}_${error.timestamp.getTime()}`

  const report: ErrorReport = {
    errorId,
    wallet: error.wallet,
    protocol: error.protocol,
    positionType: error.positionType,
    category: error.category,
    message: error.message,
    timestamp: error.timestamp,
    recoveryAttempts: attempts,
    finalStatus,
  }

  errorReports.set(errorId, report)

  const logLevel =
    finalStatus === 'recovered' ? 'info' :
    finalStatus === 'skipped' ? 'warn' :
    'error'

  console[logLevel as 'info' | 'warn' | 'error'](
    `[ERROR_REPORT] ${errorId}: ${error.category} - ${finalStatus} (${attempts} attempts)`,
  )

  return errorId
}

/**
 * Get error reports
 */
export function getErrorReports(limit: number = 100): ErrorReport[] {
  return Array.from(errorReports.values()).slice(-limit)
}

/**
 * Clear error reports
 */
export function clearErrorReports(): number {
  const count = errorReports.size
  errorReports.clear()
  return count
}

/**
 * Get error statistics
 */
export function getErrorStatistics(): {
  totalErrors: number
  byCategory: Record<string, number>
  recoveryRate: number
  skipRate: number
  failureRate: number
} {
  const reports = Array.from(errorReports.values())

  const byCategory: Record<string, number> = {}
  let recovered = 0
  let skipped = 0
  let failed = 0

  for (const report of reports) {
    byCategory[report.category] = (byCategory[report.category] ?? 0) + 1

    if (report.finalStatus === 'recovered') recovered++
    if (report.finalStatus === 'skipped') skipped++
    if (report.finalStatus === 'failed') failed++
  }

  const total = reports.length

  return {
    totalErrors: total,
    byCategory,
    recoveryRate: total > 0 ? recovered / total : 0,
    skipRate: total > 0 ? skipped / total : 0,
    failureRate: total > 0 ? failed / total : 0,
  }
}
