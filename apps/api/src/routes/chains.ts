/**
 * Chain registry plane — active RPC endpoints and finality models from Postgres `chain_registry`.
 */
import { Pool } from 'pg'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

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
  pool = new Pool({ connectionString, max: poolMax, connectionTimeoutMillis: 10_000 })
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

export async function registerChainsRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/chains', async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!process.env['DATABASE_URL']?.trim()) {
      return reply.status(503).send({
        error: 'DATABASE_URL not configured',
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
          ? (r.rpc_endpoints as string[])
          : typeof r.rpc_endpoints === 'string'
            ? [r.rpc_endpoints]
            : [],
        active: r.active,
      }))

      return reply.send({
        integrity_lock: 'verified',
        handshake_active: true,
        chains,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (String(msg).includes('DATABASE_URL')) {
        return reply.status(503).send({ error: 'Database plane not configured', integrity_lock: 'degraded' })
      }
      return reply.status(500).send({ error: msg, integrity_lock: 'degraded' })
    }
  })
}
