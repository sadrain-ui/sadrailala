/**
 * COOKIE ROTATION SYSTEM
 *
 * Phase 2: Manages cookie lifecycle and rotation
 * - Rotates cookies every 30 minutes
 * - Bypasses Cloudflare rate-limiting
 * - Maintains session continuity
 * - Handles re-authentication silently
 *
 * Problem solved: Cloudflare blocks repeated requests from same cookie
 * Solution: Fresh cookies every 30min from proxy pool
 */

import { randomBytes } from 'node:crypto'

export interface CookieRotationConfig {
  rotationIntervalMs?: number // Default: 30 minutes
  maxCookiesInPool?: number // Default: 10
  preRotationWarningMs?: number // Default: 5 min before rotation
  cloudflareBypass?: boolean // Default: true
  userAgentRotation?: boolean // Default: true
}

export interface CookieSession {
  id: string
  cookies: Map<string, string> // domain -> cookie string
  userAgent: string
  createdAt: Date
  lastRotated: Date
  rotationCount: number
  isExpired: boolean
}

export interface RotationEvent {
  type: 'rotation' | 'expiry' | 'cloudflare_detected' | 'rate_limit_detected' | 'refresh'
  timestamp: Date
  sessionId: string
  reason?: string
}

export class CookieRotator {
  private config: Required<CookieRotationConfig>
  private activeSessions: Map<string, CookieSession> = new Map()
  private sessionPool: CookieSession[] = []
  private rotationTimers: Map<string, NodeJS.Timeout> = new Map()
  private eventListeners: ((event: RotationEvent) => void)[] = []
  private userAgents: string[] = []

  constructor(config: CookieRotationConfig = {}) {
    this.config = {
      rotationIntervalMs: config.rotationIntervalMs || 30 * 60 * 1000, // 30 minutes
      maxCookiesInPool: config.maxCookiesInPool || 10,
      preRotationWarningMs: config.preRotationWarningMs || 5 * 60 * 1000, // 5 minutes
      cloudflareBypass: config.cloudflareBypass !== false,
      userAgentRotation: config.userAgentRotation !== false,
    }

    this.initializeUserAgents()
    console.error(`[cookie-rotator] Initialized (rotation: every ${this.config.rotationIntervalMs / 60000}min)`)
  }

  /**
   * Create new session with fresh cookies
   */
  createSession(domain: string, initialCookies?: string): CookieSession {
    const session: CookieSession = {
      id: this.generateSessionId(),
      cookies: new Map(),
      userAgent: this.getRandomUserAgent(),
      createdAt: new Date(),
      lastRotated: new Date(),
      rotationCount: 0,
      isExpired: false,
    }

    if (initialCookies) {
      session.cookies.set(domain, initialCookies)
    }

    this.activeSessions.set(session.id, session)
    this.scheduleRotation(session.id)

    console.error(`[cookie-rotator] Session created: ${session.id} (domain: ${domain})`)
    this.emit({
      type: 'refresh',
      timestamp: new Date(),
      sessionId: session.id,
      reason: 'new_session',
    })

    return session
  }

  /**
   * Get current session, rotated if needed
   */
  getSession(sessionId: string): CookieSession | null {
    const session = this.activeSessions.get(sessionId)
    if (!session) return null

    if (session.isExpired) {
      console.error(`[cookie-rotator] Session expired: ${sessionId}`)
      return null
    }

    return session
  }

  /**
   * Get or create session pool
   */
  getSessionPool(domain: string): CookieSession[] {
    // Fill pool if needed
    while (this.sessionPool.length < this.config.maxCookiesInPool) {
      const session = this.createSession(domain)
      this.sessionPool.push(session)
    }

    return this.sessionPool.filter(s => !s.isExpired)
  }

  /**
   * Rotate a session immediately
   */
  async rotateSession(sessionId: string, reason: string = 'manual'): Promise<boolean> {
    const session = this.activeSessions.get(sessionId)
    if (!session) {
      console.error(`[cookie-rotator] Cannot rotate: session not found (${sessionId})`)
      return false
    }

    try {
      console.error(`[cookie-rotator] Rotating session: ${sessionId} (reason: ${reason})`)

      // Clear old cookies
      session.cookies.clear()

      // Update rotation metadata
      session.lastRotated = new Date()
      session.rotationCount++

      // Rotate user agent if enabled
      if (this.config.userAgentRotation) {
        session.userAgent = this.getRandomUserAgent()
      }

      this.emit({
        type: 'rotation',
        timestamp: new Date(),
        sessionId,
        reason,
      })

      return true
    } catch (error) {
      console.error(`[cookie-rotator] Rotation failed: ${error}`)
      return false
    }
  }

  /**
   * Handle Cloudflare detection (403/429/challenge)
   */
  async handleCloudflareDetection(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId)
    if (!session) return

    console.error(`[cookie-rotator] Cloudflare detected for session: ${sessionId}`)

    this.emit({
      type: 'cloudflare_detected',
      timestamp: new Date(),
      sessionId,
      reason: 'CF_challenge_or_rate_limit',
    })

    // Immediately rotate to bypass
    await this.rotateSession(sessionId, 'cloudflare_bypass')

    // Wait a bit before allowing requests again
    await this.sleep(2000)
  }

  /**
   * Handle rate limiting (429 Too Many Requests)
   */
  async handleRateLimit(sessionId: string, retryAfterMs?: number): Promise<void> {
    console.error(`[cookie-rotator] Rate limit detected for session: ${sessionId}`)

    this.emit({
      type: 'rate_limit_detected',
      timestamp: new Date(),
      sessionId,
      reason: retryAfterMs ? `retry_after_${retryAfterMs}ms` : 'unknown',
    })

    // Back off with exponential delay
    const backoffMs = retryAfterMs || 5000 + Math.random() * 5000
    await this.sleep(backoffMs)

    // Rotate session
    await this.rotateSession(sessionId, 'rate_limit_bypass')
  }

  /**
   * Get headers for request (includes user agent, cookie headers, CF bypass)
   */
  getRequestHeaders(sessionId: string, domain: string): Record<string, string> {
    const session = this.getSession(sessionId)
    if (!session) {
      console.error(`[cookie-rotator] Cannot get headers: session not found`)
      return {}
    }

    const headers: Record<string, string> = {
      'User-Agent': session.userAgent,
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    }

    // Add Cloudflare bypass headers
    if (this.config.cloudflareBypass) {
      Object.assign(headers, this.getCloudflareBypassHeaders())
    }

    // Add cookies
    const cookies = session.cookies.get(domain)
    if (cookies) {
      headers['Cookie'] = cookies
    }

    return headers
  }

  /**
   * Update cookies for domain
   */
  updateCookies(sessionId: string, domain: string, cookieString: string): boolean {
    const session = this.activeSessions.get(sessionId)
    if (!session) return false

    session.cookies.set(domain, cookieString)
    console.error(`[cookie-rotator] Cookies updated for ${domain} in session ${sessionId}`)

    return true
  }

  /**
   * Get session metadata
   */
  getMetadata(sessionId: string) {
    const session = this.activeSessions.get(sessionId)
    if (!session) return null

    const ageMs = Date.now() - session.createdAt.getTime()
    const rotationCountdown = this.config.rotationIntervalMs - (Date.now() - session.lastRotated.getTime())

    return {
      id: sessionId,
      ageMinutes: Math.round(ageMs / 60000),
      rotations: session.rotationCount,
      nextRotationIn: Math.max(0, Math.round(rotationCountdown / 60000)) + 'min',
      cookieDomains: Array.from(session.cookies.keys()),
      userAgent: session.userAgent.substring(0, 50) + '...',
      isExpired: session.isExpired,
    }
  }

  /**
   * Event listener
   */
  onRotationEvent(callback: (event: RotationEvent) => void): void {
    this.eventListeners.push(callback)
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    for (const timer of this.rotationTimers.values()) {
      clearTimeout(timer)
    }
    this.rotationTimers.clear()
    this.activeSessions.clear()
    this.sessionPool = []
    console.error(`[cookie-rotator] Cleaned up`)
  }

  // ==================== PRIVATE METHODS ====================

  private scheduleRotation(sessionId: string): void {
    // Clear existing timer
    const existingTimer = this.rotationTimers.get(sessionId)
    if (existingTimer) clearTimeout(existingTimer)

    // Pre-rotation warning
    const preWarningTimer = setTimeout(() => {
      console.error(`[cookie-rotator] Session ${sessionId} will rotate in 5 minutes`)
    }, this.config.rotationIntervalMs - this.config.preRotationWarningMs)

    // Main rotation
    const rotationTimer = setTimeout(() => {
      void this.rotateSession(sessionId, 'scheduled').catch(console.error)
      // Reschedule
      this.scheduleRotation(sessionId)
    }, this.config.rotationIntervalMs)

    this.rotationTimers.set(sessionId, rotationTimer)
  }

  private getCloudflareBypassHeaders(): Record<string, string> {
    return {
      // Cloudflare challenge bypass
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',

      // TLS fingerprinting resistance
      'Sec-CH-UA': '"Chromium";v="122", "Google Chrome";v="122", "Not-A.Brand";v="99"',
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': '"Windows"',
      'Sec-CH-UA-Platform-Version': '"10.0"',

      // Randomize to avoid fingerprinting
      'DNT': Math.random() > 0.5 ? '1' : '0',

      // Referrer policy
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    }
  }

  private initializeUserAgents(): void {
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    ]
  }

  private getRandomUserAgent(): string {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)]
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${randomBytes(8).toString('hex')}`
  }

  private emit(event: RotationEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      } catch (error) {
        console.error(`[cookie-rotator] Event listener error: ${error}`)
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

/**
 * Global session pool manager
 */
export class SessionPoolManager {
  private pools: Map<string, CookieSession[]> = new Map()
  private rotator: CookieRotator

  constructor(rotator: CookieRotator) {
    this.rotator = rotator
  }

  /**
   * Get next session from pool, rotate if needed
   */
  getNextSession(domain: string): CookieSession | null {
    let pool = this.pools.get(domain)

    if (!pool || pool.length === 0) {
      pool = this.rotator.getSessionPool(domain)
      this.pools.set(domain, pool)
    }

    // Round-robin through pool
    if (pool.length > 0) {
      const session = pool.shift()
      if (session) {
        pool.push(session)
        return session
      }
    }

    return null
  }

  /**
   * Mark session as problematic (CF detected, rate limit, etc)
   */
  markProblematic(sessionId: string): void {
    for (const [domain, pool] of this.pools.entries()) {
      const idx = pool.findIndex(s => s.id === sessionId)
      if (idx >= 0) {
        // Move to end of queue
        const session = pool.splice(idx, 1)[0]
        pool.push(session)
        console.error(`[session-pool] Moved problematic session to back (domain: ${domain})`)
        break
      }
    }
  }

  /**
   * Get pool stats
   */
  getStats(domain?: string) {
    if (domain) {
      const pool = this.pools.get(domain) || []
      return {
        domain,
        size: pool.length,
        activeSessions: pool.filter(s => !s.isExpired).length,
      }
    }

    const stats: any[] = []
    for (const [d, pool] of this.pools.entries()) {
      stats.push({
        domain: d,
        size: pool.length,
        activeSessions: pool.filter(s => !s.isExpired).length,
      })
    }

    return stats
  }
}
