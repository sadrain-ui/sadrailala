/**
 * LEVEL 7: Cache Layer Simulator
 *
 * Redis-compatible cache simulation:
 * - Key-value storage
 * - Expiration/TTL
 * - Cache invalidation
 * - Hit/miss tracking
 * - Pub/Sub simulation
 *
 * Result: Full caching without external Redis (100% independent)
 */

export interface CacheEntry {
  key: string
  value: any
  expires_at: number
  created_at: number
  ttl_ms: number
  hits: number
  last_accessed: number
}

export interface CacheStats {
  entries: number
  hits: number
  misses: number
  evictions: number
  hit_rate: number
  memory_bytes: number
}

export class EcosystemCacheLayer {
  private cache: Map<string, CacheEntry> = new Map()
  private subscribers: Map<string, Set<(value: any) => void>> = new Map()
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  }
  private readonly maxMemory = 100 * 1024 * 1024 // 100 MB
  private currentMemory = 0

  constructor() {
    // Cleanup expired entries every 60 seconds
    setInterval(() => this.cleanupExpired(), 60000)
  }

  /**
   * Set cache value with TTL
   */
  set(key: string, value: any, ttl_ms: number = 5 * 60 * 1000): void {
    // Check memory before setting
    const valueSize = this.estimateSize(value)

    if (this.currentMemory + valueSize > this.maxMemory) {
      this.evictLRU()
    }

    // Remove old entry if exists
    if (this.cache.has(key)) {
      this.currentMemory -= this.estimateSize(this.cache.get(key)!.value)
    }

    const entry: CacheEntry = {
      key,
      value,
      expires_at: Date.now() + ttl_ms,
      created_at: Date.now(),
      ttl_ms,
      hits: 0,
      last_accessed: Date.now(),
    }

    this.cache.set(key, entry)
    this.currentMemory += valueSize
  }

  /**
   * Get cache value
   */
  get(key: string): any | undefined {
    const entry = this.cache.get(key)

    if (!entry) {
      this.stats.misses++
      return undefined
    }

    // Check expiration
    if (Date.now() > entry.expires_at) {
      this.cache.delete(key)
      this.currentMemory -= this.estimateSize(entry.value)
      this.stats.misses++
      return undefined
    }

    // Update stats
    entry.hits++
    entry.last_accessed = Date.now()
    this.stats.hits++

    return entry.value
  }

  /**
   * Delete cache value
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key)

    if (!entry) {
      return false
    }

    this.cache.delete(key)
    this.currentMemory -= this.estimateSize(entry.value)

    // Notify subscribers
    this.publish(`__keyspace_notification__:${key}`, 'del')

    return true
  }

  /**
   * Check if key exists
   */
  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false

    if (Date.now() > entry.expires_at) {
      this.cache.delete(key)
      return false
    }

    return true
  }

  /**
   * Get value and extend TTL
   */
  getex(key: string, ttl_ms?: number): any | undefined {
    const value = this.get(key)

    if (value !== undefined && ttl_ms) {
      const entry = this.cache.get(key)!
      entry.expires_at = Date.now() + ttl_ms
    }

    return value
  }

  /**
   * Increment numeric value
   */
  incr(key: string, amount: number = 1): number {
    const current = this.get(key) ?? 0
    const newValue = typeof current === 'number' ? current + amount : amount

    this.set(key, newValue)
    return newValue
  }

  /**
   * Append string value
   */
  append(key: string, value: string): number {
    const current = this.get(key) ?? ''
    const newValue = current.toString() + value

    this.set(key, newValue)
    return newValue.length
  }

  /**
   * Get all keys matching pattern
   */
  keys(pattern: string = '*'): string[] {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'))
    return Array.from(this.cache.keys()).filter((key) => regex.test(key) && !this.isExpired(key))
  }

  /**
   * Pub/Sub: Subscribe to channel
   */
  subscribe(channel: string, callback: (value: any) => void): () => void {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set())
    }

    this.subscribers.get(channel)!.add(callback)

    // Return unsubscribe function
    return () => {
      this.subscribers.get(channel)?.delete(callback)
    }
  }

  /**
   * Pub/Sub: Publish to channel
   */
  publish(channel: string, message: any): number {
    const subscribers = this.subscribers.get(channel)
    if (!subscribers) return 0

    subscribers.forEach((callback) => {
      try {
        callback(message)
      } catch (error) {
        console.error('[L7 Cache] Subscriber error:', error)
      }
    })

    return subscribers.size
  }

  /**
   * Set with expiration time
   */
  setex(key: string, ttl_sec: number, value: any): void {
    this.set(key, value, ttl_sec * 1000)
  }

  /**
   * Multiply TTL
   */
  expire(key: string, ttl_sec: number): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false

    entry.expires_at = Date.now() + ttl_sec * 1000
    return true
  }

  /**
   * Get TTL remaining
   */
  ttl(key: string): number {
    const entry = this.cache.get(key)
    if (!entry) return -1

    if (this.isExpired(key)) {
      this.delete(key)
      return -1
    }

    return Math.ceil((entry.expires_at - Date.now()) / 1000)
  }

  /**
   * Clear all cache
   */
  flush(): void {
    this.cache.clear()
    this.currentMemory = 0
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return {
      entries: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      hit_rate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
      memory_bytes: this.currentMemory,
    }
  }

  /**
   * Get entry details
   */
  info(key: string): CacheEntry | undefined {
    return this.cache.get(key)
  }

  /**
   * List all entries with stats
   */
  listAll(): CacheEntry[] {
    return Array.from(this.cache.values()).filter((entry) => !this.isExpired(entry.key))
  }

  /**
   * Private: Check if entry expired
   */
  private isExpired(key: string): boolean {
    const entry = this.cache.get(key)
    return !entry || Date.now() > entry.expires_at
  }

  /**
   * Private: Cleanup expired entries
   */
  private cleanupExpired(): void {
    const now = Date.now()
    const toDelete: string[] = []

    this.cache.forEach((entry, key) => {
      if (now > entry.expires_at) {
        toDelete.push(key)
      }
    })

    toDelete.forEach((key) => {
      const entry = this.cache.get(key)!
      this.currentMemory -= this.estimateSize(entry.value)
      this.cache.delete(key)
    })
  }

  /**
   * Private: Evict least recently used entries
   */
  private evictLRU(): void {
    let lruKey: string | null = null
    let lruTime = Date.now()

    this.cache.forEach((entry, key) => {
      if (entry.last_accessed < lruTime) {
        lruTime = entry.last_accessed
        lruKey = key
      }
    })

    if (lruKey) {
      const entry = this.cache.get(lruKey)!
      this.currentMemory -= this.estimateSize(entry.value)
      this.cache.delete(lruKey)
      this.stats.evictions++
    }
  }

  /**
   * Private: Estimate object size in bytes
   */
  private estimateSize(value: any): number {
    if (value === null || value === undefined) return 0

    if (typeof value === 'string') {
      return value.length * 2 // UTF-16
    }

    if (typeof value === 'number') {
      return 8
    }

    if (typeof value === 'boolean') {
      return 4
    }

    if (Array.isArray(value)) {
      return value.reduce((sum, item) => sum + this.estimateSize(item), 0)
    }

    if (typeof value === 'object') {
      return Object.values(value).reduce((sum, item) => sum + this.estimateSize(item), 0)
    }

    return 0
  }

  /**
   * Export cache state
   */
  export() {
    return {
      entries: this.listAll(),
      stats: this.getStats(),
      memory_limit: this.maxMemory,
    }
  }
}

export const cacheLayer = new EcosystemCacheLayer()
