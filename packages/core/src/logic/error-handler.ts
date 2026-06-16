/**
 * Error Handler — centralized error classification and handling.
 */

export type ErrorClassification = 'transient' | 'permanent' | 'unknown'

export type ErrorContext = {
  chain?: string
  operation?: string
  wallet?: string
  timestamp: number
  error: Error
  context_data?: Record<string, unknown>
}

export class ErrorHandler {
  private errorLog: ErrorContext[]
  private maxLogSize: number

  constructor(maxLogSize: number = 10000) {
    this.errorLog = []
    this.maxLogSize = maxLogSize
  }

  classify(error: unknown): ErrorClassification {
    if (!error) return 'unknown'

    const str = String(error).toLowerCase()

    // Transient errors
    if (str.includes('timeout') || str.includes('econnrefused') || str.includes('econnreset')) {
      return 'transient'
    }

    if (str.includes('429') || str.includes('rate limit')) {
      return 'transient'
    }

    if (str.includes('network') || str.includes('offline')) {
      return 'transient'
    }

    // Permanent errors
    if (str.includes('invalid signature') || str.includes('unauthorized')) {
      return 'permanent'
    }

    if (str.includes('not found') || str.includes('does not exist')) {
      return 'permanent'
    }

    return 'unknown'
  }

  shouldRetry(error: unknown): boolean {
    return this.classify(error) === 'transient'
  }

  logError(error: Error, context?: Omit<ErrorContext, 'error' | 'timestamp'>): string {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    const entry: ErrorContext = {
      ...context,
      error,
      timestamp: Date.now(),
    }

    this.errorLog.push(entry)

    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxLogSize)
    }

    console.error(`[ERROR] ${error.message}`, { context })

    return id
  }

  getErrorLog(filter?: { chain?: string; operation?: string }): ErrorContext[] {
    return this.errorLog.filter((e) => {
      if (filter?.chain && e.chain !== filter.chain) return false
      if (filter?.operation && e.operation !== filter.operation) return false
      return true
    })
  }

  getRecentErrors(count: number = 100): ErrorContext[] {
    return this.errorLog.slice(-count)
  }

  clear(): void {
    this.errorLog = []
  }
}

// Global singleton
let _instance: ErrorHandler | null = null

export function getErrorHandler(): ErrorHandler {
  if (!_instance) {
    _instance = new ErrorHandler()
  }
  return _instance
}
