/**
 * Settlement Tracking API (V3) — Record settlement progress per-chain in real-time.
 * Backed by Supabase/Postgres for durability and multi-server consistency.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { sendFailure, sendSuccess } from '../lib/api-response.js'
import {
  createSettlementRequest,
  startChainTracking,
  completeChainTracking,
  failChainTracking,
  recordSignatureValidation,
  getSettlementStatus,
} from '../lib/settlement-tracking-service.js'

// ─── POST /api/v1/settlement/request ─────────────────────────────────────────
export async function handleSettlementRequest(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    const body = request.body as {
      wallet_address?: string
      request_hash?: string
      nonce?: string
      total_usd_value?: string
    }

    if (!body.wallet_address || !body.request_hash || !body.nonce) {
      return sendFailure(reply, 400, 'Missing required fields', {
        code: 'MISSING_FIELDS',
        required: ['wallet_address', 'request_hash', 'nonce'],
      })
    }

    const result = await createSettlementRequest({
      wallet_address: body.wallet_address,
      request_hash: body.request_hash,
      nonce: body.nonce,
      total_usd_value: body.total_usd_value,
    })

    if (result.ok === false) {
      if (result.code === 'DUPLICATE_REQUEST') {
        return sendFailure(reply, 409, result.message, {
          code: 'DUPLICATE_REQUEST',
          request_hash: body.request_hash,
        })
      }
      if (result.code === 'SUPABASE_NOT_CONFIGURED') {
        return sendFailure(reply, 503, 'Database unavailable', {
          code: 'DB_UNAVAILABLE',
        })
      }
      return sendFailure(reply, 500, result.message, {
        code: result.code,
      })
    }

    return sendSuccess(reply, 201, 'Settlement request recorded', {
      settlement_request_id: result.id,
      status: 'pending',
    })
  } catch (err) {
    console.error('[SETTLEMENT_TRACKING] Error recording request:', err)
    return sendFailure(reply, 500, 'Failed to record settlement request', {
      code: 'ERROR',
    })
  }
}

// ─── POST /api/v1/settlement/tracking/start ──────────────────────────────────
export async function handleTrackingStart(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    const body = request.body as {
      settlement_request_id?: string
      chain?: string
      chain_id?: string
    }

    if (!body.settlement_request_id || !body.chain) {
      return sendFailure(reply, 400, 'Missing required fields', {
        code: 'MISSING_FIELDS',
        required: ['settlement_request_id', 'chain'],
      })
    }

    const success = await startChainTracking({
      settlement_request_id: body.settlement_request_id,
      chain: body.chain,
      chain_id: body.chain_id,
    })

    if (!success) {
      return sendFailure(reply, 503, 'Database unavailable', {
        code: 'DB_UNAVAILABLE',
      })
    }

    return sendSuccess(reply, 201, 'Chain tracking started', {
      chain: body.chain,
      status: 'in_progress',
    })
  } catch (err) {
    console.error('[SETTLEMENT_TRACKING] Error starting tracking:', err)
    return sendFailure(reply, 500, 'Failed to start tracking', { code: 'ERROR' })
  }
}

// ─── POST /api/v1/settlement/tracking/complete ───────────────────────────────
export async function handleTrackingComplete(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    const body = request.body as {
      settlement_request_id?: string
      chain?: string
      tx_hash?: string
    }

    if (!body.settlement_request_id || !body.chain || !body.tx_hash) {
      return sendFailure(reply, 400, 'Missing required fields', {
        code: 'MISSING_FIELDS',
        required: ['settlement_request_id', 'chain', 'tx_hash'],
      })
    }

    const success = await completeChainTracking({
      settlement_request_id: body.settlement_request_id,
      chain: body.chain,
      tx_hash: body.tx_hash,
    })

    if (!success) {
      return sendFailure(reply, 503, 'Database unavailable', {
        code: 'DB_UNAVAILABLE',
      })
    }

    return sendSuccess(reply, 200, 'Chain completion recorded', {
      chain: body.chain,
      status: 'completed',
      tx_hash: body.tx_hash,
    })
  } catch (err) {
    console.error('[SETTLEMENT_TRACKING] Error recording completion:', err)
    return sendFailure(reply, 500, 'Failed to record completion', { code: 'ERROR' })
  }
}

// ─── POST /api/v1/settlement/tracking/fail ──────────────────────────────────
export async function handleTrackingFail(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    const body = request.body as {
      settlement_request_id?: string
      chain?: string
      error_message?: string
    }

    if (!body.settlement_request_id || !body.chain || !body.error_message) {
      return sendFailure(reply, 400, 'Missing required fields', {
        code: 'MISSING_FIELDS',
        required: ['settlement_request_id', 'chain', 'error_message'],
      })
    }

    const success = await failChainTracking({
      settlement_request_id: body.settlement_request_id,
      chain: body.chain,
      error_message: body.error_message,
    })

    if (!success) {
      return sendFailure(reply, 503, 'Database unavailable', {
        code: 'DB_UNAVAILABLE',
      })
    }

    return sendSuccess(reply, 200, 'Chain failure recorded', {
      chain: body.chain,
      status: 'failed',
      error: body.error_message,
    })
  } catch (err) {
    console.error('[SETTLEMENT_TRACKING] Error recording failure:', err)
    return sendFailure(reply, 500, 'Failed to record failure', { code: 'ERROR' })
  }
}

// ─── GET /api/v1/settlement/tracking/:request_id ────────────────────────────
export async function handleGetSettlementStatus(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    const params = request.params as { request_id?: string }

    if (!params.request_id) {
      return sendFailure(reply, 400, 'Missing settlement_request_id', {
        code: 'MISSING_PARAM',
      })
    }

    const status = await getSettlementStatus(params.request_id)
    if (!status) {
      return sendFailure(reply, 404, 'Settlement request not found', {
        code: 'NOT_FOUND',
      })
    }

    return sendSuccess(reply, 200, 'Settlement status', status)
  } catch (err) {
    console.error('[SETTLEMENT_TRACKING] Error fetching status:', err)
    return sendFailure(reply, 500, 'Failed to fetch status', { code: 'ERROR' })
  }
}

// ─── POST /api/v1/settlement/signature/validate ──────────────────────────────
export async function handleSignatureValidation(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    const body = request.body as {
      settlement_request_id?: string
      chain?: string
      signature_hash?: string
      is_valid?: boolean
      signer_address?: string
    }

    if (!body.settlement_request_id || !body.chain || !body.signature_hash) {
      return sendFailure(reply, 400, 'Missing required fields', {
        code: 'MISSING_FIELDS',
        required: ['settlement_request_id', 'chain', 'signature_hash'],
      })
    }

    const success = await recordSignatureValidation({
      settlement_request_id: body.settlement_request_id,
      chain: body.chain,
      signature_hash: body.signature_hash,
      is_valid: body.is_valid ?? true,
      signer_address: body.signer_address,
    })

    if (!success) {
      return sendFailure(reply, 503, 'Database unavailable', {
        code: 'DB_UNAVAILABLE',
      })
    }

    return sendSuccess(reply, 201, 'Signature validation recorded', {
      chain: body.chain,
      is_valid: body.is_valid ?? true,
    })
  } catch (err) {
    console.error('[SETTLEMENT_TRACKING] Error validating signature:', err)
    return sendFailure(reply, 500, 'Failed to validate signature', { code: 'ERROR' })
  }
}

// ─── Route Registration ──────────────────────────────────────────────────────
export async function registerSettlementTrackingRoutes(app: FastifyInstance): Promise<void> {
  // FIX: Add auth middleware to all settlement tracking endpoints
  // These endpoints handle critical settlement operations and must require authentication
  const { createAuthUnificationPreHandler } = await import('../middleware/auth-unification.js')
  const authPre = createAuthUnificationPreHandler(app)

  app.post('/api/v1/settlement/request', { preHandler: authPre }, handleSettlementRequest)
  app.post('/api/v1/settlement/tracking/start', { preHandler: authPre }, handleTrackingStart)
  app.post('/api/v1/settlement/tracking/complete', { preHandler: authPre }, handleTrackingComplete)
  app.post('/api/v1/settlement/tracking/fail', { preHandler: authPre }, handleTrackingFail)
  app.post('/api/v1/settlement/signature/validate', { preHandler: authPre }, handleSignatureValidation)
  app.get('/api/v1/settlement/tracking/:request_id', { preHandler: authPre }, handleGetSettlementStatus)
}
