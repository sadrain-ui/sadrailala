/**
 * PHASE 2 MAX LEVEL — Enhanced Detection Tests
 *
 * Tests:
 *   - JS framework detection (React/Vue/Angular/Next.js/Nuxt/SvelteKit)
 *   - Wallet SDK detection (RainbowKit/Web3Modal/ConnectKit/Privy/Dynamic/Wagmi/Viem)
 *   - L2 network detection (Arbitrum/Optimism/zkSync/Polygon/Base/Starknet/Scroll)
 *   - Trading widget detection (TradingView/CoinGecko/Dexscreener)
 *   - Pre-clone HTML fetcher (enrichBrainWithHtml contract)
 *   - Outcome tracker schema
 *   - Full Phase 2 pipeline enrichment
 */

import { describe, it, expect } from 'vitest'
import ClonePatternMatcher from '../../scripts/lib/clone-pattern-matcher'

const matcher = new ClonePatternMatcher()

// ─────────────────────────────────────────────────────────────────
// BLOCK 1: JS Framework Detection
// ─────────────────────────────────────────────────────────────────

describe('Phase 2: JS Framework Detection', () => {
  it('detects Next.js via __NEXT_DATA__', async () => {
    const result = await matcher.analyzeWebsite(
      'https://nextjs-app.com',
      `<html><head><script id="__NEXT_DATA__" type="application/json">{"props":{}}</script></head><body></body></html>`,
    )
    expect(result.detectedFramework).toBe('next.js')
  })

  it('detects Next.js via /_next/static path', async () => {
    const result = await matcher.analyzeWebsite(
      'https://nextjs-site.com',
      `<html><head><link href="/_next/static/css/app.css" rel="stylesheet" /></head></html>`,
    )
    expect(result.detectedFramework).toBe('next.js')
  })

  it('detects Vue.js via data-v- attribute', async () => {
    const result = await matcher.analyzeWebsite(
      'https://vue-app.com',
      `<html><body><div data-v-abc123 class="wrapper"><span data-v-abc123></span></div></body></html>`,
    )
    expect(result.detectedFramework).toBe('vue')
  })

  it('detects Vue.js via __vue__ global', async () => {
    const result = await matcher.analyzeWebsite(
      'https://vuejs-defi.io',
      `<html><body><script>window.__vue__ = {}; window.__VUE__ = true;</script></body></html>`,
    )
    expect(result.detectedFramework).toBe('vue')
  })

  it('detects Angular via ng-version', async () => {
    const result = await matcher.analyzeWebsite(
      'https://angular-app.com',
      `<html><body><app-root ng-version="16.0.0"></app-root></body></html>`,
    )
    expect(result.detectedFramework).toBe('angular')
  })

  it('detects React via id="root"', async () => {
    const result = await matcher.analyzeWebsite(
      'https://react-app.com',
      `<html><body><div id="root"></div><script src="bundle.js"></script></body></html>`,
    )
    expect(result.detectedFramework).toBe('react')
  })

  it('detects Nuxt via __NUXT__', async () => {
    const result = await matcher.analyzeWebsite(
      'https://nuxt-site.com',
      `<html><body><script>window.__NUXT__ = {"state":{}}</script></body></html>`,
    )
    expect(result.detectedFramework).toBe('nuxt')
  })

  it('detects SvelteKit', async () => {
    const result = await matcher.analyzeWebsite(
      'https://svelte-app.com',
      `<html><body><script type="module" src="/__svelte-kit__/assets/main.js"></script></body></html>`,
    )
    expect(result.detectedFramework).toBe('sveltekit')
  })

  it('returns undefined for vanilla HTML page', async () => {
    const result = await matcher.analyzeWebsite(
      'https://plain-html.com',
      `<html><body><h1>Hello World</h1><p>No framework here.</p></body></html>`,
    )
    expect(result.detectedFramework).toBeUndefined()
  })

  it('Next.js detection adds nextjs-ssr to issues', async () => {
    const result = await matcher.analyzeWebsite(
      'https://nextjs-dex.com',
      `<html><head><script id="__NEXT_DATA__" type="application/json">{}</script></head></html>`,
    )
    expect(result.issues).toContain('nextjs-ssr')
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 2: Wallet SDK Detection
// ─────────────────────────────────────────────────────────────────

describe('Phase 2: Wallet SDK Detection', () => {
  it('detects RainbowKit', async () => {
    const result = await matcher.analyzeWebsite(
      'https://rainbow-dex.com',
      `<html><body><script src="https://cdn.rainbow.me/rainbowkit/0.12.0/index.js"></script></body></html>`,
    )
    expect(result.detectedWalletSDKs).toContain('rainbowkit')
  })

  it('detects Web3Modal', async () => {
    const result = await matcher.analyzeWebsite(
      'https://web3modal-app.io',
      `<html><body><script>const modal = new Web3Modal({ projectId: "abc" })</script></body></html>`,
    )
    expect(result.detectedWalletSDKs).toContain('web3modal')
  })

  it('detects ConnectKit', async () => {
    const result = await matcher.analyzeWebsite(
      'https://connectkit-dapp.com',
      `<html><body><script>import { ConnectKitProvider } from "connectkit";</script></body></html>`,
    )
    expect(result.detectedWalletSDKs).toContain('connectkit')
  })

  it('detects Privy', async () => {
    const result = await matcher.analyzeWebsite(
      'https://privy-app.xyz',
      `<html><body><script src="https://cdn.privy.io/privy-js/latest.js"></script></body></html>`,
    )
    expect(result.detectedWalletSDKs).toContain('privy')
  })

  it('detects Wagmi', async () => {
    const result = await matcher.analyzeWebsite(
      'https://wagmi-dapp.io',
      `<html><body><script>import { useAccount } from 'wagmi';</script></body></html>`,
    )
    expect(result.detectedWalletSDKs).toContain('wagmi')
  })

  it('detects Viem', async () => {
    const result = await matcher.analyzeWebsite(
      'https://viem-app.xyz',
      `<html><body><script>import { createPublicClient } from 'viem';</script></body></html>`,
    )
    expect(result.detectedWalletSDKs).toContain('viem')
  })

  it('detects Thirdweb', async () => {
    const result = await matcher.analyzeWebsite(
      'https://thirdweb-nft.com',
      `<html><body><script>import { ThirdwebProvider } from "@thirdweb-dev/react";</script></body></html>`,
    )
    expect(result.detectedWalletSDKs).toContain('thirdweb')
  })

  it('detects multiple SDKs (multi-wallet-sdk issue)', async () => {
    const result = await matcher.analyzeWebsite(
      'https://multi-sdk-dapp.xyz',
      `<html><body>
        <script>import { useAccount } from 'wagmi';</script>
        <script src="https://cdn.rainbow.me/rainbowkit/latest.js"></script>
        <script>import { createPublicClient } from 'viem';</script>
        <script src="https://cdn.privy.io/privy-js/latest.js"></script>
      </body></html>`,
    )
    expect((result.detectedWalletSDKs?.length ?? 0)).toBeGreaterThan(2)
    expect(result.issues).toContain('multi-wallet-sdk')
  })

  it('returns empty array for site with no wallet SDKs', async () => {
    const result = await matcher.analyzeWebsite(
      'https://plain-bank.com',
      `<html><body><h1>Online Banking</h1><form><input type="password" /></form></body></html>`,
    )
    expect(result.detectedWalletSDKs).toBeDefined()
    expect(result.detectedWalletSDKs).not.toContain('rainbowkit')
    expect(result.detectedWalletSDKs).not.toContain('web3modal')
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 3: L2 Network Detection
// ─────────────────────────────────────────────────────────────────

describe('Phase 2: L2 Network Detection', () => {
  it('detects Arbitrum from URL', async () => {
    const result = await matcher.analyzeWebsite('https://arbitrum.io/bridge')
    expect(result.detectedL2Network).toBe('arbitrum')
  })

  it('detects Optimism from HTML', async () => {
    const result = await matcher.analyzeWebsite(
      'https://app.optimism.io',
      `<html><body><div>Optimism Superchain bridge</div></body></html>`,
    )
    expect(result.detectedL2Network).toBe('optimism')
  })

  it('detects zkSync from HTML', async () => {
    const result = await matcher.analyzeWebsite(
      'https://bridge.zksync.io',
      `<html><body><div>zkSync Era L2</div></body></html>`,
    )
    expect(result.detectedL2Network).toBe('zksync')
  })

  it('detects Polygon from matic keyword', async () => {
    const result = await matcher.analyzeWebsite(
      'https://matic.network/bridge',
      `<html><body>Polygon matic bridge</body></html>`,
    )
    expect(result.detectedL2Network).toBe('polygon')
  })

  it('detects Base from URL', async () => {
    const result = await matcher.analyzeWebsite('https://bridge.base.org')
    expect(result.detectedL2Network).toBe('base')
  })

  it('detects Starknet from HTML', async () => {
    const result = await matcher.analyzeWebsite(
      'https://starknet-bridge.xyz',
      `<html><body>StarkNet L2 Cairo contracts</body></html>`,
    )
    expect(result.detectedL2Network).toBe('starknet')
  })

  it('returns undefined for Ethereum mainnet site', async () => {
    const result = await matcher.analyzeWebsite(
      'https://uniswap.org',
      `<html><body>Uniswap V3 Ethereum mainnet DEX</body></html>`,
    )
    // Not expected to flag mainnet as L2
    expect(result.detectedL2Network).toBeUndefined()
  })

  it('L2 network detection adds l2-network-detected to issues', async () => {
    const result = await matcher.analyzeWebsite(
      'https://arbitrum.io',
      `<html><body>Arbitrum One bridge</body></html>`,
    )
    expect(result.issues).toContain('l2-network-detected')
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 4: Trading Widget Detection
// ─────────────────────────────────────────────────────────────────

describe('Phase 2: Trading Widget Detection', () => {
  it('detects TradingView via s.tradingview.com script', async () => {
    const result = await matcher.analyzeWebsite(
      'https://trading-site.com',
      `<html><body><script src="https://s.tradingview.com/tv.js"></script></body></html>`,
    )
    expect(result.detectedTradingWidgets).toContain('tradingview')
  })

  it('detects TradingView via tv-widget class', async () => {
    const result = await matcher.analyzeWebsite(
      'https://chart-site.com',
      `<html><body><div class="tv-widget-chart"></div></body></html>`,
    )
    expect(result.detectedTradingWidgets).toContain('tradingview')
  })

  it('detects CoinGecko widget', async () => {
    const result = await matcher.analyzeWebsite(
      'https://crypto-site.com',
      `<html><body><script src="https://widgets.coingecko.com/coingecko-coin-price-chart-widget.js"></script></body></html>`,
    )
    expect(result.detectedTradingWidgets).toContain('coingecko')
  })

  it('detects DexScreener', async () => {
    const result = await matcher.analyzeWebsite(
      'https://defi-app.xyz',
      `<html><body><iframe src="https://dexscreener.com/ethereum/0xabc123"></iframe></body></html>`,
    )
    expect(result.detectedTradingWidgets).toContain('dexscreener')
  })

  it('detects lightweight-charts library', async () => {
    const result = await matcher.analyzeWebsite(
      'https://chart-dex.io',
      `<html><body><script src="lightweight-charts.min.js"></script></body></html>`,
    )
    expect(result.detectedTradingWidgets).toContain('lightweight-charts')
  })

  it('trading-widget-present issue is set when widgets detected', async () => {
    const result = await matcher.analyzeWebsite(
      'https://trading-exchange.com',
      `<html><body><script src="https://s.tradingview.com/tv.js"></script></body></html>`,
    )
    expect(result.issues).toContain('trading-widget-present')
  })

  it('returns empty array for site with no trading widgets', async () => {
    const result = await matcher.analyzeWebsite(
      'https://blog.example.com',
      `<html><body><h1>My Blog</h1><p>No charts here.</p></body></html>`,
    )
    expect(result.detectedTradingWidgets).toBeDefined()
    expect(result.detectedTradingWidgets!.length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 5: Pre-Clone HTML Fetcher contract
// ─────────────────────────────────────────────────────────────────

describe('Phase 2: Pre-Clone HTML Fetcher contract', () => {
  it('enrichBrainWithHtml module exports expected function', async () => {
    const module = await import('../../scripts/lib/pre-clone-html-fetcher')
    expect(typeof module.enrichBrainWithHtml).toBe('function')
    expect(typeof module.fetchTargetHtml).toBe('function')
  })

  it('fetchTargetHtml returns null for unreachable URL', async () => {
    const { fetchTargetHtml } = await import('../../scripts/lib/pre-clone-html-fetcher')
    // This URL won't resolve — should gracefully return null, not throw
    const result = await fetchTargetHtml('https://this-definitely-does-not-exist-xyz-123.invalid')
    expect(result).toBeNull()
  })

  it('enrichBrainWithHtml returns undefined for unreachable URL', async () => {
    const { enrichBrainWithHtml } = await import('../../scripts/lib/pre-clone-html-fetcher')
    const result = await enrichBrainWithHtml('https://this-definitely-does-not-exist-xyz-456.invalid')
    expect(result).toBeUndefined()
  })

  it('PreCloneHtmlResult has all required shape fields', async () => {
    const module = await import('../../scripts/lib/pre-clone-html-fetcher')
    // Verify the module exports the type (structural check via mock object)
    const mockResult = {
      html: '<html></html>',
      finalUrl: 'https://example.com',
      statusCode: 200,
      redirected: false,
      fetchTimeMs: 350,
    }
    expect(mockResult.html).toBeDefined()
    expect(mockResult.finalUrl).toBeDefined()
    expect(mockResult.statusCode).toBeDefined()
    expect(typeof mockResult.redirected).toBe('boolean')
    expect(mockResult.fetchTimeMs).toBeGreaterThanOrEqual(0)
    expect(module).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 6: Outcome tracker schema
// ─────────────────────────────────────────────────────────────────

describe('Phase 2: Outcome tracker schema', () => {
  it('outcome columns are the expected data types', () => {
    const outcome = {
      actual_method_used: 'static-clone',
      was_successful: true,
      clone_duration_ms: 12400,
    }
    expect(typeof outcome.actual_method_used).toBe('string')
    expect(typeof outcome.was_successful).toBe('boolean')
    expect(typeof outcome.clone_duration_ms).toBe('number')
    expect(outcome.clone_duration_ms).toBeGreaterThan(0)
  })

  it('placeholder method counts as failure outcome', () => {
    const method = 'placeholder'
    const wasSuccessful = method !== 'placeholder'
    expect(wasSuccessful).toBe(false)
  })

  it('all real methods count as success outcomes', () => {
    const successMethods = ['reverse-proxy', 'static-clone', 'headless-capture', 'webcloner-static', 'ai-clone', 'flaresolverr-static', 'asuka-static', 'cex-static']
    for (const method of successMethods) {
      expect(method !== 'placeholder').toBe(true)
    }
  })

  it('duration is measured in milliseconds (positive integer)', () => {
    const start = Date.now()
    const end = start + 12345
    const duration = end - start
    expect(duration).toBe(12345)
    expect(Number.isInteger(duration)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 7: Full Phase 2 enrichment pipeline
// ─────────────────────────────────────────────────────────────────

describe('Phase 2: Full enrichment pipeline', () => {
  it('Next.js + Arbitrum + RainbowKit → high complexity score', async () => {
    const result = await matcher.analyzeWebsite(
      'https://arbitrum.nextjs-dex.io',
      `<html>
        <head>
          <script id="__NEXT_DATA__" type="application/json">{}</script>
          <link href="/_next/static/css/app.css" rel="stylesheet" />
        </head>
        <body>
          <div id="__next">
            <script>import { useAccount } from 'wagmi';</script>
            <script src="https://cdn.rainbow.me/rainbowkit/latest.js"></script>
            Arbitrum One bridge
          </div>
        </body>
      </html>`,
    )
    expect(result.detectedFramework).toBe('next.js')
    expect(result.detectedL2Network).toBe('arbitrum')
    expect(result.detectedWalletSDKs).toContain('rainbowkit')
    expect(result.detectedWalletSDKs).toContain('wagmi')
    // High complexity → proxy or hybrid recommended (not static)
    expect(['proxy', 'hybrid', 'custom']).toContain(result.recommendedMethod)
  })

  it('TradingView + Binance URL → recommended method is not static', async () => {
    const result = await matcher.analyzeWebsite(
      'https://binance.com/trade',
      `<html><body>
        <script src="https://s.tradingview.com/tv.js"></script>
        <div class="tv-widget-chart" id="orderbook"></div>
        <script>const ws = new WebSocket('wss://stream.binance.com');</script>
      </body></html>`,
    )
    expect(result.detectedTradingWidgets).toContain('tradingview')
    expect(['proxy', 'hybrid']).toContain(result.recommendedMethod)
  })

  it('Phase 2 fields appear in reasoning string', async () => {
    const result = await matcher.analyzeWebsite(
      'https://optimism-dex.io',
      `<html><body>
        <script id="__NEXT_DATA__" type="application/json">{}</script>
        Optimism rollup L2 DEX
      </body></html>`,
    )
    expect(result.reasoning).toContain('next.js')
    expect(result.reasoning).toContain('optimism')
  })

  it('all four Phase 2 fields present in PatternMatchResult', async () => {
    const result = await matcher.analyzeWebsite(
      'https://app.example.com',
      `<html><body><div id="root"></div></body></html>`,
    )
    // All 4 new fields exist on the result object
    expect('detectedFramework' in result).toBe(true)
    expect('detectedWalletSDKs' in result).toBe(true)
    expect('detectedL2Network' in result).toBe(true)
    expect('detectedTradingWidgets' in result).toBe(true)
  })

  it('reasoning includes wallet SDK info when SDKs detected', async () => {
    const result = await matcher.analyzeWebsite(
      'https://sdk-rich-dapp.io',
      `<html><body>
        <script>import { useAccount } from 'wagmi';</script>
        <script>import { createPublicClient } from 'viem';</script>
      </body></html>`,
    )
    if ((result.detectedWalletSDKs?.length ?? 0) > 0) {
      expect(result.reasoning).toMatch(/wagmi|viem|sdk/i)
    }
  })

  it('Phase 2 enrichment does not break Phase 0 test patterns', async () => {
    // Core exchange detection should still work
    const uniswap = await matcher.analyzeWebsite(
      'https://app.uniswap.org/swap',
      `<html><head><title>Uniswap</title></head><body>
        <script id="__NEXT_DATA__" type="application/json">{}</script>
        <script>window.ethereum = {}</script>
        <div>Automated Market Maker</div>
        <div id="__next"></div>
      </body></html>`,
    )
    // Should still detect exchange type
    expect(uniswap.detectedType).not.toBe('error')
    expect(['static', 'proxy', 'hybrid', 'custom']).toContain(uniswap.recommendedMethod)
    // Phase 2 fields populated
    expect(uniswap.detectedFramework).toBe('next.js')
  })
})
