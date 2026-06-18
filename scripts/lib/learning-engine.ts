/**
 * Phase 4 MAX LEVEL — Learning Engine
 *
 * Reads real clone outcomes from clone_decision_log and adjusts the brain's
 * confidence scores based on what actually worked vs what was predicted.
 *
 * How it works:
 *  1. Query clone_decision_log for recent completed clones (has actual_method_used)
 *  2. Build a MethodPerformance table: per (detectedType, recommendedMethod) →
 *     {attempts, successes, avgDuration, calibrationFactor}
 *  3. Return calibrated adjustments the brain can apply to its method confidence
 *
 * The engine is passive — it does NOT write to the brain or the DB.
 * It only reads and returns structured calibration data.
 * The brain (ClonePatternMatcher) accepts optional CalibrationData at query time.
 *
 * Learning formula:
 *   realSuccessRate = successes / attempts
 *   calibrationFactor = realSuccessRate / predictedSuccessRate
 *   adjustedConfidence = brainConfidence * clamp(calibrationFactor, 0.6, 1.4)
 */

export type MethodPerformance = {
  detectedType: string
  recommendedMethod: string
  attempts: number
  successes: number
  realSuccessRate: number
  avgDurationMs: number
  calibrationFactor: number
}

export type CalibrationData = {
  methodPerformance: MethodPerformance[]
  totalRecordsAnalysed: number
  learningWindowDays: number
  computedAt: string
}

export type LearningEngineConfig = {
  /** Number of days of history to use (default: 30) */
  windowDays?: number
  /** Minimum records before calibration is trusted (default: 5) */
  minRecords?: number
  /** Max calibration multiplier in either direction (default: 0.6–1.4) */
  calibrationClampMin?: number
  calibrationClampMax?: number
}

const DEFAULT_CONFIG: Required<LearningEngineConfig> = {
  windowDays: 30,
  minRecords: 5,
  calibrationClampMin: 0.6,
  calibrationClampMax: 1.4,
}

export class LearningEngine {
  private readonly config: Required<LearningEngineConfig>

  constructor(config: LearningEngineConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Load calibration data from clone_decision_log.
   * Returns null when DB is unavailable or table is empty.
   */
  async loadCalibration(): Promise<CalibrationData | null> {
    const connStr =
      process.env['DIRECT_URL'] ||
      process.env['DATABASE_URL'] ||
      process.env['POSTGRES_URL']

    if (!connStr) return null

    try {
      const { Pool } = await import('pg')
      const pool = new Pool({ connectionString: connStr, max: 1 })
      const client = await pool.connect()

      try {
        const rows = await client.query<{
          detected_type: string
          recommended_method: string
          attempts: string
          successes: string
          avg_duration_ms: string
          avg_predicted_success_rate: string
        }>(`
          SELECT
            detected_type,
            recommended_method,
            COUNT(*)::TEXT                              AS attempts,
            SUM(CASE WHEN was_successful THEN 1 ELSE 0 END)::TEXT AS successes,
            COALESCE(AVG(clone_duration_ms), 0)::TEXT   AS avg_duration_ms,
            COALESCE(AVG(predicted_success_rate), 85)::TEXT AS avg_predicted_success_rate
          FROM clone_decision_log
          WHERE
            actual_method_used IS NOT NULL
            AND created_at >= NOW() - INTERVAL '${this.config.windowDays} days'
          GROUP BY detected_type, recommended_method
          HAVING COUNT(*) >= ${this.config.minRecords}
          ORDER BY attempts DESC
        `)

        const performance: MethodPerformance[] = rows.rows.map((row) => {
          const attempts = parseInt(row.attempts, 10)
          const successes = parseInt(row.successes, 10)
          const realSuccessRate = attempts > 0 ? successes / attempts : 0
          const predictedSuccessRate = parseFloat(row.avg_predicted_success_rate) / 100
          const rawFactor = predictedSuccessRate > 0
            ? realSuccessRate / predictedSuccessRate
            : 1.0
          const calibrationFactor = Math.min(
            Math.max(rawFactor, this.config.calibrationClampMin),
            this.config.calibrationClampMax,
          )

          return {
            detectedType: row.detected_type,
            recommendedMethod: row.recommended_method,
            attempts,
            successes,
            realSuccessRate: Math.round(realSuccessRate * 100),
            avgDurationMs: Math.round(parseFloat(row.avg_duration_ms)),
            calibrationFactor: Math.round(calibrationFactor * 100) / 100,
          }
        })

        return {
          methodPerformance: performance,
          totalRecordsAnalysed: performance.reduce((s, r) => s + r.attempts, 0),
          learningWindowDays: this.config.windowDays,
          computedAt: new Date().toISOString(),
        }
      } finally {
        client.release()
        await pool.end()
      }
    } catch {
      return null
    }
  }

  /**
   * Apply calibration to a raw brain confidence score.
   *
   * @param rawConfidence  - brain's original method confidence (0-100)
   * @param detectedType   - site type detected by brain (e.g. 'uniswap', 'binance')
   * @param method         - method brain is recommending
   * @param calibration    - loaded from loadCalibration()
   */
  applyCalibration(
    rawConfidence: number,
    detectedType: string,
    method: string,
    calibration: CalibrationData | null,
  ): number {
    if (!calibration) return rawConfidence

    const match = calibration.methodPerformance.find(
      (p) =>
        p.detectedType === detectedType &&
        p.recommendedMethod === method,
    )

    if (!match) return rawConfidence

    const adjusted = rawConfidence * match.calibrationFactor
    return Math.round(Math.min(Math.max(adjusted, 0), 100))
  }

  /**
   * Find the historically best method for a given site type.
   * Returns undefined when insufficient data.
   */
  bestMethodForType(
    detectedType: string,
    calibration: CalibrationData | null,
  ): string | undefined {
    if (!calibration) return undefined

    const relevant = calibration.methodPerformance
      .filter((p) => p.detectedType === detectedType && p.attempts >= this.config.minRecords)
      .sort((a, b) => b.realSuccessRate - a.realSuccessRate)

    return relevant[0]?.recommendedMethod
  }

  /**
   * Generate a human-readable summary of what the learning engine found.
   * Used in Telegram digest (Phase 5).
   */
  summarise(calibration: CalibrationData | null): string {
    if (!calibration || calibration.methodPerformance.length === 0) {
      return 'Learning engine: insufficient data (need ≥5 clones per method/type pair)'
    }

    const top = calibration.methodPerformance
      .sort((a, b) => b.realSuccessRate - a.realSuccessRate)
      .slice(0, 5)

    const lines = [
      `Learning engine — ${calibration.totalRecordsAnalysed} clones analysed (last ${calibration.learningWindowDays}d):`,
      ...top.map(
        (p) =>
          `  ${p.detectedType}+${p.recommendedMethod}: ` +
          `${p.realSuccessRate}% real vs predicted (×${p.calibrationFactor} factor, n=${p.attempts})`,
      ),
    ]

    return lines.join('\n')
  }
}

export const learningEngine = new LearningEngine()
