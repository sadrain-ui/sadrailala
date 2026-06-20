/**
 * Jobs Status API - Query extraction job status and history
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

export async function registerJobsStatusRoutes(app: FastifyInstance): Promise<void> {
  const authPre = createAuthUnificationPreHandler(app)

  // GET /api/v1/jobs/list - List recent extraction jobs
  app.get('/api/v1/jobs/list', { preHandler: authPre }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const db = getPool()
      const result = await db.query(
        `SELECT id, wallet_address, protocol, chain_id, scout_value_usd, status, created_at, completed_at
         FROM extraction_jobs
         ORDER BY created_at DESC
         LIMIT 50`,
      )

      return sendSuccess(reply, 200, 'Recent extraction jobs', {
        count: result.rows.length,
        jobs: result.rows,
      })
    } catch (e) {
      return sendFailure(reply, 500, e instanceof Error ? e.message : 'Failed to fetch jobs', {
        code: 'DatabaseError',
      })
    }
  })

  // GET /api/v1/jobs/status/:id - Get specific job status
  app.get('/api/v1/jobs/status/:id', { preHandler: authPre }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id?: string }
      if (!id) {
        return sendFailure(reply, 400, 'Job ID required', { code: 'ValidationError' })
      }

      const db = getPool()
      const result = await db.query(
        `SELECT id, wallet_address, protocol, chain_id, scout_value_usd, status, progress, error_message, created_at, started_at, completed_at
         FROM extraction_jobs
         WHERE id = $1`,
        [id],
      )

      if (result.rows.length === 0) {
        return sendFailure(reply, 404, 'Job not found', { code: 'NotFound' })
      }

      return sendSuccess(reply, 200, 'Job status retrieved', result.rows[0])
    } catch (e) {
      return sendFailure(reply, 500, e instanceof Error ? e.message : 'Failed to fetch job status', {
        code: 'DatabaseError',
      })
    }
  })

  // GET /api/v1/jobs/wallet/:address - Jobs for specific wallet
  app.get('/api/v1/jobs/wallet/:address', { preHandler: authPre }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { address } = request.params as { address?: string }
      if (!address) {
        return sendFailure(reply, 400, 'Wallet address required', { code: 'ValidationError' })
      }

      const db = getPool()
      const result = await db.query(
        `SELECT id, wallet_address, protocol, chain_id, scout_value_usd, status, created_at, completed_at
         FROM extraction_jobs
         WHERE wallet_address = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [address],
      )

      return sendSuccess(reply, 200, 'Wallet jobs retrieved', {
        wallet: address,
        count: result.rows.length,
        jobs: result.rows,
      })
    } catch (e) {
      return sendFailure(reply, 500, e instanceof Error ? e.message : 'Failed to fetch wallet jobs', {
        code: 'DatabaseError',
      })
    }
  })

  app.log.info('[BOOT] Jobs status routes registered (/api/v1/jobs/*)')
}
