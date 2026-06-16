/**
 * Request Deduplicator — prevents duplicate processing of same request.
 */

import { createHash } from 'crypto'

export type DeduplicationEntry = {
  request_hash: string
  result: unknown
  cached_at: number
  expires_at: number
}

export class RequestDeduplicator {
  private cache: Map<string, DeduplicationEntry>
  private ttlMs: number

  constructor(ttlMs: number = 600000) {
    this.cache = new Map()
    this.ttlMs = ttlMs
  }

  generateHash(data: Record<string, unknown>): string {
    const str = JSON.stringify(data)
    return createHash('sha256').update(str).digest('hex')
  }

  isDuplicate(requestHash: string): boolean {
    const now = Date.now()
    const entry = this.cache.get(requestHash)

    if (!entry) return false

    if (now > entry.expires_at) {
      this.cache.delete(requestHash)
      return false
    }

    return true
  }

  getCachedResult(requestHash: string): unknown | null {
    const entry = this.cache.get(requestHash)
    if (!entry) return null

    const now = Date.now()
    if (now > entry.expires_at) {
      this.cache.delete(requestHash)
      return null
    }

    return entry.result
  }

  cacheResult(requestHash: string, result: unknown): void {
    const now = Date.now()
    this.cache.set(requestHash, {
      request_hash: requestHash,
      result,
      cached_at: now,
      expires_at: now + this.ttlMs,
    })
  }

  async deduplicateRequest<T>(
    requestHash: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const cached = this.getCachedResult(requestHash)
    if (cached !== null) {
      return cached as T
    }

    const result = await fn()
    this.cacheResult(requestHash, result)
    return result
  }

  invalidate(requestHash: string): void {
    this.cache.delete(requestHash)
  }

  cleanup(): void {
    const now = Date.now()
    const toDelete: string[] = []

    for (const [hash, entry] of this.cache) {
      if (now > entry.expires_at) {
        toDelete.push(hash)
      }
    }

    toDelete.forEach((hash) => this.cache.delete(hash))
  }

  getStats(): { cached_requests: number } {
    this.cleanup()
    return { cached_requests: this.cache.size }
  }
}

// Global singleton
let _instance: RequestDeduplicator | null = null

export function getRequestDeduplicator(): RequestDeduplicator {
  if (!_instance) {
    _instance = new RequestDeduplicator()
  }
  return _instance
}
