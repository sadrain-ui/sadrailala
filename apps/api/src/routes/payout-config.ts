/**
 * Payout Config — Chaos Algorithm allocation surface (±15% institutional variance).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { sendFailure, sendSuccess } from '../lib/api-response.js'
import { parseQuery, payoutConfigQuerySchema } from '../lib/schemas.js'

function envBaseUsd(): number {
  const raw = process.env['PAYOUT_CONFIG_BASE_USD']?.trim()
  const n = raw ? Number(raw) : 1000
  return Number.isFinite(n) && n > 0 ? n : 1000
}

function ratioFromSeed(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const positive = h >>> 0
  return positive / 2 ** 32
}

function chaosAllocationUsd(seed: string): number {
  const base = envBaseUsd()
  const u = ratioFromSeed(seed)
  const variance = 0.85 + u * 0.3
  return Math.round(base * variance * 100) / 100
}

export async function registerPayoutConfigRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/payout-config', (request: FastifyRequest, reply: FastifyReply) => {
    const q = parseQuery(payoutConfigQuerySchema, request.query)
    if (q.ok === false) {
      return sendFailure(reply, 400, q.message, { code: 'ValidationError' })
    }

    const trace =
      typeof q.data.trace === 'string' && q.data.trace.trim() !== ''
        ? q.data.trace.trim()
        : `chaos:${Date.now()}`
    const allocation_usd = chaosAllocationUsd(trace)

    return sendSuccess(reply, 200, 'Payout config retrieved', {
      handshake_active: true,
      allocation_usd,
      chaos_algorithm: 'active',
      variance_band: '±15%',
    })
  })
}
