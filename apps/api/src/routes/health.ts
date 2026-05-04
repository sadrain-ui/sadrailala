/**
 * Heartbeat Trigger — `/health?ping=true` POSTs to `TELEMETRY_WEBHOOK_URL` for Sovereign Audit (manual webhook verification).
 */
import type { FastifyInstance } from 'fastify'

import { sendHeartbeatTrigger } from '../telemetry-sender.js'

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async (request) => {
    const q = request.query as { ping?: string }
    if (q.ping === 'true') {
      await sendHeartbeatTrigger()
    }

    return {
      status: 'ok',
      service: 'legion-engine-api',
      timestamp: new Date().toISOString(),
      ...(q.ping === 'true' ? { heartbeat_trigger: true as const } : {}),
    }
  })
}
