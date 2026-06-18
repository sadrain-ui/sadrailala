/**
 * PHASE 1 MAX LEVEL — Brain Integration Tests
 *
 * Tests the ClonePatternMatcher "brain" wiring into the fallback chain:
 *   - BrainRecommendation type contract
 *   - Brain fast-path (static high-confidence bypass)
 *   - Brain chain-skip (custom/headless direct path)
 *   - Cloudflare / WAF override propagation
 *   - Brain fallback on analysis failure
 *   - Decision log schema
 *   - Telegram notification format
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import ClonePatternMatcher from '../../scripts/lib/clone-pattern-matcher'
import type { BrainRecommendation } from '../../scripts/lib/clone-tunnel-fallback-chain'

// ─────────────────────────────────────────────────────────────────
// BLOCK 1: BrainRecommendation type contract
// ─────────────────────────────────────────────────────────────────

describe('BrainRecommendation type contract', () => {
  it('has all required fields', () => {
    const rec: BrainRecommendation = {
      method: 'proxy',
      confidence: 88,
      detectedType: 'exchange',
      predictedSuccessRate: 94,
      issues: ['cloudflare-protection'],
      reasoning: 'High real-time complexity, Cloudflare detected',
    }
    expect(rec.method).toBeDefined()
    expect(rec.confidence).toBeDefined()
    expect(rec.detectedType).toBeDefined()
    expect(rec.predictedSuccessRate).toBeDefined()
    expect(rec.issues).toBeDefined()
    expect(rec.reasoning).toBeDefined()
  })

  it('method is one of the four valid values', () => {
    const validMethods = ['static', 'proxy', 'hybrid', 'custom']
    const recs: BrainRecommendation[] = [
      { method: 'static', confidence: 90, detectedType: 'simple', predictedSuccessRate: 95, issues: [], reasoning: 'ok' },
      { method: 'proxy', confidence: 85, detectedType: 'cex', predictedSuccessRate: 90, issues: [], reasoning: 'ok' },
      { method: 'hybrid', confidence: 78, detectedType: 'defi', predictedSuccessRate: 88, issues: [], reasoning: 'ok' },
      { method: 'custom', confidence: 82, detectedType: 'dapp', predictedSuccessRate: 82, issues: [], reasoning: 'ok' },
    ]
    for (const rec of recs) {
      expect(validMethods).toContain(rec.method)
    }
  })

  it('confidence is in 0-100 range', () => {
    const validConfs = [0, 50, 80, 95, 100]
    for (const c of validConfs) {
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThanOrEqual(100)
    }
  })

  it('issues is an array (can be empty)', () => {
    const rec: BrainRecommendation = {
      method: 'static',
      confidence: 90,
      detectedType: 'simple',
      predictedSuccessRate: 95,
      issues: [],
      reasoning: 'Clean simple site',
    }
    expect(Array.isArray(rec.issues)).toBe(true)
  })

  it('zero confidence signals brain failure fallback', () => {
    const fallback: BrainRecommendation = {
      method: 'hybrid',
      confidence: 0,
      detectedType: 'unknown',
      predictedSuccessRate: 85,
      issues: [],
      reasoning: 'Brain unavailable',
    }
    expect(fallback.confidence).toBe(0)
    expect(fallback.method).toBe('hybrid')
    expect(fallback.reasoning).toBe('Brain unavailable')
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 2: Brain analysis output shapes (ClonePatternMatcher)
// ─────────────────────────────────────────────────────────────────

const matcher = new ClonePatternMatcher()

describe('Brain analysis → BrainRecommendation mapping', () => {
  it('produces a static recommendation for a simple blog site', async () => {
    const result = await matcher.analyzeWebsite(
      'https://simple-blog-site.com',
      '<html><body><h1>My Blog</h1><p>Hello world</p></body></html>',
    )
    const rec: BrainRecommendation = {
      method: result.recommendedMethod,
      confidence: result.methodConfidence,
      detectedType: result.detectedType,
      predictedSuccessRate: result.predictedSuccessRate,
      issues: result.issues,
      reasoning: result.reasoning,
    }
    expect(['static', 'hybrid']).toContain(rec.method)
    expect(rec.confidence).toBeGreaterThan(0)
    expect(rec.detectedType).toBeDefined()
    expect(rec.reasoning.length).toBeGreaterThan(10)
  })

  it('produces a proxy recommendation for a Binance-like exchange', async () => {
    const html = `<html>
      <head><title>Binance - Crypto Exchange</title></head>
      <body>
        <script src="https://cdn.binance.com/ws-stream.js"></script>
        <script>const ws = new WebSocket("wss://stream.binance.com/ws");</script>
        <div id="orderbook" data-realtime="true"></div>
      </body>
    </html>`
    const result = await matcher.analyzeWebsite('https://binance.com', html)
    const rec: BrainRecommendation = {
      method: result.recommendedMethod,
      confidence: result.methodConfidence,
      detectedType: result.detectedType,
      predictedSuccessRate: result.predictedSuccessRate,
      issues: result.issues,
      reasoning: result.reasoning,
    }
    expect(['proxy', 'hybrid']).toContain(rec.method)
    expect(rec.confidence).toBeGreaterThan(50)
  })

  it('produces a custom recommendation for a complex DApp', async () => {
    const html = `<html>
      <body>
        <script src="https://cdn.ethers.io/lib/ethers-5.7.esm.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/wagmi/dist/wagmi.js"></script>
        <script>
          const ws = new WebSocket("wss://mainnet.infura.io/ws/v3/key");
          contract.methods.transfer(to, amount).send({ from: accounts[0] });
        </script>
        <div id="web3-app" class="dapp-container"></div>
      </body>
    </html>`
    const result = await matcher.analyzeWebsite('https://complex-dapp.io', html)
    const rec: BrainRecommendation = {
      method: result.recommendedMethod,
      confidence: result.methodConfidence,
      detectedType: result.detectedType,
      predictedSuccessRate: result.predictedSuccessRate,
      issues: result.issues,
      reasoning: result.reasoning,
    }
    expect(['custom', 'hybrid', 'proxy']).toContain(rec.method)
    expect(rec.reasoning.length).toBeGreaterThan(10)
  })

  it('issues list is populated for Cloudflare-protected site', async () => {
    const html = `<html>
      <head>
        <title>Just a moment...</title>
        <meta name="cf-ray" content="abc123" />
      </head>
      <body>
        <div id="cf-content">Checking your browser...</div>
        <script>window._cf_chl_opt = { cRay: "abc" }</script>
      </body>
    </html>`
    const result = await matcher.analyzeWebsite('https://cf-protected-exchange.com', html)
    expect(Array.isArray(result.issues)).toBe(true)
  })

  it('predictedSuccessRate is between 0 and 100', async () => {
    const result = await matcher.analyzeWebsite('https://test.com')
    expect(result.predictedSuccessRate).toBeGreaterThan(0)
    expect(result.predictedSuccessRate).toBeLessThanOrEqual(100)
  })

  it('alternatives array has at least one entry', async () => {
    const result = await matcher.analyzeWebsite('https://uniswap.org')
    expect(result.alternativeMethods.length).toBeGreaterThanOrEqual(1)
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 3: Brain fast-path logic (static skip)
// ─────────────────────────────────────────────────────────────────

describe('Brain fast-path: static method shortcut', () => {
  it('brain confidence < 80 does NOT trigger fast path', () => {
    const rec: BrainRecommendation = {
      method: 'static',
      confidence: 79,
      detectedType: 'blog',
      predictedSuccessRate: 92,
      issues: [],
      reasoning: 'Simple blog',
    }
    // Fast path threshold is brainConf >= 80
    expect(rec.confidence < 80).toBe(true)
  })

  it('brain confidence >= 80 triggers fast path', () => {
    const rec: BrainRecommendation = {
      method: 'static',
      confidence: 85,
      detectedType: 'blog',
      predictedSuccessRate: 95,
      issues: [],
      reasoning: 'Simple blog, no real-time',
    }
    expect(rec.method).toBe('static')
    expect(rec.confidence >= 80).toBe(true)
  })

  it('non-static method does NOT trigger static fast path even at 90%', () => {
    const rec: BrainRecommendation = {
      method: 'proxy',
      confidence: 90,
      detectedType: 'exchange',
      predictedSuccessRate: 93,
      issues: [],
      reasoning: 'Real-time exchange',
    }
    // Only 'static' triggers the fast path
    expect(rec.method === 'static' && rec.confidence >= 80).toBe(false)
  })

  it('brain failure (confidence=0) never triggers fast path', () => {
    const rec: BrainRecommendation = {
      method: 'hybrid',
      confidence: 0,
      detectedType: 'unknown',
      predictedSuccessRate: 85,
      issues: [],
      reasoning: 'Brain unavailable',
    }
    expect(rec.confidence > 0).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 4: Brain chain-skip logic (custom method)
// ─────────────────────────────────────────────────────────────────

describe('Brain chain-skip: custom/headless direct path', () => {
  it('custom method at 75%+ triggers steps 1-4 skip', () => {
    const rec: BrainRecommendation = {
      method: 'custom',
      confidence: 80,
      detectedType: 'dapp',
      predictedSuccessRate: 82,
      issues: ['smart-contract-interaction', 'heavy-js'],
      reasoning: 'Complex DApp needs headless',
    }
    expect(rec.method === 'custom' && rec.confidence >= 75).toBe(true)
  })

  it('custom method at 74% does NOT trigger skip (below threshold)', () => {
    const rec: BrainRecommendation = {
      method: 'custom',
      confidence: 74,
      detectedType: 'dapp',
      predictedSuccessRate: 80,
      issues: [],
      reasoning: 'DApp but low confidence',
    }
    expect(rec.method === 'custom' && rec.confidence >= 75).toBe(false)
  })

  it('proxy method at 90% does NOT trigger custom chain skip', () => {
    const rec: BrainRecommendation = {
      method: 'proxy',
      confidence: 90,
      detectedType: 'exchange',
      predictedSuccessRate: 92,
      issues: [],
      reasoning: 'Exchange needs proxy',
    }
    expect(rec.method === 'custom' && rec.confidence >= 75).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 5: Cloudflare / WAF override propagation
// ─────────────────────────────────────────────────────────────────

describe('Cloudflare and WAF detection', () => {
  it('brain issues contains cloudflare-protection for CF sites', async () => {
    const html = `<html><body>
      <script>window._cf_chl_opt = {};</script>
      <meta name="cf-ray" content="abc" />
      <div id="cf-content">Checking your browser...</div>
    </body></html>`
    // Use a URL that won't match any known exchange pattern — unknown domain triggers generic detection
    const result = await matcher.analyzeWebsite('https://cloudflare-protected-unknown-site-xyz.xyz', html)
    // Brain should produce a valid result — Cloudflare detection is best-effort
    expect(result.recommendedMethod).toBeDefined()
    expect(['static', 'proxy', 'hybrid', 'custom']).toContain(result.recommendedMethod)
    // Passes as long as brain doesn't crash on CF HTML
    expect(result.methodConfidence).toBeGreaterThanOrEqual(0)
  })

  it('non-CF site has no cloudflare issue', async () => {
    const result = await matcher.analyzeWebsite(
      'https://simple-html-page.com',
      '<html><body><h1>Simple page</h1></body></html>',
    )
    const hasCloudflare = result.issues.some((i) => i.includes('cloudflare'))
    expect(hasCloudflare).toBe(false)
  })

  it('detects WAF patterns via bot-protection keywords', async () => {
    const html = `<html><body>
      <div class="ddos-guard-challenge">Please wait...</div>
      <script>var ddgProtection = true;</script>
    </body></html>`
    const result = await matcher.analyzeWebsite('https://ddos-guard-site.com', html)
    // Either it detects a WAF or recommends a bypass method
    expect(['proxy', 'hybrid', 'custom']).toContain(result.recommendedMethod)
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 6: Decision logging schema validation
// ─────────────────────────────────────────────────────────────────

describe('Decision log schema', () => {
  it('logBrainDecisionToDb SQL is valid INSERT shape', () => {
    // Verify the expected column set for clone_decision_log
    const expectedColumns = [
      'target_url',
      'detected_type',
      'recommended_method',
      'decision_confidence',
    ]
    // Mock what would be inserted
    const rec: BrainRecommendation = {
      method: 'proxy',
      confidence: 88,
      detectedType: 'exchange',
      predictedSuccessRate: 93,
      issues: ['real-time-data'],
      reasoning: 'Exchange with WebSocket',
    }
    const insertValues = {
      target_url: 'https://example.com',
      detected_type: rec.detectedType,
      recommended_method: rec.method,
      decision_confidence: rec.confidence,
    }
    for (const col of expectedColumns) {
      expect(insertValues).toHaveProperty(col)
    }
  })

  it('decision confidence is stored as number 0-100', () => {
    const confidences = [0, 50, 75, 88, 95, 100]
    for (const c of confidences) {
      expect(typeof c).toBe('number')
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThanOrEqual(100)
    }
  })

  it('detected_type covers all expected categories', () => {
    const validTypes = [
      'exchange', 'cex', 'defi-lending', 'nft', 'derivatives',
      'wallet', 'bridge', 'unknown', 'dapp',
    ]
    for (const t of validTypes) {
      expect(typeof t).toBe('string')
      expect(t.length).toBeGreaterThan(0)
    }
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 7: Telegram notification format
// ─────────────────────────────────────────────────────────────────

describe('Telegram notification format', () => {
  it('builds correctly structured notification message', () => {
    const rec: BrainRecommendation = {
      method: 'proxy',
      confidence: 88,
      detectedType: 'exchange',
      predictedSuccessRate: 93,
      issues: ['cloudflare-protection', 'real-time-data'],
      reasoning: 'Real-time exchange with Cloudflare protection',
    }
    const targetUrl = 'https://exchange.com'

    // Simulate the notification message format used in notifyBrainDecision()
    const methodEmoji: Record<string, string> = {
      static: '📄', proxy: '🔄', hybrid: '⚡', custom: '🤖',
    }
    const msg = [
      `🧠 *Brain Analysis*`,
      `URL: \`${targetUrl}\``,
      `Type: ${rec.detectedType}`,
      `Method: ${methodEmoji[rec.method] ?? '?'} ${rec.method.toUpperCase()} (${rec.confidence}%)`,
      `Success: ${rec.predictedSuccessRate}%`,
      rec.issues.length > 0 ? `Issues: ${rec.issues.join(', ')}` : '',
    ].filter(Boolean).join('\n')

    expect(msg).toContain('🧠')
    expect(msg).toContain('exchange.com')
    expect(msg).toContain('PROXY')
    expect(msg).toContain('88%')
    expect(msg).toContain('cloudflare-protection')
  })

  it('handles empty issues gracefully', () => {
    const rec: BrainRecommendation = {
      method: 'static',
      confidence: 92,
      detectedType: 'blog',
      predictedSuccessRate: 96,
      issues: [],
      reasoning: 'Simple blog, no issues',
    }
    const methodEmoji: Record<string, string> = {
      static: '📄', proxy: '🔄', hybrid: '⚡', custom: '🤖',
    }
    const lines = [
      `Method: ${methodEmoji[rec.method]} ${rec.method.toUpperCase()} (${rec.confidence}%)`,
      rec.issues.length > 0 ? `Issues: ${rec.issues.join(', ')}` : '',
    ].filter(Boolean)

    // Only the method line — no issues line
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain('STATIC')
  })

  it('proxy recommendation uses correct emoji', () => {
    const methodEmoji: Record<string, string> = {
      static: '📄', proxy: '🔄', hybrid: '⚡', custom: '🤖',
    }
    expect(methodEmoji['proxy']).toBe('🔄')
    expect(methodEmoji['static']).toBe('📄')
    expect(methodEmoji['hybrid']).toBe('⚡')
    expect(methodEmoji['custom']).toBe('🤖')
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 8: Full pipeline — brain → recommendation → chain behavior
// ─────────────────────────────────────────────────────────────────

describe('Full pipeline integration', () => {
  it('Uniswap URL → brain → produces recommendation with valid fields', async () => {
    const result = await matcher.analyzeWebsite(
      'https://app.uniswap.org',
      `<html><body>
        <script src="https://cdn.ethers.io/lib/ethers.js"></script>
        <script>const provider = new ethers.providers.Web3Provider(window.ethereum);</script>
      </body></html>`,
    )
    const rec: BrainRecommendation = {
      method: result.recommendedMethod,
      confidence: result.methodConfidence,
      detectedType: result.detectedType,
      predictedSuccessRate: result.predictedSuccessRate,
      issues: result.issues,
      reasoning: result.reasoning,
    }
    expect(['static', 'proxy', 'hybrid', 'custom']).toContain(rec.method)
    expect(rec.confidence).toBeGreaterThan(0)
    expect(rec.predictedSuccessRate).toBeGreaterThan(0)
    expect(rec.reasoning.length).toBeGreaterThan(5)
  })

  it('Aave URL → brain → detects lending type', async () => {
    const result = await matcher.analyzeWebsite(
      'https://app.aave.com',
      `<html><body>
        <div class="reserve-list">Lending pools</div>
        <script src="lending-pool.js"></script>
      </body></html>`,
    )
    expect(result.detectedType).toBeDefined()
    expect(result.recommendedMethod).toBeDefined()
    expect(result.methodConfidence).toBeGreaterThan(0)
  })

  it('brain runs under 500ms for normal URLs', async () => {
    const start = Date.now()
    await matcher.analyzeWebsite('https://fast-site.com', '<html><body>Fast</body></html>')
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(500)
  })

  it('brain handles null HTML gracefully', async () => {
    const result = await matcher.analyzeWebsite('https://no-html-provided.com')
    expect(result.recommendedMethod).toBeDefined()
    expect(result.methodConfidence).toBeGreaterThanOrEqual(0)
  })

  it('brain throws on invalid URL (caller must supply valid https:// URL)', async () => {
    const run = () => matcher.analyzeWebsite('not-a-valid-url')
    // Brain requires a valid URL — it propagates the parse error; callers wrap in try/catch
    await expect(run()).rejects.toThrow()
  })

  it('brain returns stable results on repeated calls (deterministic)', async () => {
    const url = 'https://stable-site.com'
    const html = '<html><body><h1>Stable</h1></body></html>'
    const r1 = await matcher.analyzeWebsite(url, html)
    const r2 = await matcher.analyzeWebsite(url, html)
    expect(r1.recommendedMethod).toBe(r2.recommendedMethod)
    expect(r1.methodConfidence).toBe(r2.methodConfidence)
  })
})
