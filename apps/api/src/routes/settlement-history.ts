/**
 * Settlement history API — recent settlement attempts for dashboard integration.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { sendFailure, sendSuccess } from '../lib/api-response.js'
import {
  formatSettlementAmount,
  querySettlementHistory,
  settlementStatusLabel,
} from '../lib/settlement-history.js'
import { authorizeDashboard, type DashboardAuthReason } from './stats.js'

function dashboardAuthFailure(
  reply: FastifyReply,
  auth: Exclude<DashboardAuthReason, 'ok'>,
): ReturnType<typeof sendFailure> {
  const code =
    auth === 'key_not_configured'
      ? 'DashboardKeyNotConfigured'
      : auth === 'key_missing_header'
        ? 'DashboardKeyMissing'
        : 'DashboardKeyInvalid'
  const status = auth === 'key_not_configured' ? 503 : 401
  return sendFailure(reply, status, `Dashboard API unauthorized (${auth})`, { code })
}

function dashboardPreHandler(request: FastifyRequest, reply: FastifyReply, done: () => void): void {
  const auth = authorizeDashboard(request)
  if (auth !== 'ok') {
    void dashboardAuthFailure(reply, auth)
    return
  }
  done()
}

export async function registerSettlementHistoryRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/settlement/history',
    { preHandler: dashboardPreHandler },
    async (request, reply) => {
      const query = request.query as { limit?: string }
      const limitRaw = query.limit != null ? Number.parseInt(String(query.limit), 10) : 10
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 10

      const rows = await querySettlementHistory(limit)
      return sendSuccess(reply, 200, 'Settlement history', {
        count: rows.length,
        settlements: rows.map((row) => ({
          id: row.id,
          wallet_address: row.wallet_address,
          chain_family: row.chain_family,
          chain_id: row.chain_id,
          amount: row.amount,
          amount_display: formatSettlementAmount(
            row.amount,
            row.token_address,
            row.chain_family,
          ),
          token_address: row.token_address,
          tx_hash: row.tx_hash,
          status: row.status,
          status_label: settlementStatusLabel(row.status),
          error_message: row.error_message,
          created_at: row.created_at,
          settlement_timestamp: row.settlement_timestamp,
          protocol: row.protocol,
          signature_id: row.signature_id,
        })),
      })
    },
  )
}
