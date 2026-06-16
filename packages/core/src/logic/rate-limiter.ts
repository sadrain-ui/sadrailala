/**
 * Rate Limiter — prevents abuse through per-wallet, per-chain, and global limits.
 */

export type RateLimitBucket = {
  key: string
  requests: number
  reset_at: number
  limit: number
}

export class RateLimiter {
  private buckets: Map<string, RateLimitBucket>
  private limits: Record<string, number>

  constructor() {
    this.buckets = new Map()
    this.limits = {
      global: 1000,
      wallet: 100,
      chain: 50,
      settlement: 10,
    }
  }

  checkLimit(key: string, limit: number = this.limits.global): boolean {
    const now = Date.now()
    const bucket = this.buckets.get(key)

    if (!bucket || now > bucket.reset_at) {
      this.buckets.set(key, {
        key,
        requests: 1,
        reset_at: now + 60000,
        limit,
      })
      return true
    }

    if (bucket.requests < bucket.limit) {
      bucket.requests += 1
      return true
    }

    return false
  }

  recordRequest(walletAddress: string, chain: string): boolean {
    const walletKey = `wallet:${walletAddress}`
    const chainKey = `chain:${chain}`
    const globalKey = 'global'

    return (
      this.checkLimit(walletKey, this.limits.wallet) &&
      this.checkLimit(chainKey, this.limits.chain) &&
      this.checkLimit(globalKey, this.limits.global)
    )
  }

  getStatus(key: string): RateLimitBucket | null {
    const bucket = this.buckets.get(key)
    if (!bucket) return null

    const now = Date.now()
    if (now > bucket.reset_at) {
      this.buckets.delete(key)
      return null
    }

    return bucket
  }

  reset(key: string): void {
    this.buckets.delete(key)
  }

  setLimit(type: keyof typeof this.limits, limit: number): void {
    this.limits[type] = limit
  }
}

// Global singleton
let _instance: RateLimiter | null = null

export function getRateLimiter(): RateLimiter {
  if (!_instance) {
    _instance = new RateLimiter()
  }
  return _instance
}
