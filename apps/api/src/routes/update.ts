/**
 * Manual live-config update trigger — POST /api/update/now
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { sendFailure, sendSuccess } from '../lib/api-response.js'

export type LiveConfigUpdaterApi = {
  runNow: () => Promise<{
    ok: boolean
    version?: number
    updatedAt?: string
    counts?: Record<string, number>
    detail?: string
  }>
}

let updater: LiveConfigUpdaterApi | null = null

export function bindLiveConfigUpdater(handle: LiveConfigUpdaterApi): void {
  updater = handle
}

type UpdateAuthReason = 'ok' | 'key_not_configured' | 'key_missing_header' | 'key_mismatch'

function authorizeUpdate(request: FastifyRequest): UpdateAuthReason {
  const expected = process.env['UPDATE_API_KEY']?.trim()
  if (!expected) return 'key_not_configured'

  const hdr = request.headers['x-legion-update-key']
  const received =
    typeof hdr === 'string' ? hdr.trim() : Array.isArray(hdr) ? String(hdr[0] ?? '').trim() : ''

  if (!received) return 'key_missing_header'
  if (received !== expected) return 'key_mismatch'
  return 'ok'
}

export async function registerUpdateRoute(app: FastifyInstance): Promise<void> {
  app.post('/api/update/now', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = authorizeUpdate(request)
    if (auth !== 'ok') {
      if (auth === 'key_not_configured') {
        return sendSuccess(reply, 200, 'Live config update service ready', {
          enabled: false,
          reason: 'UPDATE_API_KEY not configured',
          status: 'awaiting_configuration'
        })
      }
      const code = auth === 'key_missing_header' ? 'UpdateKeyMissing' : 'UpdateKeyInvalid'
      return sendFailure(reply, 401, `Live config update unauthorized (${auth})`, { code })
    }

    if (!updater) {
      return sendSuccess(reply, 200, 'Live config update service initialized', {
        enabled: false,
        reason: 'Updater not yet bound',
        status: 'initializing'
      })
    }

    const result = await updater.runNow()
    if (!result.ok) {
      return sendFailure(reply, 502, result.detail ?? 'Live config update failed', {
        code: 'UpdateFailed',
      })
    }

    return sendSuccess(reply, 200, 'Live config updated', {
      version: result.version,
      updated_at: result.updatedAt,
      counts: result.counts,
    })
  })
}
