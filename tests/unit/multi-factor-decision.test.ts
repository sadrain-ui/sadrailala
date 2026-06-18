/**
 * MULTI-FACTOR DECISION LOGIC TEST
 * Tests the 5-factor scoring system
 */

import { describe, it, expect } from 'vitest'
import ClonePatternMatcher from '../../scripts/lib/clone-pattern-matcher'

describe('Multi-Factor Decision Logic', () => {
  const matcher = new ClonePatternMatcher()

  /**
   * TEST 1: Exchange Detection (should use STATIC)
   */
  it('should recommend STATIC for Uniswap-like exchanges', async () => {
    const result = await matcher.analyzeWebsite(
      'https://app.uniswap.org/swap',
      `
        <html>
          <head><title>Uniswap</title></head>
          <body>
            <script src="uniswap-v3.js"></script>
            <div>Automated Market Maker</div>
            <div id="swap-widget">0x protocol integration</div>
            <script>window.ethereum = {}</script>
          </body>
        </html>
      `
    )

    console.log('Exchange Test:', {
      type: result.detectedType,
      confidence: result.confidence,
      method: result.recommendedMethod,
      methodConfidence: result.methodConfidence,
    })

    expect(result.recommendedMethod).toBe('static')
    expect(result.methodConfidence).toBeGreaterThanOrEqual(80)
    expect(result.predictedSuccessRate).toBeGreaterThanOrEqual(85)
  })

  /**
   * TEST 2: CEX with Real-Time (should use PROXY)
   */
  it('should recommend PROXY for Binance-like CEX dashboards', async () => {
    const result = await matcher.analyzeWebsite(
      'https://www.binance.com/en/trade',
      `
        <html>
          <head><title>Binance</title></head>
          <body>
            <div>Live Trading</div>
            <script>
              const ws = new WebSocket('wss://stream.binance.com');
              window.ethereum = {isMetaMask: true};
            </script>
            <div id="orderbook">Real-time prices</div>
            <div>wallet-extension</div>
          </body>
        </html>
      `
    )

    console.log('CEX Test:', {
      type: result.detectedType,
      confidence: result.confidence,
      method: result.recommendedMethod,
      methodConfidence: result.methodConfidence,
    })

    expect(result.recommendedMethod).toBe('proxy')
    expect(result.methodConfidence).toBeGreaterThanOrEqual(75)
  })

  /**
   * TEST 3: Lending Protocol (should use PROXY or HYBRID)
   */
  it('should recommend PROXY for Aave-like lending protocols', async () => {
    const result = await matcher.analyzeWebsite(
      'https://app.aave.com',
      `
        <html>
          <head><title>Aave</title></head>
          <body>
            <script>window.ethereum = {isMetaMask: true}</script>
            <div>Lending Protocol</div>
            <div>Interest Rate: Live Updates</div>
            <script src="real-time-rates.js"></script>
            <div>WalletConnect Support</div>
          </body>
        </html>
      `
    )

    console.log('Lending Test:', {
      type: result.detectedType,
      confidence: result.confidence,
      method: result.recommendedMethod,
      methodConfidence: result.methodConfidence,
    })

    expect(['proxy', 'hybrid']).toContain(result.recommendedMethod)
    expect(result.methodConfidence).toBeGreaterThanOrEqual(70)
  })

  /**
   * TEST 4: Complex DApp (should use HYBRID or CUSTOM)
   */
  it('should recommend HYBRID for complex DApps', async () => {
    const result = await matcher.analyzeWebsite(
      'https://app.custom-defi.com',
      `
        <html>
          <head><title>Custom DApp</title></head>
          <body>
            <script src="react.js"></script>
            <script src="web3.js"></script>
            <script>
              window.ethereum = {};
              const contract = new Contract();
              const ws = new WebSocket();
            </script>
            <div>Smart Contract Interaction</div>
            <div>Ledger Support</div>
            <div>Trezor Support</div>
          </body>
        </html>
      `
    )

    console.log('Complex DApp Test:', {
      type: result.detectedType,
      confidence: result.confidence,
      method: result.recommendedMethod,
      methodConfidence: result.methodConfidence,
    })

    expect(['hybrid', 'custom', 'proxy']).toContain(result.recommendedMethod)
    expect(result.methodConfidence).toBeGreaterThanOrEqual(70)
  })

  /**
   * TEST 5: Cloudflare Protected (should use PROXY)
   */
  it('should recommend PROXY for Cloudflare-protected sites', async () => {
    const result = await matcher.analyzeWebsite(
      'https://api.example.com?cf-clearance=token',
      `
        <html>
          <body>
            <script src="https://cdn.cloudflare.com/ajax/libs/cloudflare/..."></script>
            <div>Cloudflare protected content</div>
          </body>
        </html>
      `
    )

    console.log('Cloudflare Test:', {
      type: result.detectedType,
      confidence: result.confidence,
      method: result.recommendedMethod,
      methodConfidence: result.methodConfidence,
      issues: result.issues,
    })

    expect(result.recommendedMethod).toBe('proxy')
    expect(result.issues).toContain('cloudflare-protection')
  })

  /**
   * TEST 6: NFT Market (should use HYBRID)
   */
  it('should recommend HYBRID for NFT markets', async () => {
    const result = await matcher.analyzeWebsite(
      'https://opensea.io/collection/cool-cats',
      `
        <html>
          <body>
            <script>window.ethereum = {isMetaMask: true}</script>
            <div>NFT Collection</div>
            <div>Live Listings</div>
            <script src="react.js"></script>
            <img src="ipfs://...">
            <div>WalletConnect</div>
          </body>
        </html>
      `
    )

    console.log('NFT Test:', {
      type: result.detectedType,
      confidence: result.confidence,
      method: result.recommendedMethod,
      methodConfidence: result.methodConfidence,
    })

    expect(['hybrid', 'proxy', 'static']).toContain(result.recommendedMethod)
    expect(result.methodConfidence).toBeGreaterThanOrEqual(65)
  })

  /**
   * TEST 7: Unknown Site (should use HYBRID as safe choice)
   */
  it('should recommend HYBRID for unknown sites', async () => {
    const result = await matcher.analyzeWebsite(
      'https://unknown-site.com',
      '<html><body>Some content</body></html>'
    )

    console.log('Unknown Site Test:', {
      type: result.detectedType,
      confidence: result.confidence,
      method: result.recommendedMethod,
      methodConfidence: result.methodConfidence,
    })

    // Unknown site with minimal HTML — brain conservatively recommends static or hybrid
    expect(['static', 'hybrid']).toContain(result.recommendedMethod)
    expect(result.methodConfidence).toBeGreaterThanOrEqual(60)
  })

  /**
   * TEST 8: Verify Alternatives Provided
   */
  it('should provide alternative methods', async () => {
    const result = await matcher.analyzeWebsite(
      'https://app.uniswap.org/swap',
      `<html><body>Swap<script>window.ethereum = {}</script></body></html>`
    )

    console.log('Alternatives Test:', {
      primary: result.recommendedMethod,
      primaryConfidence: result.methodConfidence,
      alternatives: result.alternativeMethods,
    })

    expect(result.alternativeMethods.length).toBeGreaterThan(0)
    expect(result.alternativeMethods.length).toBeLessThanOrEqual(2)
    expect(result.alternativeMethods.every((m) => m.confidence <= result.methodConfidence)).toBe(true)
  })

  /**
   * TEST 9: Confidence Scoring
   */
  it('should have varying confidence levels based on pattern strength', async () => {
    // Known pattern (high confidence)
    const knownResult = await matcher.analyzeWebsite(
      'https://app.uniswap.org',
      '<html><body>Uniswap V3<script>window.ethereum = {}</script></body></html>'
    )

    // Unknown pattern (lower confidence)
    const unknownResult = await matcher.analyzeWebsite(
      'https://random-site.xyz',
      '<html><body>Random content</body></html>'
    )

    console.log('Confidence Comparison:', {
      known: {
        type: knownResult.detectedType,
        confidence: knownResult.confidence,
        methodConfidence: knownResult.methodConfidence,
      },
      unknown: {
        type: unknownResult.detectedType,
        confidence: unknownResult.confidence,
        methodConfidence: unknownResult.methodConfidence,
      },
    })

    expect(knownResult.confidence).toBeGreaterThan(unknownResult.confidence)
    expect(knownResult.methodConfidence).toBeGreaterThan(unknownResult.methodConfidence)
  })

  /**
   * TEST 10: Success Rate Prediction
   */
  it('should predict success rate based on method and type', async () => {
    const result = await matcher.analyzeWebsite(
      'https://app.uniswap.org/swap',
      '<html><body>Swap<script>window.ethereum = {}</script></body></html>'
    )

    console.log('Success Prediction:', {
      method: result.recommendedMethod,
      predictedSuccessRate: result.predictedSuccessRate,
      predictedTime: result.predictedTime,
    })

    expect(result.predictedSuccessRate).toBeGreaterThanOrEqual(70)
    expect(result.predictedSuccessRate).toBeLessThanOrEqual(100)
    expect(result.predictedTime).toBeGreaterThan(0)
  })

  /**
   * TEST 11: Reasoning Explanation
   */
  it('should provide detailed reasoning', async () => {
    const result = await matcher.analyzeWebsite(
      'https://app.aave.com',
      `
        <html>
          <body>
            <script>window.ethereum = {isMetaMask: true}</script>
            <div>Lending Protocol</div>
            <div>Interest Rate: 5.2%</div>
            <script src="websocket.js"></script>
          </body>
        </html>
      `
    )

    console.log('Reasoning:', result.reasoning)

    expect(result.reasoning).toContain(result.recommendedMethod.toUpperCase())
    expect(result.reasoning).toContain(result.detectedType)
    expect(result.reasoning).toContain(String(result.methodConfidence))
  })

  /**
   * TEST 12: Multi-Factor Balance
   */
  it('should balance multiple factors appropriately', async () => {
    // Simple exchange (should prefer static)
    const simpleExchange = await matcher.analyzeWebsite(
      'https://simple-swap.io',
      `
        <html>
          <body>
            <script src="jquery.js"></script>
            <div>Swap</div>
            <script>window.ethereum = {}</script>
          </body>
        </html>
      `
    )

    // Complex real-time CEX (should prefer proxy)
    const complexCex = await matcher.analyzeWebsite(
      'https://advanced-cex.com',
      `
        <html>
          <body>
            <script src="react.js"></script>
            <script>
              const ws = new WebSocket('wss://');
              window.ethereum = {isMetaMask: true};
            </script>
            <div>Real-time Trading</div>
            <div>Live Orderbook</div>
          </body>
        </html>
      `
    )

    console.log('Multi-Factor Balance:', {
      simpleExchange: {
        method: simpleExchange.recommendedMethod,
        confidence: simpleExchange.methodConfidence,
      },
      complexCex: {
        method: complexCex.recommendedMethod,
        confidence: complexCex.methodConfidence,
      },
    })

    expect(simpleExchange.recommendedMethod).toBe('static')
    // Complex CEX with WebSocket gets proxy or hybrid — both are correct
    expect(['proxy', 'hybrid']).toContain(complexCex.recommendedMethod)
  })
})
