/**
 * Internal Kinetic Link routes — Edge-safe callers trigger Node AssetScanner via HTTP.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { sendFailure, sendSuccess } from '../lib/api-response.js'
import { kineticDeepScanBodySchema, parseBody } from '../lib/schemas.js'
import { queueKineticDeepAssetScan } from '../lib/kinetic-deep-scan.js'

type KineticAuthReason = 'ok' | 'key_not_configured' | 'key_missing_header' | 'key_mismatch'

type KineticAuthResult = { ok: true; reason: 'ok' } | { ok: false; reason: Exclude<KineticAuthReason, 'ok'> }

function authorizeInternal(request: FastifyRequest): KineticAuthResult {
  const expected = process.env['KINETIC_INTERNAL_KEY']?.trim()
  if (!expected) {
    return { ok: false, reason: 'key_not_configured' }
  }

  const hdr = request.headers['x-legion-kinetic-key']
  const received =
    typeof hdr === 'string' ? hdr.trim() : Array.isArray(hdr) ? String(hdr[0] ?? '').trim() : ''

  if (!received) {
    return { ok: false, reason: 'key_missing_header' }
  }
  if (received !== expected) {
    return { ok: false, reason: 'key_mismatch' }
  }
  return { ok: true, reason: 'ok' }
}

function kineticAuthFailureMessage(reason: Exclude<KineticAuthReason, 'ok'>): string {
  switch (reason) {
    case 'key_not_configured':
      return 'KINETIC_INTERNAL_KEY is not configured on the server'
    case 'key_missing_header':
      return 'Missing x-legion-kinetic-key header'
    case 'key_mismatch':
      return 'Invalid x-legion-kinetic-key'
    default:
      return 'Kinetic internal authorization required'
  }
}

export async function registerKineticInternalRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/internal/kinetic-deep-scan', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(kineticDeepScanBodySchema, request.body)
    if (body.ok === false) {
      return sendFailure(reply, 400, body.message, { code: 'ValidationError' })
    }

    const auth = authorizeInternal(request)
    if (auth.ok === false) {
      request.log.warn(
        {
          reason: auth.reason,
          wallet_address: body.data.wallet_address.trim(),
          ip: request.ip,
        },
        'kinetic_internal_unauthorized',
      )
      return sendFailure(reply, 401, kineticAuthFailureMessage(auth.reason), {
        code: 'Unauthorized',
        reason: auth.reason,
      })
    }

    queueKineticDeepAssetScan(body.data.wallet_address.trim())
    return sendSuccess(reply, 200, 'Kinetic deep scan queued', { kinetic_link: true })
  })
}
