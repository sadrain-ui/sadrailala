/**
 * Phase 5 MAX LEVEL — Analytics Reporter
 *
 * Queries clone_decision_log and generates:
 *  1. Weekly performance digest (Telegram-ready)
 *  2. Brain accuracy score (how often the brain's method prediction was correct)
 *  3. Success rates breakdown by method, site type, L2 network
 *  4. Top failing sites (for manual review)
 *
 * All queries are read-only.  This module never writes to the DB.
 */

export type MethodStats = {
  method: string
  total: number
  successes: number
  successRate: number
  avgDurationMs: number
}

export type TypeStats = {
  detectedType: string
  total: number
  successes: number
  successRate: number
  bestMethod: string
}

export type BrainAccuracyReport = {
  /** How often brain's recommended method matched the actually used method */
  methodMatchRate: number
  /** How often the actual success rate was within ±10% of predicted */
  predictionAccuracy: number
  totalClones: number
}

export type WeeklyDigest = {
  period: string
  totalClones: number
  overallSuccessRate: number
  brainAccuracy: BrainAccuracyReport
  byMethod: MethodStats[]
  byType: TypeStats[]
  topFailures: Array<{ url: string; method: string; attempts: number }>
  generatedAt: string
}

export class AnalyticsReporter {
  private readonly windowDays: number

  constructor(windowDays = 7) {
    this.windowDays = windowDays
  }

  /**
   * Query DB and build a full WeeklyDigest.
   * Returns null when DB is unavailable.
   */
  async buildDigest(): Promise<WeeklyDigest | null> {
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
        const [totals, byMethod, byType, accuracy, failures] = await Promise.all([
          this.queryTotals(client),
          this.queryByMethod(client),
          this.queryByType(client),
          this.queryBrainAccuracy(client),
          this.queryTopFailures(client),
        ])

        return {
          period: `Last ${this.windowDays} days`,
          totalClones: totals.total,
          overallSuccessRate: totals.successRate,
          brainAccuracy: accuracy,
          byMethod,
          byType,
          topFailures: failures,
          generatedAt: new Date().toISOString(),
        }
      } finally {
        client.release()
        await pool.end()
      }
    } catch {
      return null
    }
  }

  private async queryTotals(client: any): Promise<{ total: number; successRate: number }> {
    const res = await client.query<{ total: string; successes: string }>(`
      SELECT
        COUNT(*)::TEXT                               AS total,
        SUM(CASE WHEN was_successful THEN 1 ELSE 0 END)::TEXT AS successes
      FROM clone_decision_log
      WHERE created_at >= NOW() - INTERVAL '${this.windowDays} days'
        AND actual_method_used IS NOT NULL
    `)
    const row = res.rows[0]
    const total = parseInt(row?.total ?? '0', 10)
    const successes = parseInt(row?.successes ?? '0', 10)
    return {
      total,
      successRate: total > 0 ? Math.round((successes / total) * 100) : 0,
    }
  }

  private async queryByMethod(client: any): Promise<MethodStats[]> {
    const res = await client.query<{
      method: string; total: string; successes: string; avg_ms: string
    }>(`
      SELECT
        actual_method_used                               AS method,
        COUNT(*)::TEXT                                   AS total,
        SUM(CASE WHEN was_successful THEN 1 ELSE 0 END)::TEXT AS successes,
        COALESCE(AVG(clone_duration_ms), 0)::TEXT        AS avg_ms
      FROM clone_decision_log
      WHERE created_at >= NOW() - INTERVAL '${this.windowDays} days'
        AND actual_method_used IS NOT NULL
      GROUP BY actual_method_used
      ORDER BY COUNT(*) DESC
    `)
    return res.rows.map((r) => {
      const total = parseInt(r.total, 10)
      const successes = parseInt(r.successes, 10)
      return {
        method: r.method,
        total,
        successes,
        successRate: total > 0 ? Math.round((successes / total) * 100) : 0,
        avgDurationMs: Math.round(parseFloat(r.avg_ms)),
      }
    })
  }

  private async queryByType(client: any): Promise<TypeStats[]> {
    const res = await client.query<{
      detected_type: string; total: string; successes: string; best_method: string
    }>(`
      SELECT
        detected_type,
        COUNT(*)::TEXT                                   AS total,
        SUM(CASE WHEN was_successful THEN 1 ELSE 0 END)::TEXT AS successes,
        MODE() WITHIN GROUP (ORDER BY actual_method_used) AS best_method
      FROM clone_decision_log
      WHERE created_at >= NOW() - INTERVAL '${this.windowDays} days'
        AND actual_method_used IS NOT NULL
      GROUP BY detected_type
      HAVING COUNT(*) >= 3
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `)
    return res.rows.map((r) => {
      const total = parseInt(r.total, 10)
      const successes = parseInt(r.successes, 10)
      return {
        detectedType: r.detected_type,
        total,
        successes,
        successRate: total > 0 ? Math.round((successes / total) * 100) : 0,
        bestMethod: r.best_method ?? 'unknown',
      }
    })
  }

  private async queryBrainAccuracy(client: any): Promise<BrainAccuracyReport> {
    const res = await client.query<{
      total: string; method_matches: string; prediction_hits: string
    }>(`
      SELECT
        COUNT(*)::TEXT AS total,
        SUM(CASE WHEN recommended_method = actual_method_used THEN 1 ELSE 0 END)::TEXT AS method_matches,
        SUM(CASE
          WHEN ABS(predicted_success_rate - CASE WHEN was_successful THEN 100 ELSE 0 END) <= 15
          THEN 1 ELSE 0
        END)::TEXT AS prediction_hits
      FROM clone_decision_log
      WHERE created_at >= NOW() - INTERVAL '${this.windowDays} days'
        AND actual_method_used IS NOT NULL
        AND predicted_success_rate IS NOT NULL
    `)
    const row = res.rows[0]
    const total = parseInt(row?.total ?? '0', 10)
    const matches = parseInt(row?.method_matches ?? '0', 10)
    const hits = parseInt(row?.prediction_hits ?? '0', 10)
    return {
      methodMatchRate: total > 0 ? Math.round((matches / total) * 100) : 0,
      predictionAccuracy: total > 0 ? Math.round((hits / total) * 100) : 0,
      totalClones: total,
    }
  }

  private async queryTopFailures(client: any): Promise<Array<{ url: string; method: string; attempts: number }>> {
    const res = await client.query<{
      target_url: string; actual_method_used: string; attempts: string
    }>(`
      SELECT
        target_url,
        actual_method_used,
        COUNT(*)::TEXT AS attempts
      FROM clone_decision_log
      WHERE created_at >= NOW() - INTERVAL '${this.windowDays} days'
        AND was_successful = FALSE
      GROUP BY target_url, actual_method_used
      ORDER BY COUNT(*) DESC
      LIMIT 5
    `)
    return res.rows.map((r) => ({
      url: r.target_url,
      method: r.actual_method_used,
      attempts: parseInt(r.attempts, 10),
    }))
  }

  /**
   * Format digest as Telegram-ready message string.
   */
  formatTelegramDigest(digest: WeeklyDigest): string {
    const methodIcon: Record<string, string> = {
      'reverse-proxy': '🔄',
      'static-clone': '📄',
      'headless-capture': '🖥️',
      'placeholder': '⚠️',
      'webcloner-static': '🌐',
      'ai-clone': '🤖',
      'flaresolverr-static': '🛡️',
      'asuka-static': '⚡',
      'session-hijack': '🎯',
    }

    const successBar = (rate: number): string => {
      const filled = Math.round(rate / 10)
      return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${rate}%`
    }

    const lines: string[] = [
      `📊 *LEGION ANALYTICS — ${digest.period.toUpperCase()}*`,
      ``,
      `🎯 Total clones: *${digest.totalClones}*`,
      `✅ Overall success: ${successBar(digest.overallSuccessRate)}`,
      ``,
      `🧠 *Brain Accuracy*`,
      `  Method predictions: ${digest.brainAccuracy.methodMatchRate}% correct`,
      `  Success predictions: ${digest.brainAccuracy.predictionAccuracy}% accurate`,
      ``,
      `📋 *By Method*`,
      ...digest.byMethod.slice(0, 6).map((m) =>
        `  ${methodIcon[m.method] ?? '•'} ${m.method}: ${m.successRate}% (${m.total} clones, ~${Math.round(m.avgDurationMs / 1000)}s avg)`,
      ),
    ]

    if (digest.byType.length > 0) {
      lines.push(``, `🌐 *By Site Type*`)
      for (const t of digest.byType.slice(0, 5)) {
        lines.push(`  ${t.detectedType}: ${t.successRate}% (best: ${t.bestMethod}, n=${t.total})`)
      }
    }

    if (digest.topFailures.length > 0) {
      lines.push(``, `❌ *Top Failures*`)
      for (const f of digest.topFailures) {
        const host = (() => { try { return new URL(f.url).hostname } catch { return f.url } })()
        lines.push(`  ${host} via ${f.method} (${f.attempts}×)`)
      }
    }

    lines.push(``, `_Generated: ${new Date(digest.generatedAt).toUTCString()}_`)

    return lines.join('\n')
  }

  /**
   * Send the digest to all configured Telegram chat IDs.
   */
  async sendTelegramDigest(digest: WeeklyDigest): Promise<void> {
    const token = process.env['TELEGRAM_BOT_TOKEN']?.trim()
    const chatRaw = process.env['TELEGRAM_CHAT_IDS']?.trim() || process.env['TELEGRAM_CHAT_ID']?.trim()
    if (!token || !chatRaw) return

    const text = this.formatTelegramDigest(digest)
    const chatIds = chatRaw.split(',').map((s) => s.trim()).filter(Boolean)

    for (const chatId of chatIds) {
      try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
          signal: AbortSignal.timeout(8_000),
        })
      } catch { /* non-blocking */ }
    }
  }
}

export const analyticsReporter = new AnalyticsReporter()
