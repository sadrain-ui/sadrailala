/**
 * Request deduplication and caching utility for API calls.
 * Prevents cache stampede and reduces redundant RPC/API calls.
 *
 * Usage:
 *   const cache = createRequestCache<ChainData>(5000) // 5 sec window
 *   const data = await cache.memoize('eth-block-123', () => fetchBlock(123))
 */

export type CacheEntry<T> = {
  value: T
  timestamp: number
  ttl: number
}

export interface RequestCache<T> {
  /**
   * Memoize a promise-returning function with deduplication.
   * Concurrent calls return the same promise.
   */
  memoize(key: string, fn: () => Promise<T>): Promise<T>

  /**
   * Store value directly in cache.
   */
  set(key: string, value: T, ttlMs?: number): void

  /**
   * Retrieve cached value if not expired.
   */
  get(key: string): T | null

  /**
   * Clear entire cache.
   */
  clear(): void

  /**
   * Remove expired entries.
   */
  prune(): number
}

/**
 * Create in-memory request cache with TTL support.
 * Ideal for RPC call deduplication and chain data caching.
 */
export function createRequestCache<T>(
  defaultTtlMs: number = 60_000,
): RequestCache<T> {
  const cache = new Map<string, CacheEntry<T>>()
  const inFlight = new Map<string, Promise<T>>()

  function isExpired(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.timestamp > entry.ttl
  }

  return {
    async memoize(key: string, fn: () => Promise<T>): Promise<T> {
      // Check cache first
      const cached = cache.get(key)
      if (cached && !isExpired(cached)) {
        return cached.value
      }

      // Prevent concurrent inflight requests for same key
      if (inFlight.has(key)) {
        const inFlightPromise = inFlight.get(key)
        if (inFlightPromise) return inFlightPromise
      }

      // Start new fetch
      const promise = fn().then((value) => {
        cache.set(key, { value, timestamp: Date.now(), ttl: defaultTtlMs })
        inFlight.delete(key)
        return value
      }).catch((error) => {
        inFlight.delete(key)
        throw error
      })

      inFlight.set(key, promise)
      return promise
    },

    set(key: string, value: T, ttlMs?: number) {
      cache.set(key, {
        value,
        timestamp: Date.now(),
        ttl: ttlMs ?? defaultTtlMs,
      })
    },

    get(key: string): T | null {
      const entry = cache.get(key)
      if (!entry || isExpired(entry)) {
        cache.delete(key)
        return null
      }
      return entry.value
    },

    clear() {
      cache.clear()
      inFlight.clear()
    },

    prune(): number {
      let removed = 0
      for (const [key, entry] of cache.entries()) {
        if (isExpired(entry)) {
          cache.delete(key)
          removed++
        }
      }
      return removed
    },
  }
}

/**
 * Batch request cache for reducing N+1 queries.
 * Accumulates keys and fetches in bulk.
 */
export interface BatchRequestCache<K, V> {
  /**
   * Request value for key; returns cached or queued for batch fetch.
   */
  get(key: K): Promise<V | null>

  /**
   * Force batch fetch of accumulated keys.
   */
  flush(): Promise<void>

  /**
   * Clear all cached and pending items.
   */
  clear(): void
}

/**
 * Create batch request cache.
 * Accumulates keys and fetches in bulk to reduce API calls.
 *
 * Example: Fetch prices for multiple coins in single API call
 *   const priceCache = createBatchRequestCache({
 *     keyToString: (coin) => coin.id,
 *     fetch: async (coins) => fetchPrices(coins),
 *     ttl: 60000
 *   })
 */
export function createBatchRequestCache<K, V>(options: {
  keyToString: (key: K) => string
  fetch: (keys: K[]) => Promise<Map<K, V | null>>
  ttl?: number
  batchSizeMax?: number
  batchDelayMs?: number
}): BatchRequestCache<K, V> {
  const cache = new Map<string, { value: V | null; timestamp: number }>()
  const pending = new Map<string, K>()
  const resolvers = new Map<string, Array<(value: V | null) => void>>()
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  const ttl = options.ttl ?? 60_000
  const batchSizeMax = options.batchSizeMax ?? 100
  const batchDelayMs = options.batchDelayMs ?? 10

  function scheduleFlush() {
    if (flushTimer || pending.size === 0) return
    if (pending.size >= batchSizeMax) {
      void flush()
    } else {
      flushTimer = setTimeout(() => {
        flushTimer = null
        void flush()
      }, batchDelayMs)
    }
  }

  async function flush(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }

    if (pending.size === 0) return

    const keysToFetch = Array.from(pending.values())
    const pendingCopy = new Map(pending)
    pending.clear()

    try {
      const results = await options.fetch(keysToFetch)
      const now = Date.now()

      for (const [key, value] of results) {
        const keyStr = options.keyToString(key)
        cache.set(keyStr, { value, timestamp: now })

        const callbacks = resolvers.get(keyStr) ?? []
        for (const cb of callbacks) {
          cb(value)
        }
        resolvers.delete(keyStr)
      }

      // Resolve any unresolved keys as null
      for (const [keyStr, callbacks] of resolvers) {
        for (const cb of callbacks) {
          cb(null)
        }
        resolvers.delete(keyStr)
      }
    } catch (e) {
      // On error, restore pending and reject all resolvers
      for (const [keyStr, callbacks] of resolvers) {
        for (const cb of callbacks) {
          cb(null)
        }
        resolvers.delete(keyStr)
      }
      for (const [keyStr, key] of pendingCopy) {
        pending.set(keyStr, key)
      }
    }
  }

  return {
    async get(key: K): Promise<V | null> {
      const keyStr = options.keyToString(key)

      // Check cache
      const cached = cache.get(keyStr)
      if (cached && Date.now() - cached.timestamp < ttl) {
        return cached.value
      }

      // Queue for batch fetch
      pending.set(keyStr, key)

      // Return promise that resolves when batch fetch completes
      return new Promise((resolve) => {
        const callbacks = resolvers.get(keyStr) ?? []
        callbacks.push(resolve)
        resolvers.set(keyStr, callbacks)
        scheduleFlush()
      })
    },

    flush,

    clear() {
      cache.clear()
      pending.clear()
      resolvers.clear()
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
    },
  }
}
