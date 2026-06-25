/**
 * URL ANALYZER MODULE - Phase 1
 *
 * Analyzes target website to extract:
 * - Framework type (React, Vue, Angular, etc)
 * - API endpoints
 * - Authentication mechanisms
 * - Security headers
 * - Bot detection
 * - Complexity level (1-7)
 */

import { JSDOM } from 'jsdom'

export interface WebsiteAnalysis {
  url: string
  framework: string
  authMethods: string[]
  apiEndpoints: string[]
  webSockets: string[]
  securityHeaders: Record<string, string>
  botDetection: boolean
  wafDetection: boolean
  requiresTwoFA: boolean
  complexityLevel: number
  components: string[]
  externalScripts: string[]
  recommendations: string[]
  timestamp: Date
}

export interface FrameworkDetection {
  name: string
  indicators: string[]
  confidence: number
}

export interface SecurityAnalysis {
  hasCSP: boolean
  hasXFrame: boolean
  hasCors: boolean
  hasXContentType: boolean
  hasCookie: boolean
  requiresAuth: boolean
}

export class URLAnalyzer {
  private targetUrl: string
  private html: string = ''
  private dom: JSDOM | null = null

  constructor(targetUrl: string) {
    this.targetUrl = this.normalizeUrl(targetUrl)
  }

  /**
   * Main analysis function - orchestrates all analysis steps
   */
  async analyze(): Promise<WebsiteAnalysis> {
    console.error(`[url-analyzer] Starting analysis of ${this.targetUrl}`)

    try {
      // Step 1: Fetch target website
      console.error(`[url-analyzer] ✅ Fetching website...`)
      await this.fetchWebsite()

      // Step 2: Parse DOM
      console.error(`[url-analyzer] ✅ Parsing DOM...`)
      this.parseDom()

      // Step 3: Detect framework
      console.error(`[url-analyzer] ✅ Detecting framework...`)
      const framework = this.detectFramework()

      // Step 4: Extract endpoints
      console.error(`[url-analyzer] ✅ Extracting API endpoints...`)
      const apiEndpoints = this.extractApiEndpoints()

      // Step 5: Detect auth
      console.error(`[url-analyzer] ✅ Detecting auth methods...`)
      const authMethods = this.detectAuthMethods()

      // Step 6: Extract WebSockets
      console.error(`[url-analyzer] ✅ Finding WebSocket connections...`)
      const webSockets = this.extractWebSockets()

      // Step 7: Analyze security
      console.error(`[url-analyzer] ✅ Analyzing security headers...`)
      const securityHeaders = this.analyzeSecurityHeaders()

      // Step 8: Detect bot detection
      console.error(`[url-analyzer] ✅ Checking for bot detection...`)
      const botDetection = this.detectBotDetection()

      // Step 9: Detect WAF
      console.error(`[url-analyzer] ✅ Checking for WAF...`)
      const wafDetection = this.detectWaf()

      // Step 10: Calculate complexity
      console.error(`[url-analyzer] ✅ Calculating complexity level...`)
      const complexityLevel = this.calculateComplexity(
        framework,
        authMethods,
        apiEndpoints,
        botDetection
      )

      // Step 11: Extract components
      console.error(`[url-analyzer] ✅ Identifying components...`)
      const components = this.extractComponents()

      // Step 12: Generate recommendations
      console.error(`[url-analyzer] ✅ Generating recommendations...`)
      const recommendations = this.generateRecommendations(
        framework,
        authMethods,
        botDetection,
        wafDetection
      )

      const analysis: WebsiteAnalysis = {
        url: this.targetUrl,
        framework,
        authMethods,
        apiEndpoints,
        webSockets,
        securityHeaders,
        botDetection,
        wafDetection,
        requiresTwoFA: this.detectTwoFA(),
        complexityLevel,
        components,
        externalScripts: this.extractExternalScripts(),
        recommendations,
        timestamp: new Date(),
      }

      console.error(`[url-analyzer] ✅ Analysis complete!`)
      console.error(`[url-analyzer] Framework: ${framework}`)
      console.error(`[url-analyzer] Complexity Level: ${complexityLevel}`)
      console.error(`[url-analyzer] Auth Methods: ${authMethods.join(', ')}`)
      console.error(`[url-analyzer] API Endpoints Found: ${apiEndpoints.length}`)

      return analysis
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`[url-analyzer] ❌ Analysis failed: ${msg}`)
      throw error
    }
  }

  /**
   * Fetch target website HTML
   */
  private async fetchWebsite(): Promise<void> {
    try {
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

      this.html = await response.text()

      if (this.html.length === 0) {
        throw new Error('Empty response')
      }

      console.error(`[url-analyzer] Fetched ${this.html.length} bytes`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to fetch ${this.targetUrl}: ${msg}`)
    }
  }

  /**
   * Parse HTML into DOM
   */
  private parseDom(): void {
    try {
      this.dom = new JSDOM(this.html, {
        url: this.targetUrl,
        pretendToBeVisual: true,
      })
    } catch (error) {
      throw new Error(`Failed to parse DOM: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Detect framework type
   */
  private detectFramework(): string {
    if (!this.dom) return 'unknown'

    const doc = this.dom.window.document
    const html = this.html.toLowerCase()

    // React indicators
    if (
      html.includes('__react') ||
      html.includes('__next') ||
      html.includes('_reactroot') ||
      html.includes('react-dom') ||
      doc.querySelector('[data-react-root]')
    ) {
      return 'React'
    }

    // Vue indicators
    if (
      html.includes('__vue__') ||
      html.includes('v-app') ||
      html.includes('nuxt') ||
      doc.querySelector('[v-app]')
    ) {
      return 'Vue'
    }

    // Angular indicators
    if (
      html.includes('ng-app') ||
      html.includes('angular') ||
      html.includes('ng-version') ||
      doc.querySelector('[ng-app]')
    ) {
      return 'Angular'
    }

    // Svelte
    if (html.includes('svelte')) {
      return 'Svelte'
    }

    // Next.js
    if (html.includes('next.js') || html.includes('_next')) {
      return 'Next.js'
    }

    // Static/Vanilla
    return 'Vanilla/Static'
  }

  /**
   * Extract API endpoints from HTML and scripts
   */
  private extractApiEndpoints(): string[] {
    const endpoints = new Set<string>()

    // Common API patterns
    const patterns = [
      /\/api\/v?\d+\/[a-zA-Z0-9\-_]+/g,
      /\/graphql/g,
      /\/rest\/v?\d+\//g,
      /fetch\(['"]([^'"]+)['"]/g,
      /axios\(['"]([^'"]+)['"]/g,
      /\.get\(['"]([^'"]+)['"]/g,
      /\.post\(['"]([^'"]+)['"]/g,
    ]

    for (const pattern of patterns) {
      const matches = this.html.match(pattern)
      if (matches) {
        matches.forEach((m) => {
          const endpoint = m.replace(/fetch\(|axios\(|\.get\(|\.post\(|['"]|[)]/g, '')
          if (endpoint && endpoint.startsWith('/')) {
            endpoints.add(endpoint)
          }
        })
      }
    }

    return Array.from(endpoints).slice(0, 50)
  }

  /**
   * Detect authentication methods
   */
  private detectAuthMethods(): string[] {
    const methods = new Set<string>()
    const lowerHtml = this.html.toLowerCase()

    if (lowerHtml.includes('metamask') || lowerHtml.includes('ethereum')) {
      methods.add('MetaMask')
    }
    if (lowerHtml.includes('wallet') || lowerHtml.includes('web3')) {
      methods.add('Web3 Wallet')
    }
    if (lowerHtml.includes('phantom')) {
      methods.add('Phantom')
    }
    if (lowerHtml.includes('email') || lowerHtml.includes('login')) {
      methods.add('Email/Password')
    }
    if (lowerHtml.includes('oauth') || lowerHtml.includes('google')) {
      methods.add('OAuth/Google')
    }
    if (lowerHtml.includes('jwt') || lowerHtml.includes('token')) {
      methods.add('JWT Token')
    }
    if (lowerHtml.includes('session')) {
      methods.add('Session Cookies')
    }

    return Array.from(methods)
  }

  /**
   * Extract WebSocket connections
   */
  private extractWebSockets(): string[] {
    const sockets = new Set<string>()

    const wsPattern = /wss?:\/\/[^\s'"<>]+/g
    const matches = this.html.match(wsPattern)

    if (matches) {
      matches.forEach((m) => {
        if (m.includes('ws')) {
          sockets.add(m)
        }
      })
    }

    return Array.from(sockets)
  }

  /**
   * Analyze security headers
   */
  private analyzeSecurityHeaders(): Record<string, string> {
    // This would need actual response headers, for now analyze HTML meta tags
    const headers: Record<string, string> = {}

    if (this.html.includes('Content-Security-Policy')) {
      headers['CSP'] = 'present'
    }
    if (this.html.includes('X-Frame-Options')) {
      headers['X-Frame-Options'] = 'present'
    }
    if (this.html.includes('X-Content-Type-Options')) {
      headers['X-Content-Type-Options'] = 'present'
    }
    if (this.html.includes('Strict-Transport-Security')) {
      headers['HSTS'] = 'present'
    }

    return headers
  }

  /**
   * Detect bot detection scripts
   */
  private detectBotDetection(): boolean {
    const botPatterns = [
      'cloudflare',
      'recaptcha',
      'hcaptcha',
      'botdetect',
      'akismet',
      'antibot',
      'behavioral biometrics',
    ]

    const lowerHtml = this.html.toLowerCase()
    return botPatterns.some((pattern) => lowerHtml.includes(pattern))
  }

  /**
   * Detect WAF (Web Application Firewall)
   */
  private detectWaf(): boolean {
    const wafPatterns = ['cloudflare', 'akamai', 'imperva', 'f5', 'barracuda', 'mod_security']

    const lowerHtml = this.html.toLowerCase()
    return wafPatterns.some((pattern) => lowerHtml.includes(pattern))
  }

  /**
   * Detect if 2FA is used
   */
  private detectTwoFA(): boolean {
    const twoFAPatterns = ['2fa', '2factor', 'totp', 'authenticator', 'otp']

    const lowerHtml = this.html.toLowerCase()
    return twoFAPatterns.some((pattern) => lowerHtml.includes(pattern))
  }

  /**
   * Calculate complexity level (1-7)
   */
  private calculateComplexity(
    framework: string,
    authMethods: string[],
    apiEndpoints: string[],
    botDetection: boolean
  ): number {
    let level = 1

    // Framework complexity
    if (framework !== 'Vanilla/Static') {
      level = 2 // JS Framework
    }

    // Authentication complexity
    if (authMethods.length > 0) {
      level = 3 // Auth hijacking needed
    }

    // Real-time data
    if (apiEndpoints.length > 50) {
      level = 4 // Real-time data needed
    }

    // Visual complexity
    if (framework === 'React' || framework === 'Next.js') {
      level = 5 // Pixel-perfect needed
    }

    // Bot evasion needed
    if (botDetection) {
      level = 6
    }

    // Full ecosystem
    if (apiEndpoints.length > 100 && authMethods.length > 2) {
      level = 7
    }

    return Math.min(level, 7)
  }

  /**
   * Extract component names
   */
  private extractComponents(): string[] {
    const components = new Set<string>()

    // Look for React component patterns
    const componentPattern = /class\s+(\w+)\s+extends|const\s+(\w+)\s*=\s*\(/g
    let match

    while ((match = componentPattern.exec(this.html)) !== null) {
      const component = match[1] || match[2]
      if (component && component.length < 50) {
        components.add(component)
      }
    }

    return Array.from(components).slice(0, 20)
  }

  /**
   * Extract external scripts
   */
  private extractExternalScripts(): string[] {
    const scripts = new Set<string>()

    const scriptPattern = /<script[^>]*src=["']([^"']+)["']/g
    let match

    while ((match = scriptPattern.exec(this.html)) !== null) {
      scripts.add(match[1])
    }

    return Array.from(scripts)
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(
    framework: string,
    authMethods: string[],
    botDetection: boolean,
    wafDetection: boolean
  ): string[] {
    const recommendations: string[] = []

    if (framework === 'React' || framework === 'Vue') {
      recommendations.push('Level 2+ needed for framework mastery')
    }

    if (authMethods.includes('MetaMask') || authMethods.includes('Web3 Wallet')) {
      recommendations.push('Level 3+ needed for wallet hijacking')
    }

    if (authMethods.includes('Email/Password')) {
      recommendations.push('Level 3+ needed for credential capture')
    }

    if (botDetection) {
      recommendations.push('Level 6+ needed for bot detection bypass')
    }

    if (wafDetection) {
      recommendations.push('FlareSolverr integration recommended')
    }

    if (recommendations.length === 0) {
      recommendations.push('Level 5+ recommended for comprehensive cloning')
    }

    return recommendations
  }

  /**
   * Normalize URL
   */
  private normalizeUrl(url: string): string {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return `https://${url}`
    }
    return url
  }
}

// Export convenience function
export async function analyzeUrl(targetUrl: string): Promise<WebsiteAnalysis> {
  const analyzer = new URLAnalyzer(targetUrl)
  return analyzer.analyze()
}
