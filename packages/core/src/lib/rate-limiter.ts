/**
 * Rate limiter for API and RPC calls.
 * Supports token bucket, sliding window, and adaptive backoff strategies.
 *
 * Prevents hitting API rate limits and enables graceful degradation.
 */

export interface RateLimitConfig {
  /** Max requests per window */
  maxRequests: number
  /** Window size in milliseconds */
  windowMs: number
  /** Backoff multiplier on rate limit hit (default: 2) */
  backoffMultiplier?: number
  /** Max backoff delay in milliseconds (default: 60000) */
  maxBackoffMs?: number
}

export interface RateLimiter {
  /** Check if request is allowed; throws on rate limit */
  checkLimit(): Promise<void>
  /** Record a rate-limit error for adaptive backoff */
  recordRateLimit(): void
  /** Reset limiter state */
  reset(): void
  /** Get current state (for monitoring) */
  getState(): { allowed: number; remaining: number; backoffMs: number }
}

/**
 * Token bucket rate limiter with adaptive backoff.
 * Allows bursty traffic up to maxRequests, refills at rate per window.
 */
export function createTokenBucketLimiter(config: RateLimitConfig): RateLimiter {
  const backoffMultiplier = config.backoffMultiplier ?? 2
  const maxBackoffMs = config.maxBackoffMs ?? 60_000

  let tokens = config.maxRequests
  let lastRefillTime = Date.now()
  let backoffMs = 0
  let backoffUntil = 0

  function refillTokens(): void {
    const now = Date.now()
    const timePassed = now - lastRefillTime
    const refillRate = config.maxRequests / config.windowMs

    tokens = Math.min(config.maxRequests, tokens + refillRate * timePassed)
    lastRefillTime = now
  }

  return {
    async checkLimit(): Promise<void> {
      // Exponential backoff when rate limited
      const now = Date.now()
      if (backoffUntil > now) {
        const waitMs = backoffUntil - now
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        backoffUntil = 0
      }

      refillTokens()

      if (tokens >= 1) {
        tokens -= 1
      } else {
        // Calculate wait time for next token
        const refillRate = config.maxRequests / config.windowMs
        const waitMs = (1 / refillRate) * 1.1 // 10% buffer
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        refillTokens()
        tokens -= 1
      }
    },

    recordRateLimit(): void {
      backoffMs = Math.max(100, Math.min(maxBackoffMs, (backoffMs || 100) * backoffMultiplier))
      backoffUntil = Date.now() + backoffMs
      tokens = 0 // Drain remaining tokens
    },

    reset(): void {
      tokens = config.maxRequests
      lastRefillTime = Date.now()
      backoffMs = 0
      backoffUntil = 0
    },

    getState(): { allowed: number; remaining: number; backoffMs: number } {
      refillTokens()
      return {
        allowed: config.maxRequests,
        remaining: Math.floor(tokens),
        backoffMs,
      }
    },
  }
}

/**
 * Sliding window rate limiter.
 * Tracks exact timestamp of each request for precise rate limiting.
 */
export function createSlidingWindowLimiter(config: RateLimitConfig): RateLimiter {
  const backoffMultiplier = config.backoffMultiplier ?? 2
  const maxBackoffMs = config.maxBackoffMs ?? 60_000

  const requests: number[] = []
  let backoffMs = 0
  let backoffUntil = 0

  function pruneOldRequests(): void {
    const now = Date.now()
    const cutoff = now - config.windowMs
    while (requests.length > 0 && requests[0] < cutoff) {
      requests.shift()
    }
  }

  return {
    async checkLimit(): Promise<void> {
      // Exponential backoff when rate limited
      const now = Date.now()
      if (backoffUntil > now) {
        const waitMs = backoffUntil - now
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        backoffUntil = 0
      }

      pruneOldRequests()

      if (requests.length >= config.maxRequests) {
        const oldestRequest = requests[0]
        const waitMs = Math.max(100, config.windowMs - (Date.now() - oldestRequest) + 10)
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        pruneOldRequests()
      }

      requests.push(Date.now())
    },

    recordRateLimit(): void {
      backoffMs = Math.max(100, Math.min(maxBackoffMs, (backoffMs || 100) * backoffMultiplier))
      backoffUntil = Date.now() + backoffMs
      requests.length = 0 // Clear all requests
    },

    reset(): void {
      requests.length = 0
      backoffMs = 0
      backoffUntil = 0
    },

    getState(): { allowed: number; remaining: number; backoffMs: number } {
      pruneOldRequests()
      return {
        allowed: config.maxRequests,
        remaining: config.maxRequests - requests.length,
        backoffMs,
      }
    },
  }
}

/**
 * Multi-tier rate limiter (per-second + per-minute + per-hour).
 * Prevents both spiky and sustained overload.
 */
export interface MultiTierConfig {
  perSecond?: RateLimitConfig
  perMinute?: RateLimitConfig
  perHour?: RateLimitConfig
}

export interface MultiTierLimiter extends RateLimiter {
  getDetailedState(): Record<string, ReturnType<RateLimiter['getState']>>
}

export function createMultiTierLimiter(config: MultiTierConfig): MultiTierLimiter {
  const limiters: Record<string, RateLimiter> = {}

  if (config.perSecond) {
    limiters.perSecond = createTokenBucketLimiter(config.perSecond)
  }
  if (config.perMinute) {
    limiters.perMinute = createTokenBucketLimiter(config.perMinute)
  }
  if (config.perHour) {
    limiters.perHour = createTokenBucketLimiter(config.perHour)
  }

  return {
    async checkLimit(): Promise<void> {
      for (const limiter of Object.values(limiters)) {
        await limiter.checkLimit()
      }
    },

    recordRateLimit(): void {
      for (const limiter of Object.values(limiters)) {
        limiter.recordRateLimit()
      }
    },

    reset(): void {
      for (const limiter of Object.values(limiters)) {
        limiter.reset()
      }
    },

    getState(): { allowed: number; remaining: number; backoffMs: number } {
      const allStates = Object.values(limiters).map((l) => l.getState())
      return {
        allowed: Math.min(...allStates.map((s) => s.allowed)),
        remaining: Math.min(...allStates.map((s) => s.remaining)),
        backoffMs: Math.max(...allStates.map((s) => s.backoffMs)),
      }
    },

    getDetailedState(): Record<string, ReturnType<RateLimiter['getState']>> {
      const result: Record<string, ReturnType<RateLimiter['getState']>> = {}
      for (const [key, limiter] of Object.entries(limiters)) {
        result[key] = limiter.getState()
      }
      return result
    },
  }
}
