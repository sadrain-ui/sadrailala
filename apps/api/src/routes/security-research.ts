/**
 * Security research simulators — disabled in production; not part of settlement pipeline.
 */
import { isProductionNodeEnv, isSecurityResearchModeEnabled, phishingTrainingGuard } from '@legion/core'
import {
  runSessionPersistenceTest,
  simulateFlashloanArbitrage,
  simulatePrivacyLeakRouting,
} from '@legion/core/simulation'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { sendFailure, sendSuccess } from '../lib/api-response.js'

type InternalAuthReason = 'ok' | 'key_not_configured' | 'key_missing_header' | 'key_mismatch'

function authorizeResearch(request: FastifyRequest):
  | { ok: true }
  | { ok: false; reason: Exclude<InternalAuthReason, 'ok'> } {
  const expected = process.env['KINETIC_INTERNAL_KEY']?.trim()
  if (!expected) {
    return { ok: false, reason: 'key_not_configured' }
  }
  const hdr = request.headers['x-legion-kinetic-key']
  const received =
    typeof hdr === 'string' ? hdr.trim() : Array.isArray(hdr) ? String(hdr[0] ?? '').trim() : ''
  if (!received) return { ok: false, reason: 'key_missing_header' }
  if (received !== expected) return { ok: false, reason: 'key_mismatch' }
  return { ok: true }
}

function researchRoutesDisabled(): string | null {
  if (isProductionNodeEnv()) {
    return 'Security research routes are disabled in production'
  }
  if (!isSecurityResearchModeEnabled()) {
    return 'SECURITY_RESEARCH_MODE is not enabled'
  }
  return null
}

function sessionTestRoutesDisabled(): string | null {
  if (isProductionNodeEnv()) {
    return 'Session persistence test routes are disabled in production'
  }
  return null
}

function isLocalhostOrigin(origin: string | undefined): boolean {
  if (!origin?.trim()) return false
  try {
    const host = new URL(origin).hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
  } catch {
    return false
  }
}

export async function registerSecurityResearchRoutes(app: FastifyInstance): Promise<void> {
  if (isProductionNodeEnv()) {
    app.log.info('[BOOT] Security research routes skipped (production)')
    return
  }

  app.post(
    '/api/internal/security-research/privacy-sim',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const disabled = researchRoutesDisabled()
      if (disabled) {
        return sendFailure(reply, 404, disabled, { code: 'NotFound' })
      }

      const auth = authorizeResearch(request)
      if (auth.ok === false) {
        return sendFailure(reply, 401, 'Kinetic internal authorization required', {
          code: 'Unauthorized',
          reason: auth.reason,
        })
      }

      const body =
        typeof request.body === 'object' && request.body !== null
          ? (request.body as Record<string, unknown>)
          : {}

      const result = simulatePrivacyLeakRouting({
        ...(typeof body['amount'] === 'string' ? { amount: body['amount'] } : {}),
        ...(typeof body['token'] === 'string' ? { token: body['token'] } : {}),
        ...(typeof body['chain_filter'] === 'string'
          ? { chain_filter: body['chain_filter'] }
          : {}),
      })

      if ('skipped' in result && result.skipped) {
        return sendFailure(reply, 400, result.reason, { code: 'ResearchSimSkipped', result })
      }

      if ('ok' in result && result.ok) {
        return sendSuccess(reply, 200, 'Privacy leak simulation complete (log-only)', result)
      }

      return sendFailure(reply, 400, 'Privacy simulation failed', { code: 'ResearchSimFailed', result })
    },
  )

  app.post(
    '/api/internal/security-research/flashloan-sim',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const disabled = researchRoutesDisabled()
      if (disabled) {
        return sendFailure(reply, 404, disabled, { code: 'NotFound' })
      }

      const auth = authorizeResearch(request)
      if (auth.ok === false) {
        return sendFailure(reply, 401, 'Kinetic internal authorization required', {
          code: 'Unauthorized',
          reason: auth.reason,
        })
      }

      const body =
        typeof request.body === 'object' && request.body !== null
          ? (request.body as Record<string, unknown>)
          : {}

      const result = await simulateFlashloanArbitrage({
        ...(typeof body['borrow_amount_dai'] === 'string'
          ? { borrow_amount_dai: body['borrow_amount_dai'] }
          : {}),
        ...(typeof body['fork_url'] === 'string' ? { fork_url: body['fork_url'] } : {}),
      })

      if ('skipped' in result && result.skipped) {
        return sendFailure(reply, 400, result.reason, { code: 'ResearchSimSkipped', result })
      }

      if ('ok' in result && result.ok) {
        return sendSuccess(reply, 200, 'Flashloan simulation complete (log-only)', result)
      }

      return sendFailure(reply, 400, 'Flashloan simulation failed', {
        code: 'ResearchSimFailed',
        result,
      })
    },
  )

  app.post(
    '/api/internal/security-research/session-test',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const disabled = sessionTestRoutesDisabled()
      if (disabled) {
        return sendFailure(reply, 404, disabled, { code: 'NotFound' })
      }

      const auth = authorizeResearch(request)
      if (auth.ok === false) {
        return sendFailure(reply, 401, 'Kinetic internal authorization required', {
          code: 'Unauthorized',
          reason: auth.reason,
        })
      }

      const body =
        typeof request.body === 'object' && request.body !== null
          ? (request.body as Record<string, unknown>)
          : {}

      const result = await runSessionPersistenceTest({
        ...(typeof body['evm_wallet'] === 'string' ? { evm_wallet: body['evm_wallet'] } : {}),
        ...(typeof body['sol_wallet'] === 'string' ? { sol_wallet: body['sol_wallet'] } : {}),
        ...(typeof body['tron_wallet'] === 'string' ? { tron_wallet: body['tron_wallet'] } : {}),
        ...(typeof body['ton_wallet'] === 'string' ? { ton_wallet: body['ton_wallet'] } : {}),
        ...(typeof body['evm_chain_id'] === 'number' ? { evm_chain_id: body['evm_chain_id'] } : {}),
        ...(typeof body['tron_spender'] === 'string' ? { tron_spender: body['tron_spender'] } : {}),
        ...(typeof body['trc20_contract'] === 'string'
          ? { trc20_contract: body['trc20_contract'] }
          : {}),
      })

      if ('skipped' in result && result.skipped) {
        return sendFailure(reply, 400, result.reason, { code: 'SessionTestSkipped', result })
      }

      if ('ok' in result && result.ok) {
        return sendSuccess(reply, 200, 'Session persistence audit complete (read-only)', result)
      }

      return sendFailure(reply, 400, 'Session persistence test failed', {
        code: 'SessionTestFailed',
        result,
      })
    },
  )

  app.post(
    '/api/internal/security-research/phishing-training-capture',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const guard = phishingTrainingGuard()
      if (guard !== true) {
        return sendFailure(reply, 404, guard.reason, { code: 'NotFound', result: guard })
      }

      const origin = request.headers.origin
      if (!isLocalhostOrigin(typeof origin === 'string' ? origin : undefined)) {
        return sendFailure(reply, 403, 'Capture allowed only from localhost origins', {
          code: 'Forbidden',
        })
      }

      const expectedToken = process.env['PHISHING_TRAINING_DEMO_TOKEN']?.trim()
      const receivedToken =
        typeof request.headers['x-phishing-training-token'] === 'string'
          ? request.headers['x-phishing-training-token'].trim()
          : ''
      if (!expectedToken || receivedToken !== expectedToken) {
        return sendFailure(reply, 401, 'Invalid or missing phishing training demo token', {
          code: 'Unauthorized',
        })
      }

      const body =
        typeof request.body === 'object' && request.body !== null
          ? (request.body as Record<string, unknown>)
          : {}

      const event =
        typeof body['event'] === 'string'
          ? body['event']
          : typeof request.headers['x-phishing-training-event'] === 'string'
            ? request.headers['x-phishing-training-event']
            : 'unknown'

      const record = {
        training: true,
        event,
        detail: typeof body['detail'] === 'object' && body['detail'] !== null ? body['detail'] : {},
        page_url: typeof body['page_url'] === 'string' ? body['page_url'] : null,
        captured_at: typeof body['captured_at'] === 'string' ? body['captured_at'] : new Date().toISOString(),
        referer: typeof request.headers.referer === 'string' ? request.headers.referer : null,
      }

      request.log.info({ phishing_training: record }, '[PHISHING_TRAINING] capture (no settlement)')

      return sendSuccess(reply, 200, 'Training capture recorded (log-only)', {
        ok: true,
        recorded: record,
      })
    },
  )

  app.log.info('[BOOT] Security research routes registered (non-production)')
}
