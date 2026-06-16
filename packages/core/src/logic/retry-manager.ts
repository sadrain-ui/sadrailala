/**
 * Retry Manager — centralized retry logic with exponential backoff.
 */

export type RetryOptions = {
  maxAttempts?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
  jitterFactor?: number
}

export class RetryManager {
  private readonly maxAttempts: number
  private readonly initialDelayMs: number
  private readonly maxDelayMs: number
  private readonly backoffMultiplier: number
  private readonly jitterFactor: number

  constructor(options: RetryOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 3
    this.initialDelayMs = options.initialDelayMs ?? 1000
    this.maxDelayMs = options.maxDelayMs ?? 30000
    this.backoffMultiplier = options.backoffMultiplier ?? 2
    this.jitterFactor = options.jitterFactor ?? 0.1
  }

  async execute<T>(fn: () => Promise<T>, context?: string): Promise<T> {
    let lastError: unknown

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        return await fn()
      } catch (e) {
        lastError = e
        if (attempt < this.maxAttempts - 1) {
          const delay = this.calculateDelay(attempt)
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }

    throw lastError
  }

  private calculateDelay(attempt: number): number {
    const exponentialDelay = this.initialDelayMs * Math.pow(this.backoffMultiplier, attempt)
    const delayWithCap = Math.min(exponentialDelay, this.maxDelayMs)
    const jitter = delayWithCap * this.jitterFactor * (Math.random() * 2 - 1)
    return delayWithCap + jitter
  }

  async executeWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number = 30000): Promise<T> {
    return Promise.race([fn(), new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs))])
  }
}

// Global singleton
let _instance: RetryManager | null = null

export function getRetryManager(): RetryManager {
  if (!_instance) {
    _instance = new RetryManager()
  }
  return _instance
}
