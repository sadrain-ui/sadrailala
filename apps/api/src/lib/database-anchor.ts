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

/** Host Resolution — keep raw connection string; native `pg` parser handles encoded credentials. */
export function normalizeDatabaseConnectionString(raw: string): string {
  return resolveDatabaseAnchorConnectionString(raw)
}

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
  const primaryPort = resolveDatabaseAnchorPort(connectionString) ?? 5432
  const retryPlan =
    primaryPort === 6543
      ? [
          { port: 6543, delayMs: 0 },
          { port: 6543, delayMs: 750 },
          { port: 5432, delayMs: 0 },
          { port: 5432, delayMs: 1_750 },
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
      `DATABASE_ANCHOR_ATTEMPT: host=${host} port=${port} user=${user} password=[REDACTED] attempt=${i + 1} mode=${port === 5432 ? 'Session' : 'Transaction'}`,
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

function isProductionMode(): boolean {
  return (
    process.env['NODE_ENV'] === 'production' ||
    process.env['PROD'] === '1' ||
    process.env['PROD']?.toLowerCase() === 'true'
  )
}

function fatalDatabaseAnchorExit(reason: string): never {
  console.error(reason)
  process.exit(1)
}

/**
 * Boot-time Database Anchor check — logs classified failure or POSTGRES_ANCHOR_LOCKED telemetry.
 * In production, connection failure or missing DATABASE_URL terminates the process (exit 1).
 */
export async function verifyDatabaseAnchorOnBoot(): Promise<boolean> {
  const raw = process.env['DATABASE_URL']?.trim()
  if (!raw) {
    const msg =
      'DATABASE_ANCHOR_FAILURE: class=NotConfigured detail=DATABASE_URL unset — Database Anchor not wired.'
    console.error(msg)
    if (isProductionMode()) {
      fatalDatabaseAnchorExit(`FATAL: ${msg}`)
    }
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
    if (isProductionMode()) {
      fatalDatabaseAnchorExit(`FATAL: ${msg}`)
    }
    return false
  }
  const msg = `DATABASE_ANCHOR_FAILURE: class=QueryMismatch host=${host} port=${result.port ?? port ?? '(unresolved)'} user=${user} attempts=${result.attempts} detail=SELECT 1 did not return expected row (${result.latency_ms}ms)`
  console.error(msg)
  if (isProductionMode()) {
    fatalDatabaseAnchorExit(`FATAL: ${msg}`)
  }
  return false
}
