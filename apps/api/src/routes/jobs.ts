/**
 * Job Dispatcher — BullMQ extraction enqueue (Route Initialization).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { ensureExtractionWorkerInitialized, getExtractionQueue } from '../lib/extraction-queue.js'

export type ExtractionJobPayload = {
  wallet_address: string
  token_address?: string
  protocol?: string
  chain_id?: string
  scout_value_usd?: string
  /** Institutional job kind — default extraction strike */
  kind?: 'extraction' | 'liquidation_trigger'
}

export async function registerJobsRoutes(app: FastifyInstance): Promise<void> {
  ensureExtractionWorkerInitialized()
  app.post('/api/jobs/extraction', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as ExtractionJobPayload
    const wallet = typeof body.wallet_address === 'string' ? body.wallet_address.trim() : ''
    if (!wallet) {
      return reply.status(400).send({ error: 'wallet_address required' })
    }

    const kind = body.kind ?? 'extraction'
    const queue = getExtractionQueue()
    const job = await queue.add(
      kind,
      {
        wallet_address: wallet,
        token_address: body.token_address,
        protocol: body.protocol,
        chain_id: body.chain_id,
        scout_value_usd: body.scout_value_usd,
        enqueued_at: new Date().toISOString(),
      },
      { removeOnComplete: 500, removeOnFail: 500 },
    )

    return reply.send({
      ok: true,
      job_id: job.id,
      queue: 'extraction',
      handshake_active: true,
    })
  })
}
