// @ts-nocheck
/**
 * Signature Cache — memoize validated signatures to prevent re-validation.
 * Improves performance and reduces RPC calls for repeated requests.
 */

export type CachedSignature = {
  signature_hash: string
  chain: string
  is_valid: boolean
  signer?: string
  cached_at: number
  expires_at: number
}

export class SignatureCache {
  private cache: Map<string, CachedSignature>
  private maxSize: number
  private ttlMs: number

  constructor(maxSize: number = 10000, ttlMs: number = 3600000) {
    this.cache = new Map()
    this.maxSize = maxSize
    this.ttlMs = ttlMs
  }

  set(signatureHash: string, validation: { chain: string; is_valid: boolean; signer?: string }): void {
    this.cleanup()

    if (this.cache.size >= this.maxSize) {
      const first = this.cache.keys().next().value
      if (first) this.cache.delete(first)
    }

    const now = Date.now()
    this.cache.set(signatureHash, {
      signature_hash: signatureHash,
      chain: validation.chain,
      is_valid: validation.is_valid,
      signer: validation.signer,
      cached_at: now,
      expires_at: now + this.ttlMs,
    })
  }

  get(signatureHash: string): CachedSignature | null {
    const cached = this.cache.get(signatureHash)
    if (!cached) return null

    const now = Date.now()
    if (now > cached.expires_at) {
      this.cache.delete(signatureHash)
      return null
    }

    return cached
  }

  has(signatureHash: string): boolean {
    return this.get(signatureHash) !== null
  }

  invalidate(signatureHash: string): void {
    this.cache.delete(signatureHash)
  }

  invalidateByChain(chain: string): void {
    const toDelete: string[] = []
    this.cache.forEach((v, k) => {
      if (v.chain === chain) toDelete.push(k)
    })
    toDelete.forEach((k) => this.cache.delete(k))
  }

  clear(): void {
    this.cache.clear()
  }

  private cleanup(): void {
    const now = Date.now()
    const expired: string[] = []
    this.cache.forEach((v, k) => {
      if (now > v.expires_at) expired.push(k)
    })
    expired.forEach((k) => this.cache.delete(k))
  }

  getStats(): { size: number; max_size: number } {
    this.cleanup()
    return { size: this.cache.size, max_size: this.maxSize }
  }
}

// Global singleton
let _instance: SignatureCache | null = null

export function getSignatureCache(): SignatureCache {
  if (!_instance) {
    _instance = new SignatureCache()
  }
  return _instance
}
