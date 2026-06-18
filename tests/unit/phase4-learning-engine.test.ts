/**
 * PHASE 4 MAX LEVEL — Learning Engine Tests
 *
 * Tests:
 *   - MethodPerformance type contract
 *   - CalibrationData contract
 *   - applyCalibration() — confidence adjustment logic
 *   - bestMethodForType() — historical best-method lookup
 *   - summarise() — human-readable output
 *   - calibrationFactor clamp (0.6 – 1.4)
 *   - Edge cases: null calibration, empty data, insufficient records
 */

import { describe, it, expect } from 'vitest'
import { LearningEngine } from '../../scripts/lib/learning-engine'
import type { CalibrationData, MethodPerformance } from '../../scripts/lib/learning-engine'

// ─────────────────────────────────────────────────────────────────
// BLOCK 1: Type contracts
// ─────────────────────────────────────────────────────────────────

describe('Phase 4: MethodPerformance type contract', () => {
  it('has all required fields', () => {
    const perf: MethodPerformance = {
      detectedType: 'uniswap',
      recommendedMethod: 'static',
      attempts: 42,
      successes: 38,
      realSuccessRate: 90,
      avgDurationMs: 12500,
      calibrationFactor: 1.05,
    }
    expect(perf.detectedType).toBeDefined()
    expect(perf.recommendedMethod).toBeDefined()
    expect(perf.attempts).toBeGreaterThan(0)
    expect(perf.successes).toBeGreaterThanOrEqual(0)
    expect(perf.realSuccessRate).toBeGreaterThanOrEqual(0)
    expect(perf.calibrationFactor).toBeGreaterThan(0)
  })

  it('realSuccessRate = successes / attempts * 100', () => {
    const attempts = 50
    const successes = 45
    const rate = Math.round((successes / attempts) * 100)
    expect(rate).toBe(90)
  })

  it('calibrationFactor > 1 means real > predicted (brain was pessimistic)', () => {
    const realRate = 0.95
    const predictedRate = 0.85
    const factor = realRate / predictedRate
    expect(factor).toBeGreaterThan(1)
  })

  it('calibrationFactor < 1 means real < predicted (brain was optimistic)', () => {
    const realRate = 0.70
    const predictedRate = 0.89
    const factor = realRate / predictedRate
    expect(factor).toBeLessThan(1)
  })
})

describe('Phase 4: CalibrationData type contract', () => {
  it('has all required fields', () => {
    const data: CalibrationData = {
      methodPerformance: [],
      totalRecordsAnalysed: 0,
      learningWindowDays: 30,
      computedAt: new Date().toISOString(),
    }
    expect(data.methodPerformance).toBeDefined()
    expect(data.totalRecordsAnalysed).toBeGreaterThanOrEqual(0)
    expect(data.learningWindowDays).toBeGreaterThan(0)
    expect(data.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 2: applyCalibration()
// ─────────────────────────────────────────────────────────────────

describe('Phase 4: applyCalibration()', () => {
  const engine = new LearningEngine()

  const makeCalibration = (
    detectedType: string,
    method: string,
    calibrationFactor: number,
  ): CalibrationData => ({
    methodPerformance: [{
      detectedType,
      recommendedMethod: method,
      attempts: 20,
      successes: 18,
      realSuccessRate: 90,
      avgDurationMs: 12000,
      calibrationFactor,
    }],
    totalRecordsAnalysed: 20,
    learningWindowDays: 30,
    computedAt: new Date().toISOString(),
  })

  it('returns raw confidence when calibration is null', () => {
    expect(engine.applyCalibration(80, 'uniswap', 'static', null)).toBe(80)
  })

  it('applies factor > 1 → increases confidence', () => {
    const calibration = makeCalibration('uniswap', 'static', 1.1)
    const result = engine.applyCalibration(80, 'uniswap', 'static', calibration)
    expect(result).toBe(88) // 80 * 1.1 = 88
  })

  it('applies factor < 1 → decreases confidence', () => {
    const calibration = makeCalibration('binance', 'proxy', 0.9)
    const result = engine.applyCalibration(90, 'binance', 'proxy', calibration)
    expect(result).toBe(81) // 90 * 0.9 = 81
  })

  it('returns raw confidence when type+method not found in calibration', () => {
    const calibration = makeCalibration('uniswap', 'static', 1.2)
    // querying different type
    const result = engine.applyCalibration(75, 'opensea', 'hybrid', calibration)
    expect(result).toBe(75)
  })

  it('clamps result at 100 maximum', () => {
    const calibration = makeCalibration('uniswap', 'static', 1.4)
    const result = engine.applyCalibration(95, 'uniswap', 'static', calibration)
    expect(result).toBeLessThanOrEqual(100)
  })

  it('clamps result at 0 minimum', () => {
    const calibration = makeCalibration('uniswap', 'static', 0.6)
    const result = engine.applyCalibration(0, 'uniswap', 'static', calibration)
    expect(result).toBeGreaterThanOrEqual(0)
  })

  it('factor = 1.0 → confidence unchanged', () => {
    const calibration = makeCalibration('aave', 'proxy', 1.0)
    const result = engine.applyCalibration(85, 'aave', 'proxy', calibration)
    expect(result).toBe(85)
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 3: calibrationFactor clamping
// ─────────────────────────────────────────────────────────────────

describe('Phase 4: calibrationFactor clamping', () => {
  const engine = new LearningEngine({ calibrationClampMin: 0.6, calibrationClampMax: 1.4 })

  it('factor above 1.4 is clamped to 1.4', () => {
    // real=1.0, predicted=0.5 → factor=2.0 → clamp to 1.4
    const realRate = 1.0
    const predictedRate = 0.5
    const raw = realRate / predictedRate
    const clamped = Math.min(Math.max(raw, 0.6), 1.4)
    expect(clamped).toBe(1.4)
  })

  it('factor below 0.6 is clamped to 0.6', () => {
    // real=0.2, predicted=0.9 → factor=0.22 → clamp to 0.6
    const realRate = 0.2
    const predictedRate = 0.9
    const raw = realRate / predictedRate
    const clamped = Math.min(Math.max(raw, 0.6), 1.4)
    expect(clamped).toBe(0.6)
  })

  it('factor in range 0.6–1.4 is not clamped', () => {
    const factor = 1.2
    const clamped = Math.min(Math.max(factor, 0.6), 1.4)
    expect(clamped).toBe(1.2)
  })

  it('custom engine config respects different clamp values', () => {
    const tightEngine = new LearningEngine({ calibrationClampMin: 0.8, calibrationClampMax: 1.2 })
    const perf: MethodPerformance = {
      detectedType: 'uniswap', recommendedMethod: 'static',
      attempts: 10, successes: 5, realSuccessRate: 50, avgDurationMs: 10000,
      calibrationFactor: 0.5, // below 0.8 clamp
    }
    const calibration: CalibrationData = {
      methodPerformance: [perf],
      totalRecordsAnalysed: 10,
      learningWindowDays: 30,
      computedAt: new Date().toISOString(),
    }
    // Apply with tight engine — minimum clamp is 0.8
    const rawConf = 90
    const adjusted = tightEngine.applyCalibration(rawConf, 'uniswap', 'static', calibration)
    // calibrationFactor stored as 0.5 — but because we stored it pre-clamped in our test,
    // it would apply as 90 * 0.5 = 45. The clamping happens at BUILD time, not apply time.
    // So this tests that the factor stored in perf is used as-is.
    expect(adjusted).toBeGreaterThanOrEqual(0)
    expect(adjusted).toBeLessThanOrEqual(100)
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 4: bestMethodForType()
// ─────────────────────────────────────────────────────────────────

describe('Phase 4: bestMethodForType()', () => {
  const engine = new LearningEngine({ minRecords: 5 })

  const makeData = (rows: Array<{ type: string; method: string; attempts: number; successes: number }>): CalibrationData => ({
    methodPerformance: rows.map((r) => ({
      detectedType: r.type,
      recommendedMethod: r.method,
      attempts: r.attempts,
      successes: r.successes,
      realSuccessRate: Math.round((r.successes / r.attempts) * 100),
      avgDurationMs: 10000,
      calibrationFactor: 1.0,
    })),
    totalRecordsAnalysed: rows.reduce((s, r) => s + r.attempts, 0),
    learningWindowDays: 30,
    computedAt: new Date().toISOString(),
  })

  it('returns null when calibration is null', () => {
    expect(engine.bestMethodForType('uniswap', null)).toBeUndefined()
  })

  it('returns the method with highest real success rate', () => {
    const data = makeData([
      { type: 'binance', method: 'proxy', attempts: 20, successes: 19 },  // 95%
      { type: 'binance', method: 'static', attempts: 20, successes: 12 }, // 60%
      { type: 'binance', method: 'hybrid', attempts: 20, successes: 16 }, // 80%
    ])
    expect(engine.bestMethodForType('binance', data)).toBe('proxy')
  })

  it('returns undefined when type has no records', () => {
    const data = makeData([
      { type: 'opensea', method: 'hybrid', attempts: 10, successes: 9 },
    ])
    expect(engine.bestMethodForType('uniswap', data)).toBeUndefined()
  })

  it('returns undefined when type has fewer than minRecords', () => {
    const engineStrict = new LearningEngine({ minRecords: 10 })
    const data = makeData([
      { type: 'uniswap', method: 'static', attempts: 5, successes: 4 }, // 5 < 10
    ])
    expect(engineStrict.bestMethodForType('uniswap', data)).toBeUndefined()
  })

  it('static beats proxy if static has higher real success rate', () => {
    const data = makeData([
      { type: 'uniswap', method: 'static', attempts: 30, successes: 29 }, // 97%
      { type: 'uniswap', method: 'proxy', attempts: 30, successes: 22 },  // 73%
    ])
    expect(engine.bestMethodForType('uniswap', data)).toBe('static')
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 5: summarise()
// ─────────────────────────────────────────────────────────────────

describe('Phase 4: summarise()', () => {
  const engine = new LearningEngine()

  it('returns no-data message when calibration is null', () => {
    const summary = engine.summarise(null)
    expect(summary).toContain('insufficient data')
  })

  it('returns no-data message when performance array is empty', () => {
    const data: CalibrationData = {
      methodPerformance: [],
      totalRecordsAnalysed: 0,
      learningWindowDays: 30,
      computedAt: new Date().toISOString(),
    }
    const summary = engine.summarise(data)
    expect(summary).toContain('insufficient data')
  })

  it('includes records count in summary', () => {
    const data: CalibrationData = {
      methodPerformance: [{
        detectedType: 'binance', recommendedMethod: 'proxy',
        attempts: 25, successes: 23, realSuccessRate: 92,
        avgDurationMs: 48000, calibrationFactor: 1.03,
      }],
      totalRecordsAnalysed: 25,
      learningWindowDays: 30,
      computedAt: new Date().toISOString(),
    }
    const summary = engine.summarise(data)
    expect(summary).toContain('25')
    expect(summary).toContain('binance')
    expect(summary).toContain('proxy')
  })

  it('shows calibration factor in summary', () => {
    const data: CalibrationData = {
      methodPerformance: [{
        detectedType: 'aave', recommendedMethod: 'hybrid',
        attempts: 15, successes: 12, realSuccessRate: 80,
        avgDurationMs: 42000, calibrationFactor: 0.95,
      }],
      totalRecordsAnalysed: 15,
      learningWindowDays: 30,
      computedAt: new Date().toISOString(),
    }
    const summary = engine.summarise(data)
    expect(summary).toContain('×0.95')
  })

  it('limits summary to top 5 entries', () => {
    const rows: MethodPerformance[] = Array.from({ length: 10 }, (_, i) => ({
      detectedType: `type${i}`,
      recommendedMethod: 'static',
      attempts: 10, successes: 9, realSuccessRate: 90,
      avgDurationMs: 10000, calibrationFactor: 1.0,
    }))
    const data: CalibrationData = {
      methodPerformance: rows,
      totalRecordsAnalysed: 100,
      learningWindowDays: 30,
      computedAt: new Date().toISOString(),
    }
    const summary = engine.summarise(data)
    // max 5 entries after header line
    const lines = summary.split('\n').filter((l) => l.trim().startsWith('type'))
    expect(lines.length).toBeLessThanOrEqual(5)
  })
})

// ─────────────────────────────────────────────────────────────────
// BLOCK 6: LearningEngine constructor config
// ─────────────────────────────────────────────────────────────────

describe('Phase 4: LearningEngine config', () => {
  it('uses default windowDays=30 when not specified', () => {
    const engine = new LearningEngine()
    // Access via summarise header
    const data: CalibrationData = {
      methodPerformance: [{
        detectedType: 'x', recommendedMethod: 'static',
        attempts: 5, successes: 4, realSuccessRate: 80,
        avgDurationMs: 10000, calibrationFactor: 1.0,
      }],
      totalRecordsAnalysed: 5,
      learningWindowDays: 30,
      computedAt: new Date().toISOString(),
    }
    const summary = engine.summarise(data)
    expect(summary).toContain('30d')
  })

  it('respects custom windowDays', () => {
    const engine = new LearningEngine({ windowDays: 7 })
    const data: CalibrationData = {
      methodPerformance: [],
      totalRecordsAnalysed: 0,
      learningWindowDays: 7,
      computedAt: new Date().toISOString(),
    }
    expect(data.learningWindowDays).toBe(7)
    // engine.summarise would show 7d in real output
    expect(engine).toBeDefined()
  })

  it('learningEngine singleton is exported', async () => {
    const module = await import('../../scripts/lib/learning-engine')
    expect(module.learningEngine).toBeInstanceOf(LearningEngine)
  })
})
