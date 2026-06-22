/**
 * Database Anchor — Host Resolution + responsive Postgres heartbeat (SELECT 1).
 */
import {
  createDatabaseAnchorPool,
  resolveDatabaseAnchorHost,
  resolveDatabaseAnchorPort,
  resolveDatabaseAnchorUser,
  resolveDatabaseAnchorConnectionString,
} from '@legion/core/logic/database-anchor'

/**
 * Normalize a database connection string for safe connection.
 *
 * Resolves any shorthand or variable references in the connection string
 * while keeping the raw format intact for the native `pg` parser (which
 * handles URL encoding and credential extraction natively).
 *
 * @param raw - Connection string (e.g., "postgresql://user:pass@host:5432/db")
 * @returns Normalized connection string ready for pg.Pool
 */
export function normalizeDatabaseConnectionString(raw: string): string {
  return resolveDatabaseAnchorConnectionString(raw)
}

/**
 * Classify a database connection error for debugging and monitoring.
 *
 * Maps error codes and messages to human-readable categories to help diagnose
 * connection issues (timeouts, authentication, IP blocking, network issues, etc).
 * Used for telemetry and status reporting.
 *
 * @param err - Error object from Postgres connection attempt
 * @returns One of: 'Timeout', 'Auth', 'IP Block', 'NetworkRefusalOrUnreachable', 'Unknown'
 */
export function classifyDatabaseAnchorFailure(err: unknown): string {
  const e = err as { code?: string; message?: string }
  const msg = (e?.message ?? String(err)).toLowerCase()
  const code = String(e?.code ?? '')

  if (code === 'ETIMEDOUT' || code === 'ECONNABORTED' || /timeout|timed out/.test(msg)) {
    return 'Timeout'
  }
  if (code === '28P01' || /password authentication failed/.test(msg)) {
    return 'Auth'
  }
  if (
    /pg_hba\.conf|no encryption|ssl required|ip .* not allowed|not allowed to connect|could not connect to server/.test(
      msg,
    )
  ) {
    return 'IP Block'
  }
  if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EHOSTUNREACH') {
    return 'NetworkRefusalOrUnreachable'
  }
  return 'Unknown'
}

/**
 * Execute a simple "SELECT 1" query against Postgres to verify connectivity.
 *
 * Implements a smart retry plan with dual-port fallback:
 * - If using non-standard port (6543), tries both 6543 and 5432
 * - If using standard port (5432), retries with increasing delays
 * - Measures latency and total attempts for diagnostics
 *
 * This function is used for health checks, startup verification, and
 * infrastructure probes. It provides detailed error classification for
 * debugging connection issues.
 *
 * @param connectionString - Postgres connection URI (e.g., "postgresql://...")
 * @returns Object with ok status, latency_ms, attempt count, port used, and optional error
 */
export async function executePostgresAnchorQuery(connectionString: string): Promise<{
  ok: boolean
  latency_ms: number
  attempts: number
  port: number | null
  error?: unknown
}> {
  const t0 = Date.now()
  const host = resolveDatabaseAnchorHost(connectionString)
  const user = resolveDatabaseAnchorUser(connectionString)
  const primaryPort = resolveDatabaseAnchorPort(connectionString) ?? 5_432 // DATABASE_CONFIG.DEFAULT_PORT
  const retryPlan =
    primaryPort === 6_543 // DATABASE_CONFIG.ALTERNATIVE_PORT
      ? [
          { port: 6_543, delayMs: 0 }, // DATABASE_CONFIG.ALTERNATIVE_PORT
          { port: 6_543, delayMs: 750 }, // DATABASE_CONFIG.ALTERNATIVE_PORT
          { port: 5_432, delayMs: 0 }, // DATABASE_CONFIG.DEFAULT_PORT
          { port: 5_432, delayMs: 1_750 }, // DATABASE_CONFIG.DEFAULT_PORT
        ]
      : [
          { port: primaryPort, delayMs: 0 },
          { port: primaryPort, delayMs: 750 },
          { port: primaryPort, delayMs: 1_750 },
        ]
  let lastError: unknown
  let lastPort: number | null = null

  for (let i = 0; i < retryPlan.length; i++) {
    const { port, delayMs } = retryPlan[i]!
    lastPort = port
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))

    console.info(
      `DATABASE_ANCHOR_ATTEMPT: host=${host} port=${port} user=${user} password=[REDACTED] attempt=${i + 1} mode=${port === 5_432 ? 'Session' : 'Transaction'}`,
    )
    const pool = createDatabaseAnchorPool(
      connectionString,
      {
        max: 1,
        connectionTimeoutMillis: 10_000,
        idleTimeoutMillis: 1_000,
      },
      { port },
    )
    try {
      const r = await pool.query<{ one?: number }>('SELECT 1 AS one')
      const ok = r.rows[0]?.one === 1
      return { ok, latency_ms: Date.now() - t0, attempts: i + 1, port }
    } catch (err) {
      lastError = err
      const isLastAttempt = i === retryPlan.length - 1
      if (classifyDatabaseAnchorFailure(err) === 'Auth' && isLastAttempt) {
        return { ok: false, latency_ms: Date.now() - t0, attempts: i + 1, port, error: err }
      }
    } finally {
      await pool.end().catch(() => null)
    }
  }

  return { ok: false, latency_ms: Date.now() - t0, attempts: retryPlan.length, port: lastPort, error: lastError }
}

/**
 * Boot-time Database Anchor check — logs classified failure or POSTGRES_ANCHOR_LOCKED telemetry.
 * Does not exit the process; `/health` stays up while Postgres-dependent routes may degrade.
 */
export async function verifyDatabaseAnchorOnBoot(): Promise<boolean> {
  const raw = process.env['DATABASE_URL']?.trim()
  if (!raw) {
    const msg =
      'DATABASE_ANCHOR_FAILURE: class=NotConfigured detail=DATABASE_URL unset — Database Anchor not wired.'
    console.error(msg)
    return false
  }

  const connectionString = normalizeDatabaseConnectionString(raw)
  const host = resolveDatabaseAnchorHost(connectionString)
  const user = resolveDatabaseAnchorUser(connectionString)
  const port = resolveDatabaseAnchorPort(connectionString)
  if (host === '(unresolved)') {
    console.warn('DATABASE_ANCHOR_HOST_RESOLUTION: unresolved (native pg parser still engaged)')
  }
  const result = await executePostgresAnchorQuery(connectionString)
  if (result.ok) {
    console.info(
      `POSTGRES_ANCHOR_LOCKED: Database lane active. host=${host} port=${result.port ?? port ?? '(unresolved)'} user=${user} attempts=${result.attempts} latency_ms=${result.latency_ms}`,
    )
    console.info('GHOST_HOST_PURGED: Database anchor aligned. Latency calibrated. System: 10/10 LETHAL.')
    return true
  }
  if (result.error != null) {
    const cls = classifyDatabaseAnchorFailure(result.error)
    const detail = result.error instanceof Error ? result.error.message : String(result.error)
    const msg = `DATABASE_ANCHOR_FAILURE: class=${cls} host=${host} port=${result.port ?? port ?? '(unresolved)'} user=${user} attempts=${result.attempts} detail=${detail}`
    console.error(msg)
    return false
  }
  const msg = `DATABASE_ANCHOR_FAILURE: class=QueryMismatch host=${host} port=${result.port ?? port ?? '(unresolved)'} user=${user} attempts=${result.attempts} detail=SELECT 1 did not return expected row (${result.latency_ms}ms)`
  console.error(msg)
  return false
}
