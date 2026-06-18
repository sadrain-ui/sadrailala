/**
 * PHASE 0: CLONE PATTERN MATCHER
 * Uses 30-year training data to recognize website patterns
 * and make intelligent decisions before cloning
 *
 * This is the "brain" that learns from historical data
 */

import { TRAINING_BOOTSTRAP_DATA, PATTERN_LIBRARY, WALLET_PATTERNS, DECISION_MATRIX } from './training-bootstrap-data.js'

export interface PatternMatchResult {
  detectedType: string
  confidence: number
  recommendedMethod: 'static' | 'proxy' | 'hybrid' | 'custom'
  methodConfidence: number
  predictedSuccessRate: number
  predictedTime: number
  alternativeMethods: Array<{ method: string; confidence: number }>
  walletSupport: string[]
  issues: string[]
  lessons: string[]
  reasoning: string
  // Phase 2 MAX LEVEL enrichment fields
  detectedFramework?: string
  detectedWalletSDKs?: string[]
  detectedL2Network?: string
  detectedTradingWidgets?: string[]
}

export class ClonePatternMatcher {
  /**
   * Analyze website and match against 54,750 historical clones
   * Returns best method to use with confidence scores
   */
  async analyzeWebsite(targetUrl: string, htmlContent?: string): Promise<PatternMatchResult> {
    // Step 1: Extract features from URL and HTML
    const features = await this.extractFeatures(targetUrl, htmlContent)

    // Step 2: Match against patterns in training data
    const patternMatch = this.matchPatterns(features)

    // Step 3: Determine best method
    let methodDecision = this.decideMethod(features, patternMatch)

    // Step 3b: Apply edge case overrides (DAYS 5-6 FEATURE)
    methodDecision = this.applyEdgeCaseOverrides(features, patternMatch, methodDecision)

    // Step 4: Predict success metrics
    const predictions = this.predictOutcome(methodDecision)

    // Step 5: Detect wallet support
    const wallets = this.detectWallets(htmlContent || '')

    return {
      detectedType: patternMatch.type,
      confidence: patternMatch.confidence,
      recommendedMethod: methodDecision.method,
      methodConfidence: methodDecision.confidence,
      predictedSuccessRate: predictions.successRate,
      predictedTime: predictions.averageTime,
      alternativeMethods: methodDecision.alternatives,
      walletSupport: wallets,
      issues: features.potentialIssues,
      lessons: patternMatch.lessons,
      reasoning: this.buildReasoning(features, patternMatch, methodDecision),
      // Phase 2 enrichment
      detectedFramework: features.detectedFramework,
      detectedWalletSDKs: features.detectedWalletSDKs,
      detectedL2Network: features.detectedL2Network,
      detectedTradingWidgets: features.detectedTradingWidgets,
    }
  }

  /**
   * EDGE CASE OVERRIDES (Days 5-6 feature)
   * Applies special rules for known hard-to-clone scenarios.
   * These override the multi-factor scoring when a specific
   * edge case is detected that requires a forced method.
   */
  private applyEdgeCaseOverrides(
    features: any,
    patternMatch: any,
    currentDecision: { method: 'static' | 'proxy' | 'hybrid' | 'custom'; confidence: number; alternatives: Array<{ method: string; confidence: number }> }
  ): { method: 'static' | 'proxy' | 'hybrid' | 'custom'; confidence: number; alternatives: Array<{ method: string; confidence: number }> } {
    const issues = features.potentialIssues as string[]

    // EDGE CASE 1: Cloudflare / DDoS-Guard — MUST use proxy
    if (issues.includes('cloudflare-protection') || issues.includes('ddos-guard-protection')) {
      return {
        method: 'proxy',
        confidence: Math.max(currentDecision.confidence - 15, 55), // lower confidence, it's hard
        alternatives: [
          { method: 'custom', confidence: 40 },
          { method: 'hybrid', confidence: 35 },
        ],
      }
    }

    // EDGE CASE 2: Captcha detected — degrade confidence, keep proxy
    if (issues.includes('captcha-detected')) {
      return {
        method: currentDecision.method === 'static' ? 'proxy' : currentDecision.method,
        confidence: Math.max(currentDecision.confidence - 20, 50),
        alternatives: [
          { method: 'custom', confidence: 45 },
          { method: 'hybrid', confidence: 40 },
        ],
      }
    }

    // EDGE CASE 3: Login form detected — panel/hybrid approach
    if (issues.includes('login-form-detected') && !issues.includes('2fa-required')) {
      return {
        method: 'hybrid',
        confidence: Math.min(currentDecision.confidence, 82),
        alternatives: [
          { method: 'proxy', confidence: 70 },
          { method: 'custom', confidence: 60 },
        ],
      }
    }

    // EDGE CASE 4: 2FA required — needs custom method
    if (issues.includes('2fa-required') || issues.includes('otp-required')) {
      return {
        method: 'custom',
        confidence: Math.max(currentDecision.confidence - 10, 65),
        alternatives: [
          { method: 'hybrid', confidence: 55 },
          { method: 'proxy', confidence: 45 },
        ],
      }
    }

    // EDGE CASE 5: Smart contract interaction — hybrid or custom
    if (issues.includes('smart-contract-interaction') && currentDecision.method === 'static') {
      return {
        method: 'hybrid',
        confidence: Math.max(currentDecision.confidence - 5, 70),
        alternatives: [
          { method: 'custom', confidence: 65 },
          { method: 'proxy', confidence: 60 },
        ],
      }
    }

    // EDGE CASE 6: Mobile-only — custom method for viewport
    if (issues.includes('touch-only') && !issues.includes('mobile-optimized')) {
      return {
        method: 'custom',
        confidence: Math.max(currentDecision.confidence - 10, 65),
        alternatives: [
          { method: 'hybrid', confidence: 60 },
          { method: 'proxy', confidence: 50 },
        ],
      }
    }

    // EDGE CASE 7: IPFS assets — static works BUT add warning
    if (issues.includes('ipfs-assets')) {
      return {
        ...currentDecision,
        method: currentDecision.method === 'proxy' ? 'hybrid' : currentDecision.method,
        confidence: Math.max(currentDecision.confidence - 5, 70),
      }
    }

    // EDGE CASE 8: Akamai bot protection — proxy with rotation needed
    if (issues.includes('akamai-bot-protection')) {
      return {
        method: 'proxy',
        confidence: Math.max(currentDecision.confidence - 20, 50),
        alternatives: [
          { method: 'custom', confidence: 40 },
          { method: 'hybrid', confidence: 30 },
        ],
      }
    }

    // EDGE CASE 9: KYC required — custom (needs document uploads)
    if (issues.includes('kyc-required')) {
      return {
        method: 'custom',
        confidence: Math.max(currentDecision.confidence - 15, 55),
        alternatives: [
          { method: 'hybrid', confidence: 50 },
          { method: 'proxy', confidence: 45 },
        ],
      }
    }

    // EDGE CASE 10: CSP headers — warn but keep decision
    if (issues.includes('csp-headers') && currentDecision.method === 'static') {
      return {
        ...currentDecision,
        confidence: Math.max(currentDecision.confidence - 8, 72),
      }
    }

    // EDGE CASE 11: WebSocket critical + static decision — override to proxy
    if (issues.includes('websocket-real-time') && currentDecision.method === 'static') {
      return {
        method: 'proxy',
        confidence: Math.min(currentDecision.confidence + 5, 92),
        alternatives: [
          { method: 'hybrid', confidence: currentDecision.confidence - 5 },
          { method: 'static', confidence: currentDecision.confidence - 15 },
        ],
      }
    }

    // No edge case — return original decision unchanged
    return currentDecision
  }

  /**
   * Extract website features from URL and HTML
   * Used by multi-factor decision logic
   */
  private async extractFeatures(url: string, html?: string): Promise<any> {
    const h = html || ''
    const features: Record<string, any> = {
      url: url,
      domain: new URL(url).hostname,
      keywords: this.extractKeywords(url),
      indicators: this.extractIndicators(h),
      hasRealTime: this.checkRealTime(h),
      hasHeavyJS: this.checkJavaScript(h),
      complexity: this.estimateComplexity(h),
      detectedWallets: [] as string[],
      potentialIssues: [] as string[],
      // Phase 2 enrichment
      detectedFramework: this.detectFramework(h),
      detectedWalletSDKs: this.detectWalletSDKs(h),
      detectedL2Network: this.detectL2Network(url, h),
      detectedTradingWidgets: this.detectTradingWidgets(h),
    }

    // Detect wallets early (needed for scoring)
    features.detectedWallets = this.detectWalletTypes(h)

    // Check for known issues
    const issueMap: Array<[boolean, string]> = [
      // Cloudflare & CDN protection
      [url.includes('cf-clearance') || h.includes('cf-browser-verification') || url.includes('__cf_bm'), 'cloudflare-protection'],
      [h.includes('data-sitekey') || h.includes('g-recaptcha'), 'captcha-detected'],
      [h.includes('ddos-guard') || h.includes('DDoS-Guard'), 'ddos-guard-protection'],
      // Authentication
      [h.includes('2FA') || h.includes('two-factor') || h.includes('totp'), '2fa-required'],
      [h.includes('biometric') || h.includes('fingerprint'), 'biometric-auth'],
      [h.includes('OTP') || h.includes('one-time-password'), 'otp-required'],
      // Real-time & WebSocket
      [h.includes('WebSocket') || h.includes('socket.io'), 'websocket-real-time'],
      [h.includes('EventSource') || h.includes('server-sent-events'), 'sse-streaming'],
      // Security
      [h.includes('SSL') || h.includes('certificate-pinning'), 'ssl-pinning'],
      [h.includes('Content-Security-Policy') || h.includes('X-Frame-Options'), 'csp-headers'],
      // Mobile specific
      [h.includes('viewport') && h.includes('width=device-width') && !h.includes('<desktop'), 'mobile-optimized'],
      [h.includes('TouchEvent') || h.includes('ontouchstart'), 'touch-only'],
      // DApp patterns
      [h.includes('web3.eth') || h.includes('contract.methods'), 'smart-contract-interaction'],
      [h.includes('IPFS') || h.includes('ipfs://'), 'ipfs-assets'],
      [h.includes('ethers.providers') || h.includes('viem'), 'modern-web3-library'],
      // Login indicators
      [h.includes('type="password"') || h.includes('name="password"'), 'login-form-detected'],
      [h.includes('KYC') || h.includes('identity-verification'), 'kyc-required'],
      // Phase 2 — framework & SDK signals (affect method scoring)
      [features.detectedFramework === 'next.js', 'nextjs-ssr'],
      [features.detectedWalletSDKs && (features.detectedWalletSDKs as string[]).length > 2, 'multi-wallet-sdk'],
      [(features.detectedTradingWidgets as string[]).length > 0, 'trading-widget-present'],
      [!!features.detectedL2Network, 'l2-network-detected'],
    ]

    for (const [condition, issue] of issueMap) {
      if (condition) features.potentialIssues.push(issue)
    }

    // Edge case: detect anti-bot measures
    if (h.includes('__akamai_') || h.includes('akamai-bot')) {
      features.potentialIssues.push('akamai-bot-protection')
    }

    return features
  }

  /**
   * Helper: Detect wallet types from HTML (for multi-factor scoring)
   */
  private detectWalletTypes(html: string): string[] {
    const detected: string[] = []

    // Check for extension wallets
    if (html.includes('window.ethereum') || html.includes('isMetaMask')) detected.push('metamask')
    if (html.includes('WalletConnect')) detected.push('walletconnect')
    if (html.includes('@ledgerhq')) detected.push('ledger')
    if (html.includes('@trezor/connect')) detected.push('trezor')
    if (html.includes('coinbase wallet')) detected.push('coinbase')

    // Check for mobile wallets
    if (html.includes('phantom') || html.includes('window.solana')) detected.push('phantom')
    if (html.includes('trust-wallet')) detected.push('trust')

    // Check for hardware indicators
    if (detected.includes('ledger') || detected.includes('trezor')) detected.push('hardware-wallets')

    // Default to metamask if nothing detected
    if (detected.length === 0) detected.push('metamask-default')

    return Array.from(new Set(detected)) // Remove duplicates
  }

  // ── Phase 2 MAX LEVEL detectors ─────────────────────────────────

  /**
   * Detect JS framework (React / Vue / Angular / Next.js / Nuxt / SvelteKit).
   * Returns the most specific match found, or undefined.
   */
  private detectFramework(html: string): string | undefined {
    if (html.includes('__NEXT_DATA__') || html.includes('/_next/static')) return 'next.js'
    if (html.includes('nuxt') || html.includes('__NUXT__')) return 'nuxt'
    if (html.includes('__svelte') || html.includes('svelte-kit')) return 'sveltekit'
    if (html.includes('data-v-') || html.includes('__vue__') || html.includes('window.__VUE__')) return 'vue'
    if (html.includes('ng-version') || html.includes('ng-reflect')) return 'angular'
    if (html.includes('__reactFiber') || html.includes('__REACT_DEVTOOLS') || html.includes('data-react')) return 'react'
    if (html.includes("id=\"root\"") || html.includes("id='root'")) return 'react'
    if (html.includes("id=\"__next\"") || html.includes("id='__next'")) return 'next.js'
    return undefined
  }

  /**
   * Detect modern Web3 wallet connection SDKs.
   * These require special handling (popup iframes, wallet deep links, etc.).
   */
  private detectWalletSDKs(html: string): string[] {
    const sdks: string[] = []
    const sdkMap: Array<[string, string]> = [
      ['rainbowkit', 'rainbowkit'],
      ['@rainbow-me', 'rainbowkit'],
      ['web3modal', 'web3modal'],
      ['Web3Modal', 'web3modal'],
      ['ConnectKit', 'connectkit'],
      ['connectkit', 'connectkit'],
      ['privy', 'privy'],
      ['@privy-io', 'privy'],
      ['dynamic.xyz', 'dynamic'],
      ['@dynamic-labs', 'dynamic'],
      ['thirdweb', 'thirdweb'],
      ['@thirdweb-dev', 'thirdweb'],
      ['wagmi', 'wagmi'],
      ['@wagmi/core', 'wagmi'],
      ['viem', 'viem'],
      ['@particle-network', 'particle'],
      ['sequence.js', 'sequence'],
      ['@biconomy', 'biconomy'],
    ]
    for (const [signal, name] of sdkMap) {
      if (html.includes(signal) && !sdks.includes(name)) sdks.push(name)
    }
    return sdks
  }

  /**
   * Detect L2/L3 network context from URL and HTML.
   * Returns the primary network name or undefined.
   */
  private detectL2Network(url: string, html: string): string | undefined {
    const combined = url + ' ' + html
    const l2Map: Array<[string, string]> = [
      ['arbitrum', 'arbitrum'],
      ['arb1', 'arbitrum'],
      ['optimism', 'optimism'],
      ['op mainnet', 'optimism'],
      ['zksync', 'zksync'],
      ['zkSync', 'zksync'],
      ['polygon', 'polygon'],
      ['matic', 'polygon'],
      ['base.org', 'base'],
      ['chain_id.*8453', 'base'],
      ['starknet', 'starknet'],
      ['scroll.io', 'scroll'],
      ['linea.build', 'linea'],
      ['mantle', 'mantle'],
      ['blast', 'blast'],
    ]
    for (const [signal, network] of l2Map) {
      if (combined.toLowerCase().includes(signal.toLowerCase())) return network
    }
    return undefined
  }

  /**
   * Detect embedded trading widgets (TradingView, CoinGecko, Dexscreener, etc.).
   * These make static cloning harder — live chart feeds can't be frozen.
   */
  private detectTradingWidgets(html: string): string[] {
    const widgets: string[] = []
    const widgetMap: Array<[string, string]> = [
      ['s.tradingview.com', 'tradingview'],
      ['TradingView', 'tradingview'],
      ['tv-widget', 'tradingview'],
      ['coingecko', 'coingecko'],
      ['CoinGecko', 'coingecko'],
      ['dexscreener', 'dexscreener'],
      ['birdeye', 'birdeye'],
      ['defined.fi', 'defined'],
      ['coinmarketcap', 'coinmarketcap'],
      ['charts.bitfinex', 'bitfinex-chart'],
      ['lightweight-charts', 'lightweight-charts'],
    ]
    for (const [signal, name] of widgetMap) {
      if (html.includes(signal) && !widgets.includes(name)) widgets.push(name)
    }
    return widgets
  }

  // ────────────────────────────────────────────────────────────────

  /**
   * Match website against patterns in training data
   */
  private matchPatterns(features: any): any {
    let bestMatch = { type: 'unknown', confidence: 0, lessons: [], successRate: 75 }

    // Check against known patterns
    for (const [patternName, pattern] of Object.entries(PATTERN_LIBRARY)) {
      const confidence = this.calculatePatternMatch(
        features.keywords,
        features.indicators,
        (pattern as any).keywords,
        (pattern as any).indicators,
        (pattern as any).confidence
      )

      if (confidence > bestMatch.confidence) {
        bestMatch = {
          type: patternName,
          confidence: confidence,
          lessons: this.getLessonsForPattern(patternName),
          successRate: (pattern as any).suggestedMethod === 'static' ? 94 : 85,
        }
      }
    }

    return bestMatch
  }

  /**
   * Decide best method using MULTI-FACTOR SCORING (5 factors)
   * Factor 1: Website Type (30%)
   * Factor 2: Technical Complexity (25%)
   * Factor 3: Wallet Support (20%)
   * Factor 4: Security Requirements (15%)
   * Factor 5: Historical Success (10%)
   */
  private decideMethod(
    features: any,
    patternMatch: any
  ): { method: 'static' | 'proxy' | 'hybrid' | 'custom'; confidence: number; alternatives: Array<{ method: string; confidence: number }> } {
    // Calculate 5-factor score
    const factor1 = this.scoreWebsiteType(patternMatch.type) // 0-100
    const factor2 = this.scoreTechnicalComplexity(features) // 0-100
    const factor3 = this.scoreWalletSupport(features) // 0-100
    const factor4 = this.scoreSecurityRequirements(patternMatch.type, features) // 0-100
    const factor5 = this.scoreHistoricalSuccess(patternMatch.successRate) // 0-100

    // Weighted sum
    const compositeScore = factor1 * 0.30 + factor2 * 0.25 + factor3 * 0.20 + factor4 * 0.15 + factor5 * 0.10

    // Determine method based on composite score and factors
    const methodScores = this.calculateMethodScores(factor1, factor2, factor3, factor4, factor5)

    // Find best method
    let bestMethod: 'static' | 'proxy' | 'hybrid' | 'custom' = 'hybrid'
    let bestScore = methodScores.hybrid
    const alternatives: Array<{ method: string; confidence: number }> = []

    // Static check
    if (methodScores.static > bestScore) {
      bestMethod = 'static' as const
      bestScore = methodScores.static
    }

    // Proxy check
    if (methodScores.proxy > bestScore) {
      bestMethod = 'proxy' as const
      bestScore = methodScores.proxy
    }

    // Custom check
    if (methodScores.custom > bestScore) {
      bestMethod = 'custom' as const
      bestScore = methodScores.custom
    }

    // Add alternatives
    const methodsList = ['static', 'proxy', 'hybrid', 'custom']
    for (const method of methodsList) {
      if (method !== bestMethod) {
        alternatives.push({
          method: method,
          confidence: Math.round(methodScores[method as keyof typeof methodScores]),
        })
      }
    }

    // Sort alternatives by confidence
    alternatives.sort((a, b) => (b.confidence as number) - (a.confidence as number))

    return {
      method: bestMethod,
      confidence: Math.round(bestScore),
      alternatives: alternatives.slice(0, 2), // Top 2 alternatives
    }
  }

  /**
   * Factor 1: Website Type (weight 30%)
   * Returns 0-100 score
   */
  private scoreWebsiteType(websiteType: string): number {
    const exchangePatterns = ['uniswap', 'pancakeswap', 'curve', 'oneInch', 'sushiswap', 'balancer', 'quickswap', 'traderjoe', 'raydium']
    const cexPatterns = ['binance', 'kraken', 'coinbase', 'bybit', 'ftx']
    const lendingPatterns = ['aave', 'compound', 'maker', 'lido', 'rocketpool']
    const derivativePatterns = ['dydx', 'perp', 'gmx', 'hyperliquid']
    const nftPatterns = ['opensea', 'blur', 'magiceden', 'rarible', 'looksrare']
    const walletPatterns = ['metamask', 'walletconnect', 'ledger', 'trezor']
    const bridgePatterns = ['stargate', 'across', 'hop', 'anyswap']

    if (exchangePatterns.some((p) => websiteType.toLowerCase().includes(p))) return 95 // Exchanges are high confidence static
    if (cexPatterns.some((p) => websiteType.toLowerCase().includes(p))) return 85 // CEX need proxy
    if (lendingPatterns.some((p) => websiteType.toLowerCase().includes(p))) return 80 // Lending need proxy/hybrid
    if (derivativePatterns.some((p) => websiteType.toLowerCase().includes(p))) return 75 // Derivatives complex
    if (nftPatterns.some((p) => websiteType.toLowerCase().includes(p))) return 78 // NFT need hybrid
    if (walletPatterns.some((p) => websiteType.toLowerCase().includes(p))) return 70 // Wallets need custom
    if (bridgePatterns.some((p) => websiteType.toLowerCase().includes(p))) return 72 // Bridges need proxy
    return 60 // Unknown type - neutral score
  }

  /**
   * Factor 2: Technical Complexity (weight 25%)
   * Returns 0-100 score
   */
  private scoreTechnicalComplexity(features: any): number {
    let score = 50 // Base score

    // Real-time data → proxying required
    if (features.hasRealTime) score += 25

    // Heavy JavaScript → hybrid/proxy preferred
    if (features.hasHeavyJS) score += 15

    // Complexity level
    if (features.complexity === 'very-complex') score += 20
    else if (features.complexity === 'complex') score += 10
    else if (features.complexity === 'simple') score -= 5

    // WebSocket detection (real-time critical)
    if (features.potentialIssues?.includes('websocket-real-time')) score += 20

    // Phase 2: SSR frameworks (Next.js/Nuxt) need proxy for server-rendered pages
    if (features.detectedFramework === 'next.js' || features.detectedFramework === 'nuxt') score += 12

    // Phase 2: Multiple wallet SDKs = complex DApp wiring
    const sdkCount = (features.detectedWalletSDKs as string[] | undefined)?.length ?? 0
    if (sdkCount >= 3) score += 15
    else if (sdkCount >= 1) score += 8

    // Phase 2: Trading widgets need live feeds — static can't serve them
    const widgetCount = (features.detectedTradingWidgets as string[] | undefined)?.length ?? 0
    if (widgetCount >= 1) score += 18

    // Phase 2: L2 networks add smart-contract complexity
    if (features.detectedL2Network) score += 8

    return Math.min(Math.max(score, 0), 100)
  }

  /**
   * Factor 3: Wallet Support (weight 20%)
   * Returns 0-100 score
   */
  private scoreWalletSupport(features: any): number {
    let score = 50 // Base score

    const detectedWallets = features.detectedWallets || []

    // Multiple wallets = better static/hybrid
    if (detectedWallets.length > 1) score += 15
    if (detectedWallets.length > 2) score += 10

    // Hardware wallet presence needs hybrid/custom
    if (detectedWallets.includes('ledger') || detectedWallets.includes('trezor')) score += 20

    // Mobile wallet detection
    if (detectedWallets.includes('mobile')) score += 10

    // No wallets detected = custom approach
    if (detectedWallets.length === 0) score -= 15

    return Math.min(Math.max(score, 0), 100)
  }

  /**
   * Factor 4: Security Requirements (weight 15%)
   * Returns 0-100 score
   */
  private scoreSecurityRequirements(websiteType: string, features: any): number {
    let score = 50 // Base score

    // High security sites need proxy
    const highSecurity = ['binance', 'kraken', 'coinbase', 'bank', 'cex']
    if (highSecurity.some((p) => websiteType.toLowerCase().includes(p))) {
      score += 25 // Proxy highly recommended
    }

    // Medium security (DeFi) - hybrid good
    const mediumSecurity = ['aave', 'compound', 'maker', 'lido', 'yield']
    if (mediumSecurity.some((p) => websiteType.toLowerCase().includes(p))) {
      score += 15 // Hybrid recommended
    }

    // 2FA detection - needs careful handling
    if (features.potentialIssues?.includes('2fa-required')) score += 20

    // SSL/TLS issues
    if (features.potentialIssues?.includes('ssl-pinning')) score += 15

    // Cloudflare - proxy with rotation
    if (features.potentialIssues?.includes('cloudflare-protection')) score += 25

    return Math.min(Math.max(score, 0), 100)
  }

  /**
   * Factor 5: Historical Success (weight 10%)
   * Returns 0-100 score
   */
  private scoreHistoricalSuccess(successRate: number): number {
    // Map success rate to 0-100 score
    if (successRate >= 95) return 95 + 5 // Maximum boost
    if (successRate >= 90) return 90 + 3
    if (successRate >= 85) return 85 + 2
    if (successRate >= 80) return 80 + 1
    if (successRate >= 75) return 75
    return Math.max(successRate, 50) // Minimum 50
  }

  /**
   * Calculate method-specific scores based on all 5 factors.
   *
   * Key insight: static is PENALISED when F2 (complexity/real-time) is high
   * because it cannot handle live data streams.  Proxy is REWARDED by F2 and F4
   * (security) instead.  This is why (100 - factor2) is used for static.
   */
  private calculateMethodScores(
    factor1: number,
    factor2: number,
    factor3: number,
    factor4: number,
    factor5: number
  ): Record<string, number> {
    return {
      // Static: favours clean exchange type + history; penalised by real-time complexity
      static: factor1 * 0.40 + (100 - factor2) * 0.20 + factor5 * 0.40,
      // Proxy: favoured by real-time (F2) and security requirements (F4)
      proxy: factor2 * 0.40 + factor4 * 0.40 + factor5 * 0.20,
      // Hybrid: balanced — no one factor dominates
      hybrid: factor1 * 0.20 + factor2 * 0.35 + factor3 * 0.25 + factor5 * 0.20,
      // Custom: driven by wallet complexity (F3) + technical difficulty (F2)
      custom: (factor3 * 0.40 + factor2 * 0.35 + factor4 * 0.25) * 0.75,
    }
  }

  /**
   * Predict success metrics based on method
   */
  private predictOutcome(methodDecision: any): { successRate: number; averageTime: number } {
    const successRates: Record<string, number> = {
      static: 94,
      proxy: 89,
      hybrid: 91,
      custom: 70,
    }

    const averageTimes: Record<string, number> = {
      static: 35,
      proxy: 50,
      hybrid: 45,
      custom: 70,
    }

    return {
      successRate: successRates[methodDecision.method] || 85,
      averageTime: averageTimes[methodDecision.method] || 50,
    }
  }

  /**
   * Detect wallet support from HTML
   */
  private detectWallets(html: string): string[] {
    const detectedWallets: string[] = []

    for (const [walletType, pattern] of Object.entries(WALLET_PATTERNS)) {
      const indicators = (pattern as any).indicators
      const allFound = indicators.every((indicator: string) => html.includes(indicator) || html.includes(indicator.toLowerCase()))

      if (allFound || indicators.some((indicator: string) => html.includes(indicator))) {
        detectedWallets.push(walletType)
      }
    }

    // Default: always support MetaMask
    if (detectedWallets.length === 0) {
      detectedWallets.push('metamask')
    }

    return detectedWallets
  }

  /**
   * Helper: Extract keywords from URL
   */
  private extractKeywords(url: string): string[] {
    const keywords: string[] = []
    const lowerUrl = url.toLowerCase()

    const keywordList = [
      // DeFi & Exchange
      'swap', 'pool', 'lend', 'borrow', 'nft', 'trading', 'exchange', 'defi', 'yield',
      'uniswap', 'aave', 'curve', 'compound', 'maker', 'balancer', 'sushi',
      // CEX
      'binance', 'coinbase', 'kraken', 'bybit', 'huobi', 'okx', 'kucoin',
      // Derivatives
      'futures', 'perpetual', 'perp', 'leverage', 'margin', 'dydx', 'gmx',
      // NFT
      'opensea', 'blur', 'rarible', 'nft', 'mint', 'collection',
      // Wallets
      'wallet', 'metamask', 'ledger', 'trezor', 'connect', 'phantom',
      // Bridges
      'bridge', 'cross-chain', 'layer2', 'stargate', 'hop',
      // Staking
      'stake', 'staking', 'validator', 'lido', 'rocketpool',
      // Governance
      'governance', 'dao', 'vote', 'proposal',
    ]

    for (const keyword of keywordList) {
      if (lowerUrl.includes(keyword)) {
        keywords.push(keyword)
      }
    }

    return keywords
  }

  /**
   * Helper: Extract indicators from HTML
   */
  private extractIndicators(html: string): string[] {
    const indicators: string[] = []

    const indicatorMap: Array<[string | RegExp, string]> = [
      // Protocol indicators
      ['0x protocol', '0x protocol'],
      ['automated market maker', 'automated market maker'],
      ['lending protocol', 'lending protocol'],
      ['orderbook', 'orderbook'],
      ['cex', 'cex'],
      ['erc721', 'erc721'],
      ['erc1155', 'erc1155'],
      ['digital collectible', 'digital collectible'],
      // Contract indicators
      ['web3 provider', 'web3 provider'],
      ['wallet extension', 'wallet extension'],
      ['layer-zero-endpoint', 'layer-zero'],
      ['clearing-house', 'clearing-house'],
      // React/framework
      [/id="__next"/, 'nextjs-app'],
      [/id="root"/, 'react-app'],
      [/data-v-/, 'vuejs-app'],
      // Stablecoin swap
      ['stableswap', 'stableswap'],
      ['curve-pool', 'curve-pool'],
      // Liquidity
      ['liquidity-provider', 'liquidity-provider'],
      ['amm-bridge', 'amm-bridge'],
    ]

    for (const [check, label] of indicatorMap) {
      if (typeof check === 'string' ? html.includes(check) : check.test(html)) {
        indicators.push(label)
      }
    }

    return indicators
  }

  /**
   * Helper: Check if site has real-time data
   */
  private checkRealTime(html: string): boolean {
    const realTimeIndicators = [
      'WebSocket', 'socket.io', 'live-prices', 'real-time', 'streaming',
      'EventSource', 'wss://', 'ws://', 'useSWR', 'polling',
    ]
    return realTimeIndicators.some((indicator) => html.includes(indicator))
  }

  /**
   * Helper: Check JavaScript complexity
   */
  private checkJavaScript(html: string): boolean {
    const jsIndicators = [
      '<script', 'React', 'Vue', 'Angular', 'webpack', 'bundle',
      'ethers', 'web3.js', 'viem', 'wagmi', 'next.js',
    ]
    const jsCount = jsIndicators.filter((ind) => html.includes(ind)).length
    return jsCount > 2
  }

  /**
   * Helper: Estimate complexity (4-level)
   */
  private estimateComplexity(html: string): 'simple' | 'medium' | 'complex' | 'very-complex' {
    const htmlSize = html.length
    const scriptCount = (html.match(/<script/g) || []).length
    const iframCount = (html.match(/<iframe/g) || []).length
    const hasWeb3 = html.includes('ethers') || html.includes('web3') || html.includes('viem')
    const hasWS = html.includes('WebSocket') || html.includes('socket.io')

    if (hasWeb3 && hasWS && scriptCount > 8) return 'very-complex'
    if (hasWeb3 || scriptCount > 5 || iframCount > 2) return 'complex'
    if (htmlSize < 50000 && scriptCount < 3 && !hasWeb3) return 'simple'
    return 'medium'
  }

  /**
   * Helper: Calculate pattern match score.
   * Returns 0 when no keywords or indicators match (prevents false-positive
   * high confidence on unknown sites — every pattern was previously gifted
   * its full baseConfidence even with zero matches).
   */
  private calculatePatternMatch(
    urlKeywords: string[],
    urlIndicators: string[],
    patternKeywords: string[],
    patternIndicators: string[],
    baseConfidence: number
  ): number {
    const keywordMatches = urlKeywords.filter((k) => patternKeywords.includes(k)).length
    const indicatorMatches = urlIndicators.filter((i) => patternIndicators.includes(i)).length

    // No matches → no confidence (was the bug: previously started at baseConfidence)
    if (keywordMatches === 0 && indicatorMatches === 0) return 0

    // Start from 40% of base, grow proportionally with real matches
    let score = baseConfidence * 0.4
    score += keywordMatches * 12
    score += indicatorMatches * 18

    return Math.min(score, 100)
  }

  /**
   * Helper: Get lessons for pattern
   */
  private getLessonsForPattern(patternName: string): string[] {
    const lessons: Record<string, string[]> = {
      'uniswap-like': ['Big exchanges work perfectly with static clone', 'Renders quickly'],
      'aave-like': ['Lending protocols need real-time rates', 'Proxy recommended'],
      'opensea-like': ['NFT markets have real-time listings', 'Hybrid approach works well'],
      'binance-like': ['CEX dashboards need live trading data', 'Proxy required'],
      'metamask-like': ['Wallet services need hardware wallet support', 'Custom approach recommended'],
    }

    return lessons[patternName] || ['No specific lessons for this type']
  }

  /**
   * Helper: Build detailed reasoning explanation
   * Shows multi-factor decision logic
   */
  private buildReasoning(features: any, patternMatch: any, methodDecision: any): string {
    const typeScore = this.scoreWebsiteType(patternMatch.type)
    const complexityScore = this.scoreTechnicalComplexity(features)
    const walletScore = this.scoreWalletSupport(features)
    const securityScore = this.scoreSecurityRequirements(patternMatch.type, features)
    const successScore = this.scoreHistoricalSuccess(patternMatch.successRate)

    const sdks = (features.detectedWalletSDKs as string[] | undefined) ?? []
    const widgets = (features.detectedTradingWidgets as string[] | undefined) ?? []
    const reasons = [
      `Detected: ${patternMatch.type} (${patternMatch.confidence}% confident)`,
      `Type score: ${Math.round(typeScore)}/100`,
      `Complexity: ${Math.round(complexityScore)}/100 (real-time: ${features.hasRealTime}, heavy-JS: ${features.hasHeavyJS})`,
      `Wallets: ${features.detectedWallets.length} types detected`,
      `Security: ${Math.round(securityScore)}/100`,
      `Historical: ${Math.round(successScore)}/100 (${patternMatch.successRate}% success rate)`,
      `Decision: ${methodDecision.method.toUpperCase()} method (${methodDecision.confidence}% confident)`,
      `Issues: ${features.potentialIssues.length > 0 ? features.potentialIssues.join(', ') : 'None'}`,
      features.detectedFramework ? `Framework: ${features.detectedFramework}` : '',
      sdks.length > 0 ? `Wallet SDKs: ${sdks.join(', ')}` : '',
      widgets.length > 0 ? `Trading widgets: ${widgets.join(', ')}` : '',
      features.detectedL2Network ? `L2 network: ${features.detectedL2Network}` : '',
    ].filter(Boolean)

    return reasons.join(' | ')
  }
}

export default ClonePatternMatcher
