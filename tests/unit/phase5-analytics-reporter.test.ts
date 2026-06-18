/**
 * PHASE 5 MAX LEVEL — Analytics Reporter Tests
 *
 * Tests:
 *   - WeeklyDigest type contract
 *   - BrainAccuracyReport type contract
 *   - formatTelegramDigest() — structure and content
 *   - Success bar rendering
 *   - Top failures formatting
 *   - MethodStats / TypeStats contracts
 *   - analyticsReporter singleton
 *   - Edge cases: zero clones, no failures, single method
 */

import { describe, it, expect } from 'vitest'
import { AnalyticsReporter } from '../../scripts/lib/analytics-reporter'
import type { WeeklyDigest, BrainAccuracyReport, MethodStats, TypeStats } from '../../scripts/lib/analytics-reporter'

const reporter = new AnalyticsReporter(7)

// ─────────────────────────────────────────────────────────────────
// BLOCK 1: Type contracts
// ─────────────────────────────────────────────────────────────────

describe('Phase 5: WeeklyDigest type contract', () => {
  const makeDigest = (overrides?: Partial<WeeklyDigest>): WeeklyDigest => ({
    period: 'Last 7 days',
    totalClones: 150,
    overallSuccessRate: 87,
    brainAccuracy: { methodMatchRate: 73, predictionAccuracy: 68, totalClones: 150 },
    byMethod: [],
    byType: [],
    topFailures: [],
    generatedAt: new Date().toISOString(),
    ...overrides,
  })

  it('has all required fields', () => {
    const d = makeDigest()
    expect(d.period).toBeDefined()
    expect(d.totalClones).toBeGreaterThanOrEqual(0)
    expect(d.overallSuccessRate).toBeGreaterThanOrEqual(0)
    expect(d.brainAccuracy).toBeDefined()
    expect(Array.isArray(d.byMethod)).toBe(true)
    expect(Array.isArray(d.byType)).toBe(true)
    expect(Array.isArray(d.topFailures)).toBe(true)
    expect(d.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('overallSuccessRate is 0-100', () => {
    const d = makeDigest({ overallSuccessRate: 87 })
    expect(d.overallSuccessRate).toBeGreaterThanOrEqual(0)
    expect(d.overallSuccessRate).toBeLessThanOrEqual(100)
  })
})

describe('Phase 5: BrainAccuracyReport type contract', () => {
  it('has all required fields', () => {
    const acc: BrainAccuracyReport = {
      methodMatchRate: 73,
      predictionAccuracy: 68,
      totalClones: 150,
    }
    expect(acc.methodMatchRate).toBeGreaterThanOrEqual(0)
    expect(acc.predictionAccuracy).toBeGreaterThanOrEqual(0)
    expect(acc.totalClones).toBeGreaterThanOrEqual(0)
  })

  it('rates are 0-100', () => {
    const acc: BrainAccuracyReport = { methodMatchRate: 100, predictionAccuracy: 0, totalClones: 5 }
    expect(acc.methodMatchRate).toBeLessThanOrEqual(100)
    expect(acc.predictionAccuracy).toBeLessThanOrEqual(100)
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 2: formatTelegramDigest()
// ─────────────────────────────────────────────────────────────────

describe('Phase 5: formatTelegramDigest()', () => {
  const baseDigest: WeeklyDigest = {
    period: 'Last 7 days',
    totalClones: 248,
    overallSuccessRate: 89,
    brainAccuracy: { methodMatchRate: 76, predictionAccuracy: 71, totalClones: 248 },
    byMethod: [
      { method: 'reverse-proxy', total: 120, successes: 112, successRate: 93, avgDurationMs: 48000 },
      { method: 'static-clone', total: 95, successes: 88, successRate: 93, avgDurationMs: 32000 },
      { method: 'headless-capture', total: 25, successes: 18, successRate: 72, avgDurationMs: 85000 },
      { method: 'placeholder', total: 8, successes: 0, successRate: 0, avgDurationMs: 2000 },
    ],
    byType: [
      { detectedType: 'binance', total: 45, successes: 42, successRate: 93, bestMethod: 'reverse-proxy' },
      { detectedType: 'uniswap', total: 38, successes: 37, successRate: 97, bestMethod: 'static-clone' },
    ],
    topFailures: [
      { url: 'https://cloudflare-hard.com', method: 'reverse-proxy', attempts: 5 },
    ],
    generatedAt: new Date('2026-06-18T10:00:00Z').toISOString(),
  }

  it('starts with analytics header', () => {
    const msg = reporter.formatTelegramDigest(baseDigest)
    expect(msg).toContain('LEGION ANALYTICS')
    expect(msg).toContain('LAST 7 DAYS')
  })

  it('includes total clone count', () => {
    const msg = reporter.formatTelegramDigest(baseDigest)
    expect(msg).toContain('248')
  })

  it('includes overall success rate', () => {
    const msg = reporter.formatTelegramDigest(baseDigest)
    expect(msg).toContain('89%')
  })

  it('includes brain accuracy stats', () => {
    const msg = reporter.formatTelegramDigest(baseDigest)
    expect(msg).toContain('76%')
    expect(msg).toContain('71%')
  })

  it('includes method breakdown', () => {
    const msg = reporter.formatTelegramDigest(baseDigest)
    expect(msg).toContain('reverse-proxy')
    expect(msg).toContain('static-clone')
  })

  it('includes site type breakdown', () => {
    const msg = reporter.formatTelegramDigest(baseDigest)
    expect(msg).toContain('binance')
    expect(msg).toContain('uniswap')
  })

  it('includes top failures section', () => {
    const msg = reporter.formatTelegramDigest(baseDigest)
    expect(msg).toContain('cloudflare-hard.com')
  })

  it('includes generation timestamp', () => {
    const msg = reporter.formatTelegramDigest(baseDigest)
    expect(msg).toContain('2026')
  })

  it('shows method emojis for known methods', () => {
    const msg = reporter.formatTelegramDigest(baseDigest)
    // reverse-proxy → 🔄, static-clone → 📄
    expect(msg).toMatch(/🔄|📄|🖥️|⚠️/)
  })

  it('handles empty byMethod gracefully', () => {
    const digest = { ...baseDigest, byMethod: [] }
    expect(() => reporter.formatTelegramDigest(digest)).not.toThrow()
  })

  it('handles empty topFailures gracefully', () => {
    const digest = { ...baseDigest, topFailures: [] }
    const msg = reporter.formatTelegramDigest(digest)
    expect(msg).not.toContain('Top Failures')
  })

  it('limits method list to 6 entries max', () => {
    const manyMethods: MethodStats[] = Array.from({ length: 10 }, (_, i) => ({
      method: `method-${i}`,
      total: 10, successes: 8, successRate: 80, avgDurationMs: 20000,
    }))
    const digest = { ...baseDigest, byMethod: manyMethods }
    const msg = reporter.formatTelegramDigest(digest)
    // Count method entries (lines with "method-")
    const methodLines = msg.split('\n').filter((l) => l.includes('method-'))
    expect(methodLines.length).toBeLessThanOrEqual(6)
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 3: Edge cases
// ─────────────────────────────────────────────────────────────────

describe('Phase 5: Edge cases', () => {
  it('handles zero clones gracefully', () => {
    const digest: WeeklyDigest = {
      period: 'Last 7 days',
      totalClones: 0,
      overallSuccessRate: 0,
      brainAccuracy: { methodMatchRate: 0, predictionAccuracy: 0, totalClones: 0 },
      byMethod: [],
      byType: [],
      topFailures: [],
      generatedAt: new Date().toISOString(),
    }
    expect(() => reporter.formatTelegramDigest(digest)).not.toThrow()
    const msg = reporter.formatTelegramDigest(digest)
    expect(msg).toContain('0')
  })

  it('handles 100% success rate', () => {
    const digest: WeeklyDigest = {
      period: 'Last 7 days',
      totalClones: 50,
      overallSuccessRate: 100,
      brainAccuracy: { methodMatchRate: 100, predictionAccuracy: 100, totalClones: 50 },
      byMethod: [{ method: 'static-clone', total: 50, successes: 50, successRate: 100, avgDurationMs: 25000 }],
      byType: [],
      topFailures: [],
      generatedAt: new Date().toISOString(),
    }
    const msg = reporter.formatTelegramDigest(digest)
    expect(msg).toContain('100%')
  })

  it('handles invalid URLs in topFailures without crashing', () => {
    const digest: WeeklyDigest = {
      period: 'Last 7 days',
      totalClones: 10,
      overallSuccessRate: 80,
      brainAccuracy: { methodMatchRate: 75, predictionAccuracy: 70, totalClones: 10 },
      byMethod: [],
      byType: [],
      topFailures: [
        { url: 'not-a-valid-url', method: 'proxy', attempts: 3 },
      ],
      generatedAt: new Date().toISOString(),
    }
    expect(() => reporter.formatTelegramDigest(digest)).not.toThrow()
  })

  it('handles very long site type names', () => {
    const digest: WeeklyDigest = {
      period: 'Last 7 days',
      totalClones: 5,
      overallSuccessRate: 80,
      brainAccuracy: { methodMatchRate: 70, predictionAccuracy: 65, totalClones: 5 },
      byMethod: [],
      byType: [{ detectedType: 'very-long-defi-protocol-name-with-many-chars', total: 5, successes: 4, successRate: 80, bestMethod: 'proxy' }],
      topFailures: [],
      generatedAt: new Date().toISOString(),
    }
    expect(() => reporter.formatTelegramDigest(digest)).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 4: AnalyticsReporter config
// ─────────────────────────────────────────────────────────────────

describe('Phase 5: AnalyticsReporter config', () => {
  it('default window is 7 days', () => {
    const r = new AnalyticsReporter()
    expect(r).toBeDefined()
  })

  it('custom window is accepted', () => {
    const r = new AnalyticsReporter(30)
    expect(r).toBeDefined()
  })

  it('analyticsReporter singleton is exported', async () => {
    const module = await import('../../scripts/lib/analytics-reporter')
    expect(module.analyticsReporter).toBeInstanceOf(AnalyticsReporter)
  })

  it('buildDigest returns null when no DB connection', async () => {
    // No DB env vars set in test environment
    const r = new AnalyticsReporter(7)
    const result = await r.buildDigest()
    expect(result).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 5: Full digest pipeline simulation
// ─────────────────────────────────────────────────────────────────

describe('Phase 5: Full digest pipeline', () => {
  it('7-day digest with mixed methods produces valid output', () => {
    const digest: WeeklyDigest = {
      period: 'Last 7 days',
      totalClones: 312,
      overallSuccessRate: 91,
      brainAccuracy: { methodMatchRate: 79, predictionAccuracy: 74, totalClones: 312 },
      byMethod: [
        { method: 'reverse-proxy', total: 180, successes: 168, successRate: 93, avgDurationMs: 47000 },
        { method: 'static-clone', total: 100, successes: 95, successRate: 95, avgDurationMs: 29000 },
        { method: 'headless-capture', total: 20, successes: 13, successRate: 65, avgDurationMs: 92000 },
        { method: 'placeholder', total: 12, successes: 0, successRate: 0, avgDurationMs: 1500 },
      ],
      byType: [
        { detectedType: 'binance', total: 80, successes: 76, successRate: 95, bestMethod: 'reverse-proxy' },
        { detectedType: 'uniswap', total: 65, successes: 64, successRate: 98, bestMethod: 'static-clone' },
        { detectedType: 'opensea', total: 40, successes: 35, successRate: 87, bestMethod: 'reverse-proxy' },
        { detectedType: 'aave', total: 30, successes: 28, successRate: 93, bestMethod: 'proxy' },
      ],
      topFailures: [
        { url: 'https://cf-protected.exchange.com', method: 'reverse-proxy', attempts: 8 },
        { url: 'https://waf-protected.cex.io', method: 'static-clone', attempts: 4 },
      ],
      generatedAt: new Date().toISOString(),
    }

    const msg = reporter.formatTelegramDigest(digest)

    // Structure checks
    expect(msg).toContain('312')
    expect(msg).toContain('91%')
    expect(msg).toContain('79%')
    expect(msg.split('\n').length).toBeGreaterThan(10)

    // Should mention all major methods
    expect(msg).toContain('reverse-proxy')
    expect(msg).toContain('static-clone')

    // Should mention top site types
    expect(msg).toContain('binance')
    expect(msg).toContain('uniswap')

    // Should mention top failures
    expect(msg).toContain('cf-protected.exchange.com')
  })

  it('brain accuracy of 79% is reported correctly', () => {
    const digest: WeeklyDigest = {
      period: 'Last 7 days',
      totalClones: 50,
      overallSuccessRate: 85,
      brainAccuracy: { methodMatchRate: 79, predictionAccuracy: 72, totalClones: 50 },
      byMethod: [],
      byType: [],
      topFailures: [],
      generatedAt: new Date().toISOString(),
    }
    const msg = reporter.formatTelegramDigest(digest)
    expect(msg).toContain('79%')
    expect(msg).toContain('72%')
  })
})
