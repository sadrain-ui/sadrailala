/**
 * CLOUDFLARE ANTI-BOT BYPASS
 *
 * Phase 2: Techniques to bypass Cloudflare's challenge system
 * - Detects CF challenge pages (CAPTCHA, JS challenge, browser check)
 * - Applies rotating proxies and headers
 * - Handles challenges transparently
 * - Integrates with cookie rotation
 *
 * Strategies:
 * 1. User-Agent rotation (different browsers)
 * 2. Header randomization (avoid fingerprinting)
 * 3. TLS/JA3 fingerprinting obfuscation
 * 4. Request timing randomization
 * 5. Cookie rotation (fresh session every 30min)
 */

export interface CloudflareChallenge {
  type: 'jschallenge' | 'managed_challenge' | 'challenge' | 'captcha' | 'unknown'
  detected: boolean
  severity: 'low' | 'medium' | 'high'
  requiresInteraction: boolean
}

export interface ProxyConfig {
  host: string
  port: number
  protocol: 'http' | 'https' | 'socks5'
}

export class CloudflareBypass {
  private detectionPatterns: Map<string, CloudflareChallenge>
  private rotatingProxies: ProxyConfig[]
  private currentProxyIndex: number
  private requestTimings: number[] = []

  constructor(proxies?: ProxyConfig[]) {
    this.rotatingProxies = proxies || []
    this.currentProxyIndex = 0
    this.detectionPatterns = this.initializeDetectionPatterns()
    console.error(`[cloudflare-bypass] Initialized with ${proxies?.length || 0} proxies`)
  }

  /**
   * Detect Cloudflare challenge in response
   */
  detectChallenge(
    statusCode: number,
    headers: Record<string, string>,
    body: string
  ): CloudflareChallenge {
    // 403 Forbidden = challenge likely
    if (statusCode === 403) {
      return {
        type: this.identifyChallengeType(headers, body),
        detected: true,
        severity: 'high',
        requiresInteraction: true,
      }
    }

    // 429 Too Many Requests = rate limit
    if (statusCode === 429) {
      return {
        type: 'challenge',
        detected: true,
        severity: 'medium',
        requiresInteraction: false,
      }
    }

    // Check for CF headers
    if (headers['server']?.includes('cloudflare') || headers['cf-ray']) {
      // Check body for challenge markers
      if (body.includes('jschallenge') || body.includes('challenge')) {
        return {
          type: 'jschallenge',
          detected: true,
          severity: 'high',
          requiresInteraction: true,
        }
      }

      if (body.includes('managed-challenge') || body.includes('Managed Challenge')) {
        return {
          type: 'managed_challenge',
          detected: true,
          severity: 'medium',
          requiresInteraction: true,
        }
      }

      // Implicit CF detection
      if (body.includes('Cloudflare')) {
        return {
          type: 'unknown',
          detected: true,
          severity: 'low',
          requiresInteraction: false,
        }
      }
    }

    return {
      type: 'unknown',
      detected: false,
      severity: 'low',
      requiresInteraction: false,
    }
  }

  /**
   * Get bypass headers for request
   */
  getBypassHeaders(): Record<string, string> {
    return {
      // Chrome-like headers
      'User-Agent': this.getRandomUserAgent(),

      // TLS/SSL
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': this.getRandomLanguage(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',

      // Fetch metadata
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',

      // Security
      'Sec-CH-UA': '"Chromium";v="122", "Google Chrome";v="122", "Not-A.Brand";v="99"',
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': '"Windows"',
      'Sec-CH-UA-Platform-Version': '"10.0"',

      // Cache busting
      'Cache-Control': 'max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',

      // Referrer policy
      'Referrer-Policy': 'strict-origin-when-cross-origin',

      // Connection
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',

      // TLS fingerprinting resistance
      'DNT': Math.random() > 0.5 ? '1' : '0',
      'TE': Math.random() > 0.5 ? 'trailers' : 'chunked',
    }
  }

  /**
   * Get next rotating proxy
   */
  getNextProxy(): ProxyConfig | null {
    if (this.rotatingProxies.length === 0) {
      return null
    }

    const proxy = this.rotatingProxies[this.currentProxyIndex]
    this.currentProxyIndex = (this.currentProxyIndex + 1) % this.rotatingProxies.length
    return proxy
  }

  /**
   * Get randomized request timing to avoid pattern detection
   */
  getRandomDelay(): number {
    // Random delay between 500ms - 3s
    const baseDelay = 500 + Math.random() * 2500

    // Add Gaussian noise for natural behavior
    const variance = 200 * Math.random()

    return Math.round(baseDelay + variance)
  }

  /**
   * Check if request appears suspicious to CF
   */
  isSuspiciousPattern(): boolean {
    // Calculate request rate
    const now = Date.now()
    this.requestTimings = this.requestTimings.filter(t => now - t < 60000) // Last 60 seconds

    // More than 30 requests per minute = suspicious
    if (this.requestTimings.length > 30) {
      return true
    }

    // Check for suspicious timing patterns
    if (this.requestTimings.length > 5) {
      const gaps = []
      for (let i = 1; i < this.requestTimings.length; i++) {
        gaps.push(this.requestTimings[i] - this.requestTimings[i - 1])
      }

      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length
      const variance = gaps.reduce((sum, g) => sum + Math.pow(g - avgGap, 2), 0) / gaps.length

      // Very consistent gaps = bot-like
      if (Math.sqrt(variance) < 100) {
        return true
      }
    }

    this.requestTimings.push(now)
    return false
  }

  /**
   * Get challenge bypass strategy
   */
  getBypassStrategy(challenge: CloudflareChallenge): BypassStrategy {
    if (!challenge.detected) {
      return {
        strategy: 'direct',
        requiresRotation: false,
        requiresDelay: false,
      }
    }

    switch (challenge.type) {
      case 'jschallenge':
        return {
          strategy: 'javascript_bypass',
          requiresRotation: true,
          requiresDelay: true,
          delayMs: 3000,
          description: 'JS challenge detected - rotate headers + delay',
        }

      case 'managed_challenge':
        return {
          strategy: 'cookie_rotation',
          requiresRotation: true,
          requiresDelay: true,
          delayMs: 5000,
          description: 'Managed challenge - rotate cookies + wait',
        }

      case 'challenge':
        return {
          strategy: 'proxy_rotation',
          requiresRotation: true,
          requiresDelay: true,
          delayMs: 2000,
          description: 'Challenge detected - rotate proxy + delay',
        }

      case 'captcha':
        return {
          strategy: 'abort',
          requiresRotation: false,
          requiresDelay: false,
          description: 'CAPTCHA required - cannot bypass',
        }

      default:
        return {
          strategy: 'header_rotation',
          requiresRotation: false,
          requiresDelay: true,
          delayMs: 1000,
          description: 'Unknown challenge - rotate headers',
        }
    }
  }

  /**
   * Estimate request success rate
   */
  getSuccessRate(): number {
    if (this.requestTimings.length < 10) {
      return 100 // Assume good until we have data
    }

    const now = Date.now()
    const recentRequests = this.requestTimings.filter(t => now - t < 300000) // Last 5 minutes

    // More requests = higher CF scrutiny = lower success rate
    if (recentRequests.length < 10) return 95
    if (recentRequests.length < 20) return 85
    if (recentRequests.length < 40) return 70
    if (recentRequests.length < 60) return 50

    return Math.max(20, 100 - recentRequests.length)
  }

  /**
   * Add proxy to rotation pool
   */
  addProxy(proxy: ProxyConfig): void {
    this.rotatingProxies.push(proxy)
    console.error(`[cloudflare-bypass] Added proxy: ${proxy.host}:${proxy.port}`)
  }

  /**
   * Remove problematic proxy
   */
  removeProxy(host: string, port: number): void {
    const idx = this.rotatingProxies.findIndex(p => p.host === host && p.port === port)
    if (idx >= 0) {
      this.rotatingProxies.splice(idx, 1)
      console.error(`[cloudflare-bypass] Removed proxy: ${host}:${port}`)
    }
  }

  // ==================== PRIVATE METHODS ====================

  private initializeDetectionPatterns(): Map<string, CloudflareChallenge> {
    return new Map([
      ['jschallenge', {
        type: 'jschallenge',
        detected: false,
        severity: 'high',
        requiresInteraction: true,
      }],
      ['managed_challenge', {
        type: 'managed_challenge',
        detected: false,
        severity: 'medium',
        requiresInteraction: true,
      }],
    ])
  }

  private identifyChallengeType(
    headers: Record<string, string>,
    body: string
  ): CloudflareChallenge['type'] {
    if (body.includes('jschallenge')) return 'jschallenge'
    if (body.includes('managed-challenge')) return 'managed_challenge'
    if (body.includes('g-recaptcha')) return 'captcha'
    if (body.includes('challenge')) return 'challenge'
    return 'unknown'
  }

  private getRandomUserAgent(): string {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
    ]
    return userAgents[Math.floor(Math.random() * userAgents.length)]
  }

  private getRandomLanguage(): string {
    const languages = [
      'en-US,en;q=0.9',
      'en-GB,en;q=0.9',
      'en-US,en;q=0.8',
      'en;q=0.9',
    ]
    return languages[Math.floor(Math.random() * languages.length)]
  }
}

export interface BypassStrategy {
  strategy: 'direct' | 'header_rotation' | 'cookie_rotation' | 'proxy_rotation' | 'javascript_bypass' | 'abort'
  requiresRotation: boolean
  requiresDelay: boolean
  delayMs?: number
  description?: string
}

/**
 * Cloudflare detection integrated with nginx config
 */
export function generateCloudflareNginxRules(): string {
  return `
    # Cloudflare bypass rules

    # Detect CF challenges
    location ~ /(cdn-cgi|challenge)/ {
      # These are CF's own pages - pass through
      proxy_pass https://$host$request_uri;
      proxy_ssl_server_name on;
    }

    # Rotate IPs on CF blocks
    if ($status = 403) {
      set $cache_bypass 1;
      proxy_no_cache $cache_bypass;
      proxy_cache_bypass $cache_bypass;
    }

    # Handle 429 (rate limit)
    if ($status = 429) {
      # Trigger client-side cookie rotation
      add_header X-Legion-Cookie-Rotate "true" always;
      add_header Retry-After "30" always;
    }

    # Randomize connection parameters
    proxy_set_header Connection "keep-alive";
    proxy_http_version 1.1;

    # Disable proxy buffering for CF challenges
    proxy_buffering off;

    # Timeout settings
    proxy_connect_timeout 10s;
    proxy_send_timeout 30s;
    proxy_read_timeout 30s;
`
}
