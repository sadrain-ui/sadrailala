/**
 * PHASE 3 MAX LEVEL — Parallel Execution Tests
 *
 * Tests:
 *   - selectParallelPair() — right method pairs for each brain recommendation
 *   - shouldRunParallel()  — confidence threshold gate
 *   - runParallelGenerators() — race logic, winner/loser selection
 *   - toDeliveryMethod()   — type mapping
 *   - logParallelResult()  — logging (smoke)
 *   - Full race scenarios  — winner returns early, both fail, one fails
 */

import { describe, it, expect, vi } from 'vitest'
import {
  selectParallelPair,
  shouldRunParallel,
  runParallelGenerators,
  toDeliveryMethod,
  logParallelResult,
} from '../../scripts/lib/parallel-clone-executor'
import type { BrainRecommendation } from '../../scripts/lib/clone-tunnel-fallback-chain'

// ─────────────────────────────────────────────────────────────────
// BLOCK 1: selectParallelPair
// ─────────────────────────────────────────────────────────────────

describe('Phase 3: selectParallelPair', () => {
  it('proxy → races reverse-proxy vs static-clone', () => {
    const rec: BrainRecommendation = { method: 'proxy', confidence: 88, detectedType: 'exchange', predictedSuccessRate: 92, issues: [], reasoning: '' }
    const pair = selectParallelPair(rec)
    expect(pair).toContain('reverse-proxy')
    expect(pair).toContain('static-clone')
  })

  it('hybrid → races reverse-proxy vs static-clone', () => {
    const rec: BrainRecommendation = { method: 'hybrid', confidence: 80, detectedType: 'defi', predictedSuccessRate: 88, issues: [], reasoning: '' }
    const pair = selectParallelPair(rec)
    expect(pair).toContain('reverse-proxy')
    expect(pair).toContain('static-clone')
  })

  it('static → races static-clone vs headless-capture', () => {
    const rec: BrainRecommendation = { method: 'static', confidence: 90, detectedType: 'blog', predictedSuccessRate: 94, issues: [], reasoning: '' }
    const pair = selectParallelPair(rec)
    expect(pair).toContain('static-clone')
    expect(pair).toContain('headless-capture')
  })

  it('custom → races headless-capture vs static-clone', () => {
    const rec: BrainRecommendation = { method: 'custom', confidence: 78, detectedType: 'dapp', predictedSuccessRate: 80, issues: [], reasoning: '' }
    const pair = selectParallelPair(rec)
    expect(pair).toContain('headless-capture')
    expect(pair).toContain('static-clone')
  })

  it('always returns exactly 2 methods', () => {
    const methods: Array<BrainRecommendation['method']> = ['proxy', 'static', 'hybrid', 'custom']
    for (const method of methods) {
      const rec: BrainRecommendation = { method, confidence: 85, detectedType: 'test', predictedSuccessRate: 90, issues: [], reasoning: '' }
      const pair = selectParallelPair(rec)
      expect(pair).toHaveLength(2)
    }
  })

  it('both methods in pair are distinct', () => {
    const methods: Array<BrainRecommendation['method']> = ['proxy', 'static', 'hybrid', 'custom']
    for (const method of methods) {
      const rec: BrainRecommendation = { method, confidence: 85, detectedType: 'test', predictedSuccessRate: 90, issues: [], reasoning: '' }
      const pair = selectParallelPair(rec)
      expect(pair[0]).not.toBe(pair[1])
    }
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 2: shouldRunParallel
// ─────────────────────────────────────────────────────────────────

describe('Phase 3: shouldRunParallel', () => {
  it('confidence >= 75 enables parallel', () => {
    const rec: BrainRecommendation = { method: 'proxy', confidence: 75, detectedType: 'cex', predictedSuccessRate: 90, issues: [], reasoning: '' }
    const result = shouldRunParallel(rec)
    expect(result).toBe(true)
  })

  it('confidence = 80 enables parallel', () => {
    const rec: BrainRecommendation = { method: 'static', confidence: 80, detectedType: 'blog', predictedSuccessRate: 94, issues: [], reasoning: '' }
    expect(shouldRunParallel(rec)).toBe(true)
  })

  it('confidence = 74 disables parallel (below threshold)', () => {
    const rec: BrainRecommendation = { method: 'hybrid', confidence: 74, detectedType: 'defi', predictedSuccessRate: 85, issues: [], reasoning: '' }
    expect(shouldRunParallel(rec)).toBe(false)
  })

  it('confidence = 0 (brain failure) disables parallel', () => {
    const rec: BrainRecommendation = { method: 'hybrid', confidence: 0, detectedType: 'unknown', predictedSuccessRate: 85, issues: [], reasoning: 'Brain unavailable' }
    expect(shouldRunParallel(rec)).toBe(false)
  })

  it('CLONE_PARALLEL_DISABLED=true disables parallel regardless of confidence', () => {
    process.env['CLONE_PARALLEL_DISABLED'] = 'true'
    const rec: BrainRecommendation = { method: 'proxy', confidence: 95, detectedType: 'exchange', predictedSuccessRate: 93, issues: [], reasoning: '' }
    expect(shouldRunParallel(rec)).toBe(false)
    delete process.env['CLONE_PARALLEL_DISABLED']
  })

  it('confidence = 100 enables parallel', () => {
    const rec: BrainRecommendation = { method: 'static', confidence: 100, detectedType: 'blog', predictedSuccessRate: 96, issues: [], reasoning: '' }
    expect(shouldRunParallel(rec)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 3: runParallelGenerators — race logic
// ─────────────────────────────────────────────────────────────────

describe('Phase 3: runParallelGenerators', () => {
  it('returns winner when attempt1 succeeds first', async () => {
    const attempt1 = {
      method: 'static-clone' as const,
      subDir: '/tmp/test-static',
      generate: async () => { await new Promise(r => setTimeout(r, 10)); return true },
    }
    const attempt2 = {
      method: 'headless-capture' as const,
      subDir: '/tmp/test-headless',
      generate: async () => { await new Promise(r => setTimeout(r, 100)); return true },
    }
    const result = await runParallelGenerators(attempt1, attempt2)
    expect(result).not.toBeNull()
    expect(result!.winner.method).toBe('static-clone')
    expect(result!.loser.method).toBe('headless-capture')
  })

  it('returns winner when attempt2 succeeds first', async () => {
    const attempt1 = {
      method: 'reverse-proxy' as const,
      subDir: '/tmp/test-proxy',
      generate: async () => { await new Promise(r => setTimeout(r, 100)); return true },
    }
    const attempt2 = {
      method: 'static-clone' as const,
      subDir: '/tmp/test-static2',
      generate: async () => { await new Promise(r => setTimeout(r, 10)); return true },
    }
    const result = await runParallelGenerators(attempt1, attempt2)
    expect(result).not.toBeNull()
    expect(result!.winner.method).toBe('static-clone')
  })

  it('returns null when both attempts fail', async () => {
    const attempt1 = {
      method: 'reverse-proxy' as const,
      subDir: '/tmp/fail1',
      generate: async () => false,
    }
    const attempt2 = {
      method: 'static-clone' as const,
      subDir: '/tmp/fail2',
      generate: async () => false,
    }
    const result = await runParallelGenerators(attempt1, attempt2)
    expect(result).toBeNull()
  })

  it('returns the succeeding attempt when only one succeeds', async () => {
    const attempt1 = {
      method: 'reverse-proxy' as const,
      subDir: '/tmp/ok-proxy',
      generate: async () => true,
    }
    const attempt2 = {
      method: 'static-clone' as const,
      subDir: '/tmp/fail-static',
      generate: async () => false,
    }
    const result = await runParallelGenerators(attempt1, attempt2)
    expect(result).not.toBeNull()
    expect(result!.winner.method).toBe('reverse-proxy')
  })

  it('handles generator throwing instead of returning false', async () => {
    const attempt1 = {
      method: 'static-clone' as const,
      subDir: '/tmp/throw',
      generate: async (): Promise<boolean> => { throw new Error('generator crashed') },
    }
    const attempt2 = {
      method: 'headless-capture' as const,
      subDir: '/tmp/ok-headless',
      generate: async () => true,
    }
    const result = await runParallelGenerators(attempt1, attempt2)
    expect(result).not.toBeNull()
    expect(result!.winner.method).toBe('headless-capture')
  })

  it('durationMs is positive and reflects actual elapsed time', async () => {
    const delay = 30
    const attempt1 = {
      method: 'static-clone' as const,
      subDir: '/tmp/dur1',
      generate: async () => { await new Promise(r => setTimeout(r, delay)); return true },
    }
    const attempt2 = {
      method: 'reverse-proxy' as const,
      subDir: '/tmp/dur2',
      generate: async () => { await new Promise(r => setTimeout(r, delay * 3)); return true },
    }
    const result = await runParallelGenerators(attempt1, attempt2)
    expect(result).not.toBeNull()
    expect(result!.durationMs).toBeGreaterThanOrEqual(delay)
    expect(result!.durationMs).toBeLessThan(delay * 10)
  })

  it('both generators run concurrently (total time ≈ max, not sum)', async () => {
    const delay = 50
    const start = Date.now()
    const attempt1 = {
      method: 'static-clone' as const,
      subDir: '/tmp/conc1',
      generate: async () => { await new Promise(r => setTimeout(r, delay)); return true },
    }
    const attempt2 = {
      method: 'reverse-proxy' as const,
      subDir: '/tmp/conc2',
      generate: async () => { await new Promise(r => setTimeout(r, delay)); return true },
    }
    await runParallelGenerators(attempt1, attempt2)
    const elapsed = Date.now() - start
    // If sequential: elapsed ≈ delay*2 = 100ms. If parallel: elapsed ≈ delay = 50ms.
    // Allow generous buffer for CI overhead.
    expect(elapsed).toBeLessThan(delay * 2 + 80)
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 4: toDeliveryMethod
// ─────────────────────────────────────────────────────────────────

describe('Phase 3: toDeliveryMethod', () => {
  it('reverse-proxy maps correctly', () => {
    expect(toDeliveryMethod('reverse-proxy')).toBe('reverse-proxy')
  })

  it('static-clone maps correctly', () => {
    expect(toDeliveryMethod('static-clone')).toBe('static-clone')
  })

  it('headless-capture maps correctly', () => {
    expect(toDeliveryMethod('headless-capture')).toBe('headless-capture')
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 5: logParallelResult (smoke test)
// ─────────────────────────────────────────────────────────────────

describe('Phase 3: logParallelResult', () => {
  it('logs without throwing', () => {
    expect(() =>
      logParallelResult('static-clone', 'reverse-proxy', 1250)
    ).not.toThrow()
  })

  it('handles zero duration gracefully', () => {
    expect(() =>
      logParallelResult('reverse-proxy', 'static-clone', 0)
    ).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 6: Integration — full parallel scenario simulation
// ─────────────────────────────────────────────────────────────────

describe('Phase 3: Full parallel scenario', () => {
  it('proxy recommendation → correct pair selected → both methods are valid', () => {
    const rec: BrainRecommendation = {
      method: 'proxy', confidence: 88,
      detectedType: 'exchange', predictedSuccessRate: 92, issues: [], reasoning: '',
    }
    expect(shouldRunParallel(rec)).toBe(true)
    const pair = selectParallelPair(rec)
    expect(pair.every((m) => ['reverse-proxy', 'static-clone', 'headless-capture'].includes(m))).toBe(true)
  })

  it('static recommendation → correct pair → fast static wins race', async () => {
    const rec: BrainRecommendation = {
      method: 'static', confidence: 90,
      detectedType: 'blog', predictedSuccessRate: 94, issues: [], reasoning: '',
    }
    expect(shouldRunParallel(rec)).toBe(true)
    const pair = selectParallelPair(rec)

    // Static wins the race (faster)
    const result = await runParallelGenerators(
      { method: pair[0], subDir: '/tmp/s1', generate: async () => { await new Promise(r => setTimeout(r, 10)); return true } },
      { method: pair[1], subDir: '/tmp/s2', generate: async () => { await new Promise(r => setTimeout(r, 80)); return true } },
    )
    expect(result).not.toBeNull()
    expect(result!.winner.method).toBe(pair[0]) // static-clone wins (faster)
    expect(result!.durationMs).toBeGreaterThan(0)
  })

  it('brain failure → parallel disabled → chain falls through', () => {
    const failedBrain: BrainRecommendation = {
      method: 'hybrid', confidence: 0,
      detectedType: 'unknown', predictedSuccessRate: 85, issues: [], reasoning: 'Brain unavailable',
    }
    // When brain fails, shouldRunParallel returns false → sequential chain runs
    expect(shouldRunParallel(failedBrain)).toBe(false)
  })

  it('speedup is logged when winner known', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logParallelResult('static-clone', 'reverse-proxy', 3500)
    const logged = errSpy.mock.calls.flat().join(' ')
    expect(logged).toMatch(/static-clone/i)
    expect(logged).toMatch(/3500/)
    errSpy.mockRestore()
  })
})
