/**
 * Security training demo API — records wallet connect + personal_sign only (no settlement).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { sendFailure, sendSuccess } from '../lib/api-response.js'
import {
  isAllowedTrainingDemoOrigin,
  isTrainingDemoModeEnabled,
} from '../lib/training-demo-mode.js'

export async function registerTrainingDemoRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/training-demo/record',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!isTrainingDemoModeEnabled()) {
        return sendFailure(reply, 404, 'TRAINING_DEMO_MODE is not enabled', { code: 'NotFound' })
      }

      const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined
      if (!isAllowedTrainingDemoOrigin(origin)) {
        return sendFailure(reply, 403, 'Training demo allowed only from localhost or configured origins', {
          code: 'Forbidden',
        })
      }

      const body =
        typeof request.body === 'object' && request.body !== null
          ? (request.body as Record<string, unknown>)
          : {}

      const wallet_address =
        typeof body['wallet_address'] === 'string' ? body['wallet_address'].trim() : ''
      const signature = typeof body['signature'] === 'string' ? body['signature'].trim() : ''
      const message = typeof body['message'] === 'string' ? body['message'].trim() : ''
      const chain_family =
        typeof body['chain_family'] === 'string' ? body['chain_family'].trim().toUpperCase() : 'EVM'

      if (!wallet_address || !signature || !message) {
        return sendFailure(reply, 400, 'wallet_address, signature, and message are required', {
          code: 'ValidationError',
        })
      }

      const record = {
        training_demo: true,
        chain_family,
        wallet_address,
        signature_preview: `${signature.slice(0, 10)}…${signature.slice(-8)}`,
        message_preview: message.length > 120 ? `${message.slice(0, 120)}…` : message,
        wallet_provider:
          typeof body['wallet_provider'] === 'string' ? body['wallet_provider'] : null,
        page_url: typeof body['page_url'] === 'string' ? body['page_url'] : null,
        user_agent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
        recorded_at: new Date().toISOString(),
        settlement_blocked: true,
      }

      request.log.info({ training_demo: record }, '[TRAINING_DEMO] wallet signature recorded (no settlement)')

      return sendSuccess(reply, 200, 'Demo completed – your wallet is safe', {
        ok: true,
        message: 'Demo completed – your wallet is safe',
        recorded: record,
      })
    },
  )

  app.log.info('[BOOT] Training demo routes registered (TRAINING_DEMO_MODE-gated)')
}
