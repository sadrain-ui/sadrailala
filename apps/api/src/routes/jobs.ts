/**
 * Job Dispatcher — BullMQ extraction enqueue.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { sendFailure, sendSuccess } from '../lib/api-response.js'
import { parseBody, extractionJobBodySchema } from '../lib/schemas.js'
import {
  ensureExtractionWorkerInitialized,
  enqueueExtractionJob,
} from '../lib/extraction-queue.js'
import { ensurePrivacyMixingWorkerInitialized } from '../lib/privacy-mixing-queue.js'
import { ensureAllowanceReuseWorkerInitialized } from '../lib/allowance-reuse-queue.js'
import { ensureSweepWorkerInitialized } from '../lib/sweep-queue.js'
import { createAuthUnificationPreHandler } from '../middleware/auth-unification.js'

export type ExtractionJobPayload = {
  wallet_address: string
  token_address?: string
  protocol?: string
  chain_id?: string
  scout_value_usd?: string
  kind?: 'extraction' | 'liquidation_trigger'
}

export async function registerJobsRoutes(app: FastifyInstance): Promise<void> {
  void ensureExtractionWorkerInitialized()
  void ensurePrivacyMixingWorkerInitialized()
  void ensureAllowanceReuseWorkerInitialized()
  void ensureSweepWorkerInitialized()
  const authPre = createAuthUnificationPreHandler(app)

  app.post('/api/jobs/extraction', { preHandler: authPre }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(extractionJobBodySchema, request.body)
    if (body.ok === false) {
      return sendFailure(reply, 400, body.message, { code: 'ValidationError' })
    }

    const wallet = body.data.wallet_address.trim()
    const kind = body.data.kind ?? 'extraction'
    const result = await enqueueExtractionJob(
      kind,
      {
        wallet_address: wallet,
        token_address: body.data.token_address,
        protocol: body.data.protocol,
        chain_id: body.data.chain_id,
        scout_value_usd:
          body.data.scout_value_usd != null ? String(body.data.scout_value_usd) : undefined,
        enqueued_at: new Date().toISOString(),
      },
      { removeOnComplete: 500, removeOnFail: 500 },
    )

    return sendSuccess(reply, 200, result.mode === 'memory' ? 'Extraction job enqueued (memory fallback)' : 'Extraction job enqueued', {
      job_id: result.job_id,
      queue: result.mode === 'redis' ? 'extraction' : 'memory-fallback',
      handshake_active: result.mode === 'redis',
      ...(result.mode === 'memory' ? { warning: result.warning } : {}),
    })
  })
}
