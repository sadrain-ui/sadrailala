/**
 * Heartbeat Trigger — `/health?ping=true` POSTs to `TELEMETRY_WEBHOOK_URL` for Sovereign Audit.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { sendFailure, sendSuccess } from '../lib/api-response.js'
import { healthQuerySchema, parseQuery } from '../lib/schemas.js'
import { sendHeartbeatTrigger } from '../telemetry-sender.js'

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const q = parseQuery(healthQuerySchema, request.query)
    if (q.ok === false) {
      return sendFailure(reply, 400, q.message, { code: 'ValidationError' })
    }

    if (q.data.ping === 'true') {
      await sendHeartbeatTrigger()
    }

    return sendSuccess(reply, 200, 'Service healthy', {
      status: 'ok',
      service: 'legion-engine-api',
      timestamp: new Date().toISOString(),
      ...(q.data.ping === 'true' ? { heartbeat_trigger: true as const } : {}),
    })
  })
}
