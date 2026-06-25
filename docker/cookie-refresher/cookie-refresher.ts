/**
 * COOKIE REFRESHER SERVICE
 *
 * Containerized service that:
 * - Maintains pool of fresh sessions
 * - Rotates cookies every 30 minutes
 * - Handles Cloudflare challenges
 * - Serves session management API
 * - Monitors session health
 */

import express, { Request, Response } from 'express'
import { CookieRotator, SessionPoolManager } from '../../scripts/lib/cookie-rotator.js'
import { CloudflareBypass } from '../../scripts/lib/cloudflare-bypass.js'
import { chromium } from 'playwright'

const app = express()
const PORT = process.env.PORT || 3000
const ROTATION_INTERVAL = Number(process.env.ROTATION_INTERVAL || 1800000) // 30 minutes
const SESSION_POOL_SIZE = Number(process.env.SESSION_POOL_SIZE || 10)

// Initialize services
const rotator = new CookieRotator({
  rotationIntervalMs: ROTATION_INTERVAL,
  maxCookiesInPool: SESSION_POOL_SIZE,
})

const poolManager = new SessionPoolManager(rotator)
const cfBypass = new CloudflareBypass()

// Middleware
app.use(express.json())

// ==================== API ENDPOINTS ====================

/**
 * POST /session/create
 * Create new cookie session for domain
 */
app.post('/session/create', (req: Request, res: Response) => {
  try {
    const { domain, url } = req.body

    if (!domain) {
      return res.status(400).json({ error: 'domain required' })
    }

    const session = rotator.createSession(domain)

    res.json({
      status: 'ok',
      sessionId: session.id,
      domain,
      createdAt: session.createdAt,
    })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

/**
 * GET /session/:sessionId
 * Get session info
 */
app.get('/session/:sessionId', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params
    const session = rotator.getSession(sessionId)

    if (!session) {
      return res.status(404).json({ error: 'session not found' })
    }

    const metadata = rotator.getMetadata(sessionId)
    res.json({
      status: 'ok',
      session: metadata,
    })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

/**
 * POST /session/:sessionId/rotate
 * Force rotation of session
 */
app.post('/session/:sessionId/rotate', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params
    const { reason } = req.body

    const success = await rotator.rotateSession(sessionId, reason || 'manual')

    res.json({
      status: success ? 'ok' : 'failed',
      sessionId,
      rotated: success,
    })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

/**
 * POST /session/:sessionId/cookies
 * Update cookies for session
 */
app.post('/session/:sessionId/cookies', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params
    const { domain, cookieString } = req.body

    if (!domain || !cookieString) {
      return res.status(400).json({ error: 'domain and cookieString required' })
    }

    const success = rotator.updateCookies(sessionId, domain, cookieString)

    res.json({
      status: success ? 'ok' : 'failed',
      sessionId,
      domain,
      updated: success,
    })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

/**
 * GET /session/:sessionId/headers
 * Get request headers for session
 */
app.get('/session/:sessionId/headers', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.query as any
    const { domain } = req.query as any

    if (!sessionId || !domain) {
      return res.status(400).json({ error: 'sessionId and domain required' })
    }

    const headers = rotator.getRequestHeaders(sessionId as string, domain as string)

    res.json({
      status: 'ok',
      sessionId,
      domain,
      headers,
    })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

/**
 * GET /pool/:domain
 * Get session pool for domain
 */
app.get('/pool/:domain', (req: Request, res: Response) => {
  try {
    const { domain } = req.params
    const pool = rotator.getSessionPool(domain)

    const stats = poolManager.getStats(domain)

    res.json({
      status: 'ok',
      domain,
      pool: pool.map(s => ({
        id: s.id,
        rotations: s.rotationCount,
        isExpired: s.isExpired,
      })),
      stats,
    })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

/**
 * GET /cloudflare/detect
 * Detect Cloudflare challenge
 */
app.post('/cloudflare/detect', (req: Request, res: Response) => {
  try {
    const { statusCode, headers, body } = req.body

    const challenge = cfBypass.detectChallenge(statusCode, headers, body)
    const strategy = cfBypass.getBypassStrategy(challenge)
    const successRate = cfBypass.getSuccessRate()

    res.json({
      status: 'ok',
      challenge,
      strategy,
      successRate,
    })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

/**
 * GET /cloudflare/headers
 * Get Cloudflare bypass headers
 */
app.get('/cloudflare/headers', (req: Request, res: Response) => {
  try {
    const headers = cfBypass.getBypassHeaders()

    res.json({
      status: 'ok',
      headers,
    })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

/**
 * POST /cloudflare/handle
 * Handle Cloudflare detection for session
 */
app.post('/cloudflare/handle', async (req: Request, res: Response) => {
  try {
    const { sessionId, statusCode } = req.body

    if (statusCode === 403) {
      await rotator.handleCloudflareDetection(sessionId)
    } else if (statusCode === 429) {
      await rotator.handleRateLimit(sessionId, 5000)
    }

    res.json({
      status: 'ok',
      sessionId,
      handled: true,
    })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

/**
 * GET /health
 * Health check
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
})

/**
 * GET /stats
 * Get overall stats
 */
app.get('/stats', (req: Request, res: Response) => {
  try {
    const stats = poolManager.getStats()
    const cfSuccessRate = cfBypass.getSuccessRate()

    res.json({
      status: 'ok',
      pools: stats,
      cloudflareBypassSuccessRate: cfSuccessRate + '%',
      rotationIntervalMinutes: ROTATION_INTERVAL / 60000,
      sessionPoolSize: SESSION_POOL_SIZE,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

/**
 * Event logging
 */
rotator.onRotationEvent((event) => {
  console.log(`[${event.type.toUpperCase()}] ${event.sessionId} - ${event.reason || ''}`)
})

// ==================== STARTUP ====================

async function main() {
  try {
    // Start express server
    app.listen(PORT, () => {
      console.error(`[cookie-refresher] 🚀 Running on http://localhost:${PORT}`)
      console.error(`[cookie-refresher] 🔄 Rotation interval: ${ROTATION_INTERVAL / 60000} minutes`)
      console.error(`[cookie-refresher] 📦 Pool size: ${SESSION_POOL_SIZE} sessions`)
    })

    // Initialize session pool for common domains
    const commonDomains = [
      'app.uniswap.org',
      'app.pancakeswap.finance',
      'binance.com',
      'coinbase.com',
    ]

    for (const domain of commonDomains) {
      const pool = rotator.getSessionPool(domain)
      console.error(`[cookie-refresher] ✅ Pre-initialized pool for ${domain} (${pool.length} sessions)`)
    }
  } catch (error) {
    console.error('[cookie-refresher] ❌ Failed to start:', error)
    process.exit(1)
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.error('[cookie-refresher] 🛑 Shutting down...')
  rotator.cleanup()
  process.exit(0)
})

main()
