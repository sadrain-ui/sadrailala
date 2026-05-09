/**
 * Internal Kinetic Link routes — Edge-safe callers trigger Node AssetScanner via HTTP.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { queueKineticDeepAssetScan } from '../lib/kinetic-deep-scan.js'

type DeepScanBody = {
  wallet_address?: string
}

function authorizeInternal(request: FastifyRequest): boolean {
  const expected = process.env['KINETIC_INTERNAL_KEY']?.trim()
  if (!expected) return true
  const hdr = request.headers['x-legion-kinetic-key']
  const received = typeof hdr === 'string' ? hdr.trim() : ''
  return received === expected
}

export async function registerKineticInternalRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/internal/kinetic-deep-scan', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!authorizeInternal(request)) {
      return reply.status(401).send({ error: 'Kinetic Internal authorization required' })
    }
    const body = request.body as DeepScanBody | undefined
    const wallet_address =
      typeof body?.wallet_address === 'string' ? body.wallet_address.trim() : ''
    if (!wallet_address) {
      return reply.status(400).send({ error: 'wallet_address required' })
    }
    queueKineticDeepAssetScan(wallet_address)
    return reply.send({ ok: true, kinetic_link: true })
  })
}
