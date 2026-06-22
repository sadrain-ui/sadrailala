/**
 * RPC Resilience Enhancement Layer
 * ================================
 * Adds comprehensive error recovery, rate limiting, and adaptive retry strategies
 * for all RPC interactions across EVM, Solana, Aptos, Sui, and other chains.
 *
 * Features:
 * - Adaptive exponential backoff with jitter
 * - Rate limiting with token bucket algorithm
 * - Circuit breaker for cascading failure prevention
 * - Request deduplication and caching
 * - Comprehensive error classification
 * - Metrics collection and reporting
 */

export type RpcErrorCategory =
  | 'timeout'
  | 'rate_limited'
  | 'server_error'
  | 'invalid_response'
  | 'network_error'
  | 'authentication_error'
  | 'validation_error'
  | 'transient_error'
  | 'permanent_error'
  | 'unknown_error'

export interface RpcErrorInfo {
  category: RpcErrorCategory
  statusCode?: number
  message: string
  retryable: boolean
  suggestedDelayMs: number
}

export interface RpcResilienceConfig {
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
  jitterFactor?: number
  rateLimitPerSecond?: number
  circuitBreakerThreshold?: number
  circuitBreakerResetMs?: number
  requestTimeoutMs?: number
  enableMetrics?: boolean
  enableRequestDedup?: boolean
  dedupWindowMs?: number
}

export interface RpcMetrics {
  chainKey: string
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  retriedRequests: number
  timeoutErrors: number
  rateLimitErrors: number
  circuitBreakerTrips: number
  averageLatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  lastUpdatedAt: string
}

/**
 * Classifies RPC errors and determines retry strategy
 */
export function classifyRpcError(error: unknown, statusCode?: number): RpcErrorInfo {
  const msg = error instanceof Error ? error.message : String(error)

  // Timeout errors
  if (/timeout|timed out|ETIMEDOUT|EHOSTUNREACH|ECONNRESET/i.test(msg)) {
    return {
      category: 'timeout',
      statusCode,
      message: msg,
      retryable: true,
      suggestedDelayMs: 1000,
    }
  }

  // Rate limiting (429, 503 with retry-after)
  if (statusCode === 429 || /rate.limit|too many request|quota|throttl/i.test(msg)) {
    return {
      category: 'rate_limited',
      statusCode,
      message: msg,
      retryable: true,
      suggestedDelayMs: 5000,
    }
  }

  // Server errors (5xx)
  if (statusCode && statusCode >= 500 && statusCode < 600) {
    const isTemporary = statusCode === 502 || statusCode === 503 || statusCode === 504
    return {
      category: 'server_error',
      statusCode,
      message: msg,
      retryable: isTemporary,
      suggestedDelayMs: isTemporary ? 2000 : 0,
    }
  }

  // Invalid response
  if (statusCode !== undefined && (statusCode < 200 || statusCode >= 400)) {
    if (statusCode === 401 || statusCode === 403) {
      return {
        category: 'authentication_error',
        statusCode,
        message: msg,
        retryable: false,
        suggestedDelayMs: 0,
      }
    }

    if (/json|parse|invalid|malformed/i.test(msg)) {
      return {
        category: 'invalid_response',
        statusCode,
        message: msg,
        retryable: false,
        suggestedDelayMs: 0,
      }
    }
  }

  // Network errors
  if (/network|dns|enotfound|econnrefused|socket|refused/i.test(msg)) {
    return {
      category: 'network_error',
      statusCode,
      message: msg,
      retryable: true,
      suggestedDelayMs: 2000,
    }
  }

  // Validation errors (bad params, invalid address, etc.)
  if (/invalid.*address|invalid.*param|bad.*request|validation/i.test(msg)) {
    return {
      category: 'validation_error',
      statusCode,
      message: msg,
      retryable: false,
      suggestedDelayMs: 0,
    }
  }

  // Transient vs permanent
  if (/transaction|nonce|underpriced|insufficient|gas/i.test(msg)) {
    return {
      category: 'transient_error',
      statusCode,
      message: msg,
      retryable: true,
      suggestedDelayMs: 1000,
    }
  }

  return {
    category: 'unknown_error',
    statusCode,
    message: msg,
    retryable: true,
    suggestedDelayMs: 1000,
  }
}

/**
 * Rate limiter using token bucket algorithm
 */
export class RateLimiter {
  private tokens: number
  private lastRefillAt: number
  private readonly capacity: number
  private readonly refillRatePerSecond: number

  constructor(tokensPerSecond: number = 100) {
    this.capacity = tokensPerSecond
    this.refillRatePerSecond = tokensPerSecond
    this.tokens = tokensPerSecond
    this.lastRefillAt = Date.now()
  }

  private refill(): void {
    const now = Date.now()
    const elapsedSeconds = (now - this.lastRefillAt) / 1000
    const tokensToAdd = elapsedSeconds * this.refillRatePerSecond
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd)
    this.lastRefillAt = now
  }

  async acquire(tokens: number = 1, timeoutMs: number = 30000): Promise<boolean> {
    const startTime = Date.now()

    while (true) {
      this.refill()

      if (this.tokens >= tokens) {
        this.tokens -= tokens
        return true
      }

      const elapsed = Date.now() - startTime
      if (elapsed >= timeoutMs) {
        return false
      }

      // Wait 10ms before checking again
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  isAvailable(tokens: number = 1): boolean {
    this.refill()
    return this.tokens >= tokens
  }
}

/**
 * Adaptive retry strategy with exponential backoff and jitter
 */
export class AdaptiveRetryStrategy {
  private readonly config: Required<RpcResilienceConfig>

  constructor(config: RpcResilienceConfig = {}) {
    this.config = {
      maxRetries: config.maxRetries ?? 5,
      initialDelayMs: config.initialDelayMs ?? 500,
      maxDelayMs: config.maxDelayMs ?? 32000,
      backoffMultiplier: config.backoffMultiplier ?? 2,
      jitterFactor: config.jitterFactor ?? 0.2,
      rateLimitPerSecond: config.rateLimitPerSecond ?? 100,
      circuitBreakerThreshold: config.circuitBreakerThreshold ?? 10,
      circuitBreakerResetMs: config.circuitBreakerResetMs ?? 60000,
      requestTimeoutMs: config.requestTimeoutMs ?? 30000,
      enableMetrics: config.enableMetrics ?? true,
      enableRequestDedup: config.enableRequestDedup ?? true,
      dedupWindowMs: config.dedupWindowMs ?? 5000,
    }
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   */
  calculateDelay(attempt: number, errorInfo?: RpcErrorInfo): number {
    let baseDelay = this.config.initialDelayMs

    // Use error-specific suggested delay
    if (errorInfo?.suggestedDelayMs) {
      baseDelay = Math.max(baseDelay, errorInfo.suggestedDelayMs)
    }

    // Exponential backoff
    const exponentialDelay = baseDelay * Math.pow(this.config.backoffMultiplier, attempt)
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelayMs)

    // Add jitter to prevent thundering herd
    const jitterAmount = cappedDelay * this.config.jitterFactor
    const jitter = jitterAmount * (Math.random() * 2 - 1)

    return Math.max(0, cappedDelay + jitter)
  }

  /**
   * Execute function with adaptive retry
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    onError?: (error: RpcErrorInfo, attempt: number) => void,
  ): Promise<T> {
    let lastError: RpcErrorInfo | null = null

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await Promise.race([
          fn(),
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error('Request timeout')), this.config.requestTimeoutMs),
          ),
        ])
      } catch (error) {
        lastError = classifyRpcError(error)

        if (!lastError.retryable || attempt === this.config.maxRetries) {
          onError?.(lastError, attempt)
          throw error
        }

        const delay = this.calculateDelay(attempt, lastError)
        onError?.(lastError, attempt)

        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    throw new Error(`Failed after ${this.config.maxRetries} retries`)
  }
}

/**
 * Request deduplication cache to prevent duplicate RPC calls
 */
export class RequestDeduplicationCache {
  private cache = new Map<string, { result: unknown; expiresAt: number }>()
  private pending = new Map<string, Promise<unknown>>()
  private readonly windowMs: number

  constructor(windowMs: number = 5000) {
    this.windowMs = windowMs
  }

  private createKey(fn: string, params: unknown[]): string {
    return `${fn}:${JSON.stringify(params)}`
  }

  async deduplicate<T>(fn: string, params: unknown[], executor: () => Promise<T>): Promise<T> {
    const key = this.createKey(fn, params)
    const now = Date.now()

    // Check if result is still cached
    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > now) {
      return cached.result as T
    }

    // Check if request is in-flight
    const pending = this.pending.get(key)
    if (pending) {
      return pending as Promise<T>
    }

    // Execute new request
    const promise = executor().then((result) => {
      this.cache.set(key, { result, expiresAt: now + this.windowMs })
      this.pending.delete(key)
      return result
    })

    this.pending.set(key, promise)
    return promise as Promise<T>
  }

  clear(): void {
    this.cache.clear()
    this.pending.clear()
  }
}

/**
 * Circuit breaker with half-open state support
 */
export class RpcCircuitBreaker {
  private state: 'closed' | 'open' | 'half_open' = 'closed'
  private failureCount = 0
  private successCount = 0
  private lastFailureAt = 0
  private readonly failureThreshold: number
  private readonly successThreshold: number
  private readonly resetMs: number

  constructor(failureThreshold: number = 10, successThreshold: number = 3, resetMs: number = 60000) {
    this.failureThreshold = failureThreshold
    this.successThreshold = successThreshold
    this.resetMs = resetMs
  }

  canExecute(): boolean {
    if (this.state === 'closed') return true

    if (this.state === 'open') {
      if (Date.now() - this.lastFailureAt > this.resetMs) {
        this.state = 'half_open'
        this.successCount = 0
        return true
      }
      return false
    }

    return this.state === 'half_open'
  }

  recordSuccess(): void {
    this.failureCount = 0

    if (this.state === 'half_open') {
      this.successCount += 1
      if (this.successCount >= this.successThreshold) {
        this.state = 'closed'
        this.successCount = 0
      }
    }
  }

  recordFailure(): void {
    this.lastFailureAt = Date.now()
    this.failureCount += 1

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'open'
    }
  }

  getState(): 'closed' | 'open' | 'half_open' {
    return this.state
  }
}

/**
 * Metrics collector for RPC performance tracking
 */
export class RpcMetricsCollector {
  private metrics = new Map<string, RpcMetrics>()
  private latencies = new Map<string, number[]>()

  initialize(chainKey: string): void {
    if (!this.metrics.has(chainKey)) {
      this.metrics.set(chainKey, {
        chainKey,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        retriedRequests: 0,
        timeoutErrors: 0,
        rateLimitErrors: 0,
        circuitBreakerTrips: 0,
        averageLatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        lastUpdatedAt: new Date().toISOString(),
      })
      this.latencies.set(chainKey, [])
    }
  }

  recordRequest(chainKey: string, latencyMs: number, error?: RpcErrorInfo): void {
    this.initialize(chainKey)
    const metrics = this.metrics.get(chainKey)!
    const latencies = this.latencies.get(chainKey)!

    metrics.totalRequests += 1
    latencies.push(latencyMs)

    if (error) {
      metrics.failedRequests += 1
      if (error.category === 'timeout') metrics.timeoutErrors += 1
      if (error.category === 'rate_limited') metrics.rateLimitErrors += 1
    } else {
      metrics.successfulRequests += 1
    }

    this.updatePercentiles(chainKey)
    metrics.lastUpdatedAt = new Date().toISOString()
  }

  recordRetry(chainKey: string): void {
    this.initialize(chainKey)
    this.metrics.get(chainKey)!.retriedRequests += 1
  }

  recordCircuitBreakerTrip(chainKey: string): void {
    this.initialize(chainKey)
    this.metrics.get(chainKey)!.circuitBreakerTrips += 1
  }

  private updatePercentiles(chainKey: string): void {
    const latencies = this.latencies.get(chainKey)!
    const metrics = this.metrics.get(chainKey)!

    if (latencies.length === 0) return

    const sorted = [...latencies].sort((a, b) => a - b)
    const sum = sorted.reduce((a, b) => a + b, 0)

    metrics.averageLatencyMs = sum / sorted.length
    metrics.p95LatencyMs = sorted[Math.floor(sorted.length * 0.95)]
    metrics.p99LatencyMs = sorted[Math.floor(sorted.length * 0.99)]

    // Keep only last 1000 measurements to prevent memory bloat
    if (latencies.length > 1000) {
      this.latencies.set(chainKey, latencies.slice(-1000))
    }
  }

  getMetrics(chainKey: string): RpcMetrics | null {
    return this.metrics.get(chainKey) ?? null
  }

  getAllMetrics(): RpcMetrics[] {
    return Array.from(this.metrics.values())
  }

  reset(chainKey?: string): void {
    if (chainKey) {
      this.metrics.delete(chainKey)
      this.latencies.delete(chainKey)
    } else {
      this.metrics.clear()
      this.latencies.clear()
    }
  }
}

// Global singleton instances
let retryStrategyInstance: AdaptiveRetryStrategy | null = null
let rateLimiterInstances = new Map<string, RateLimiter>()
let circuitBreakerInstances = new Map<string, RpcCircuitBreaker>()
let metricsInstance: RpcMetricsCollector | null = null
let deduplicationCache: RequestDeduplicationCache | null = null

export function getAdaptiveRetryStrategy(config?: RpcResilienceConfig): AdaptiveRetryStrategy {
  if (!retryStrategyInstance) {
    retryStrategyInstance = new AdaptiveRetryStrategy(config)
  }
  return retryStrategyInstance
}

export function getRateLimiter(chainKey: string, tokensPerSecond: number = 100): RateLimiter {
  if (!rateLimiterInstances.has(chainKey)) {
    rateLimiterInstances.set(chainKey, new RateLimiter(tokensPerSecond))
  }
  return rateLimiterInstances.get(chainKey)!
}

export function getCircuitBreaker(chainKey: string): RpcCircuitBreaker {
  if (!circuitBreakerInstances.has(chainKey)) {
    circuitBreakerInstances.set(chainKey, new RpcCircuitBreaker())
  }
  return circuitBreakerInstances.get(chainKey)!
}

export function getMetricsCollector(): RpcMetricsCollector {
  if (!metricsInstance) {
    metricsInstance = new RpcMetricsCollector()
  }
  return metricsInstance
}

export function getDeduplicationCache(windowMs?: number): RequestDeduplicationCache {
  if (!deduplicationCache) {
    deduplicationCache = new RequestDeduplicationCache(windowMs)
  }
  return deduplicationCache
}
