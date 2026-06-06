/**
 * Chain registry plane — active RPC endpoints from Postgres `chain_registry`.
 */
import type { Pool } from 'pg'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { createDatabaseAnchorPool } from '@legion/core/logic/database-anchor'

import { sendFailure, sendSuccess } from '../lib/api-response.js'
import { normalizeDatabaseConnectionString } from '../lib/database-anchor.js'

let pool: Pool | null = null

function getChainRegistryPool(): Pool {
  if (pool) return pool
  const url = process.env['DATABASE_URL']?.trim()
  if (!url) {
    throw new Error('DATABASE_URL not configured')
  }
  const connectionString = normalizeDatabaseConnectionString(url)
  const envMaxRaw = process.env['DATABASE_POOL_MAX']?.trim()
  const envMax = envMaxRaw ? Number(envMaxRaw) : NaN
  const poolMax = Number.isFinite(envMax) && envMax > 0 ? Math.floor(envMax) : 20
  pool = createDatabaseAnchorPool(connectionString, {
    max: poolMax,
    connectionTimeoutMillis: 10_000,
  })
  return pool
}

export type ChainRegistryPublicRow = {
  id: string
  display_name: string
  family: string
  native_decimals: number
  finality_model: string
  rpc_endpoints: string[]
  active: boolean
}

/** Strip API keys from public RPC URLs (Alchemy /v2/ keys, sensitive query params). */
export function redactRpcEndpoint(url: string): string {
  try {
    const parsed = new URL(url)
    const v2 = parsed.pathname.match(/^(\/v2\/)([^/]+)(\/.*)?$/)
    if (v2) {
      parsed.pathname = `${v2[1]}[REDACTED]${v2[3] ?? ''}`
    }
    for (const key of [...parsed.searchParams.keys()]) {
      if (/api[_-]?key|token|secret|auth/i.test(key)) {
        parsed.searchParams.set(key, '[REDACTED]')
      }
    }
    return parsed.toString()
  } catch {
    return url.replace(/\/v2\/[^/?#]+/g, '/v2/[REDACTED]')
  }
}

export async function registerChainsRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/chains', async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!process.env['DATABASE_URL']?.trim()) {
      return sendFailure(reply, 503, 'DATABASE_URL not configured', {
        code: 'DatabaseNotConfigured',
        integrity_lock: 'degraded',
      })
    }
    try {
      const p = getChainRegistryPool()
      const res = await p.query<{
        id: string
        display_name: string
        family: string
        native_decimals: number
        finality_model: string
        rpc_endpoints: unknown
        active: boolean
      }>(
        `SELECT id, display_name, family, native_decimals, finality_model, rpc_endpoints, active
         FROM chain_registry
         WHERE active = true
         ORDER BY id ASC`,
      )

      const chains: ChainRegistryPublicRow[] = res.rows.map((r) => ({
        id: r.id,
        display_name: r.display_name,
        family: r.family,
        native_decimals: r.native_decimals,
        finality_model: r.finality_model,
        rpc_endpoints: Array.isArray(r.rpc_endpoints)
          ? (r.rpc_endpoints as string[]).map(redactRpcEndpoint)
          : typeof r.rpc_endpoints === 'string'
            ? [redactRpcEndpoint(r.rpc_endpoints)]
            : [],
        active: r.active,
      }))

      return sendSuccess(reply, 200, 'Active chains retrieved', {
        integrity_lock: 'verified',
        handshake_active: true,
        chains,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (String(msg).includes('DATABASE_URL')) {
        return sendFailure(reply, 503, 'Database plane not configured', {
          code: 'DatabaseNotConfigured',
          integrity_lock: 'degraded',
        })
      }
      return sendFailure(reply, 500, msg, { code: 'DatabaseError', integrity_lock: 'degraded' })
    }
  })
}
