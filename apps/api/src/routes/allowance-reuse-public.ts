/**
 * Allowance Reuse Public API - Frontend-accessible allowance scanning
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  scanReusableAllowances,
  isAllowanceReuseEnabled,
  type AllowanceReuseScanParams,
} from '@legion/core'
import { isAddress, getAddress } from 'viem'
import type { Address } from 'viem'

import { sendFailure, sendSuccess } from '../lib/api-response.js'
import { createAuthUnificationPreHandler } from '../middleware/auth-unification.js'

function parseScanBody(body: Record<string, unknown>): AllowanceReuseScanParams | null {
  const wallet = typeof body['wallet_address'] === 'string' ? body['wallet_address'].trim() : ''
  if (!wallet) return null

  const evm_tokens_raw = body['evm_tokens']
  let evm_tokens: Address[] | undefined
  if (Array.isArray(evm_tokens_raw)) {
    evm_tokens = evm_tokens_raw
      .filter((t): t is string => typeof t === 'string' && isAddress(t))
      .map((t) => getAddress(t))
  }

  return {
    wallet_address: wallet,
    ...(typeof body['evm_chain_id'] === 'number' ? { evm_chain_id: body['evm_chain_id'] } : {}),
    ...(evm_tokens?.length ? { evm_tokens } : {}),
    ...(typeof body['sol_wallet'] === 'string' ? { sol_wallet: body['sol_wallet'] } : {}),
    ...(typeof body['tron_wallet'] === 'string' ? { tron_wallet: body['tron_wallet'] } : {}),
    ...(typeof body['ton_wallet'] === 'string' ? { ton_wallet: body['ton_wallet'] } : {}),
    ...(typeof body['trc20_contract'] === 'string' ? { trc20_contract: body['trc20_contract'] } : {}),
    ...(typeof body['tron_spender'] === 'string' ? { tron_spender: body['tron_spender'] } : {}),
  }
}

export async function registerAllowanceReusePublicRoutes(app: FastifyInstance): Promise<void> {
  const authPre = createAuthUnificationPreHandler(app)

  // POST /api/v1/allowance-reuse/scan - Scan for reusable allowances
  app.post(
    '/api/v1/allowance-reuse/scan',
    { preHandler: authPre },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!isAllowanceReuseEnabled()) {
        return sendFailure(reply, 503, 'Allowance reuse is not enabled', { code: 'ServiceUnavailable' })
      }

      const body =
        typeof request.body === 'object' && request.body !== null
          ? (request.body as Record<string, unknown>)
          : {}
      const scan = parseScanBody(body)
      if (!scan) {
        return sendFailure(reply, 400, 'wallet_address is required', { code: 'ValidationError' })
      }

      try {
        const result = await scanReusableAllowances(scan)
        if (!('ok' in result) || !result.ok) {
          return sendFailure(reply, 400, 'reason' in result ? result.reason : 'scan failed', {
            code: 'AllowanceReuseScanFailed',
            result,
          })
        }

        return sendSuccess(reply, 200, 'Allowance reuse scan complete', result)
      } catch (e) {
        return sendFailure(reply, 500, e instanceof Error ? e.message : 'Scan failed', {
          code: 'ScanError',
        })
      }
    },
  )

  app.log.info('[BOOT] Allowance Reuse public routes registered (/api/v1/allowance-reuse/*)')
}
