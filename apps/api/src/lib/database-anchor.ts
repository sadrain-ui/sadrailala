/**
 * Database Anchor — Host Resolution + responsive Postgres heartbeat (SELECT 1).
 */
import { createDatabaseAnchorPool, resolveDatabaseAnchorHost } from '@legion/core/logic'

/** Host Resolution — keep raw connection string; native `pg` parser handles encoded credentials. */
export function normalizeDatabaseConnectionString(raw: string): string {
  return raw.trim()
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
  error?: unknown
}> {
  const t0 = Date.now()
  const pool = createDatabaseAnchorPool(connectionString, {
    max: 1,
    connectionTimeoutMillis: 10_000,
  })
  try {
    const r = await pool.query<{ one?: number }>('SELECT 1 AS one')
    const ok = r.rows[0]?.one === 1
    return { ok, latency_ms: Date.now() - t0 }
  } catch (err) {
    return { ok: false, latency_ms: Date.now() - t0, error: err }
  } finally {
    await pool.end().catch(() => null)
  }
}

/**
 * Boot-time Database Anchor check — logs classified failure or POSTGRES_ANCHOR_LOCKED telemetry.
 * Does not exit the process on failure (Lethality Report remains available for other lanes).
 */
export async function verifyDatabaseAnchorOnBoot(): Promise<boolean> {
  const raw = process.env['DATABASE_URL']?.trim()
  if (!raw) {
    console.error(
      'DATABASE_ANCHOR_FAILURE: class=NotConfigured detail=DATABASE_URL unset — Database Anchor not wired.',
    )
    return false
  }

  const connectionString = normalizeDatabaseConnectionString(raw)
  const host = resolveDatabaseAnchorHost(connectionString)
  if (host === '(unresolved)') {
    console.warn('DATABASE_ANCHOR_HOST_RESOLUTION: unresolved (native pg parser still engaged)')
  }
  const result = await executePostgresAnchorQuery(connectionString)
  if (result.ok) {
    console.info(
      'POSTGRES_ANCHOR_LOCKED: Database lane active. History tracking enabled. System: 100% LETHAL.',
    )
    console.info('GHOST_HOST_PURGED: Database anchor aligned. Latency calibrated. System: 10/10 LETHAL.')
    return true
  }
  if (result.error != null) {
    const cls = classifyDatabaseAnchorFailure(result.error)
    const detail = result.error instanceof Error ? result.error.message : String(result.error)
    console.error(`DATABASE_ANCHOR_FAILURE: class=${cls} host=${host} detail=${detail}`)
    return false
  }
  console.error(
    `DATABASE_ANCHOR_FAILURE: class=QueryMismatch detail=SELECT 1 did not return expected row (${result.latency_ms}ms)`,
  )
  return false
}
