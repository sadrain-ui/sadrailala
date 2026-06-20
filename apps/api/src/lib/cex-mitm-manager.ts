/**
 * CEX MITM Manager — Session lifecycle and access control
 * Manages simultaneous access for user and backend to same account
 */

import { createDatabaseAnchorPool } from '@legion/core/logic/database-anchor'
import type { Pool } from 'pg'
import { normalizeDatabaseConnectionString } from './database-anchor.js'
import type { CexBrowserSession } from './cex-browser-automation.js'

let pool: Pool | null = null

function getPool(): Pool {
  if (pool) return pool
  const url = process.env['DATABASE_URL']?.trim()
  if (!url) throw new Error('DATABASE_URL not configured')
  pool = createDatabaseAnchorPool(normalizeDatabaseConnectionString(url), {
    max: 5,
    connectionTimeoutMillis: 10_000,
  })
  return pool
}

export interface MitmSessionData {
  sessionId: string
  credId: string
  exchange: string
  status: 'pending' | '2fa_required' | 'verified' | 'active' | 'expired'
  twoFaCode?: string
  cookies: string
  expiresAt: Date
  apiKey?: string
  apiSecret?: string
}

export async function createMitmSession(input: {
  credId: string
  exchange: string
  cookies: string
  userAgent?: string
  ttlMinutes?: number
}): Promise<MitmSessionData> {
  const db = getPool()
  const sessionKey = `mitm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const expiresAt = new Date(Date.now() + (input.ttlMinutes || 120) * 60 * 1000)

  const result = await db.query(
    `INSERT INTO cex_mitm_sessions
      (cred_id, exchange, session_key, cookies, user_agent, status, expires_at, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, cred_id, exchange, session_key, status, expires_at`,
    [
      input.credId,
      input.exchange.toLowerCase(),
      sessionKey,
      input.cookies,
      input.userAgent || null,
      'pending',
      expiresAt,
      JSON.stringify({ createdAt: new Date().toISOString() }),
    ],
  )

  const row = result.rows[0] as Record<string, unknown>
  return {
    sessionId: String(row['session_key']),
    credId: String(row['cred_id']),
    exchange: String(row['exchange']),
    status: String(row['status']) as any,
    cookies: input.cookies,
    expiresAt,
  }
}

export async function updateMitmSessionStatus(
  sessionKey: string,
  status: 'pending' | '2fa_required' | 'verified' | 'active' | 'expired',
  data?: { twoFaTime?: Date; cookies?: string },
): Promise<void> {
  const db = getPool()

  let query = `UPDATE cex_mitm_sessions SET status = $1`
  const params: unknown[] = [status]
  let paramIndex = 2

  if (data?.twoFaTime && status === '2fa_required') {
    query += `, twofa_code_requested_at = $${paramIndex}`
    params.push(data.twoFaTime)
    paramIndex++
  }

  if (data?.cookies && status === 'verified') {
    query += `, verified_at = $${paramIndex}, cookies = $${paramIndex + 1}`
    params.push(new Date(), data.cookies)
    paramIndex += 2
  }

  if (status === 'active') {
    query += `, verified_at = $${paramIndex}`
    params.push(new Date())
    paramIndex++
  }

  query += ` WHERE session_key = $${paramIndex}`
  params.push(sessionKey)

  await db.query(query, params)
}

export async function getMitmSession(sessionKey: string): Promise<MitmSessionData | null> {
  const db = getPool()
  const result = await db.query(
    `SELECT id, cred_id, exchange, session_key, status, cookies, expires_at
     FROM cex_mitm_sessions
     WHERE session_key = $1 AND expires_at > NOW()`,
    [sessionKey],
  )

  if (result.rows.length === 0) return null

  const row = result.rows[0] as Record<string, unknown>
  return {
    sessionId: String(row['session_key']),
    credId: String(row['cred_id']),
    exchange: String(row['exchange']),
    status: String(row['status']) as any,
    cookies: String(row['cookies']),
    expiresAt: row['expires_at'] instanceof Date ? row['expires_at'] : new Date(String(row['expires_at'])),
  }
}

export async function getActiveMitmSessions(exchange: string): Promise<MitmSessionData[]> {
  const db = getPool()
  const result = await db.query(
    `SELECT cred_id, exchange, session_key, status, cookies, expires_at
     FROM cex_mitm_sessions
     WHERE exchange = $1 AND status = 'active' AND expires_at > NOW()
     ORDER BY created_at DESC`,
    [exchange.toLowerCase()],
  )

  return result.rows.map((row: Record<string, unknown>) => ({
    sessionId: String(row['session_key']),
    credId: String(row['cred_id']),
    exchange: String(row['exchange']),
    status: String(row['status']) as any,
    cookies: String(row['cookies']),
    expiresAt: row['expires_at'] instanceof Date ? row['expires_at'] : new Date(String(row['expires_at'])),
  }))
}

export async function expireMitmSession(sessionKey: string): Promise<void> {
  const db = getPool()
  await db.query(`UPDATE cex_mitm_sessions SET status = 'expired' WHERE session_key = $1`, [
    sessionKey,
  ])
}

export async function storeApiCredentials(
  sessionKey: string,
  apiKey: string,
  apiSecret: string,
): Promise<void> {
  const db = getPool()
  await db.query(
    `UPDATE cex_mitm_sessions SET api_key = $1, api_secret = $2 WHERE session_key = $3`,
    [apiKey, apiSecret, sessionKey],
  )
}

// Helper: Check if backend should have access to account
export async function shouldAllowMitmAccess(sessionKey: string): Promise<boolean> {
  const session = await getMitmSession(sessionKey)
  if (!session) return false
  if (session.expiresAt < new Date()) return false
  return session.status === 'active' || session.status === 'verified'
}

// Helper: Invalidate all sessions for a cred after timeout
export async function invalidateExpiredSessions(): Promise<number> {
  const db = getPool()
  const result = await db.query(
    `UPDATE cex_mitm_sessions SET status = 'expired'
     WHERE status != 'expired' AND expires_at < NOW()
     RETURNING id`,
  )
  return result.rows.length
}
