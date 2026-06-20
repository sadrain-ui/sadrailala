/**
 * Command Center — Signature Anchor read (admin HUD).
 */
import { createClient } from '@supabase/supabase-js'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { sendFailure, sendSuccess } from '../lib/api-response.js'
import { isSovereignCommanderEmail } from '../sovereign-gate.js'

export type OperationalHudRow = {
  address: string
  scout_value_usd: string | null
  chain: string | null
  status: string
  settlement_status: string
  id: string
}

function deriveAnchorStatus(expiryIso: string): string {
  const t = Date.parse(expiryIso)
  if (Number.isNaN(t)) return 'UNKNOWN'
  return t > Date.now() ? 'ANCHOR_ACTIVE' : 'EXPIRED'
}

export async function registerCommandCenterSignaturesRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/command-center/signatures', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization
    const jwt =
      typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')
        ? authHeader.slice(7).trim()
        : ''
    if (!jwt) {
      return sendFailure(reply, 401, 'Authorization required', { code: 'Unauthorized' })
    }

    const url =
      process.env['SUPABASE_URL']?.trim() ||
      process.env['NEXT_PUBLIC_SUPABASE_URL']?.trim() ||
      ''
    const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']?.trim()
    if (!url || !serviceKey) {
      return sendFailure(reply, 503, 'Vault not configured', { code: 'VaultNotConfigured' })
    }

    const admin = createClient(url, serviceKey)
    const {
      data: { user },
      error: userErr,
    } = await admin.auth.getUser(jwt)

    if (userErr || !user?.email || !isSovereignCommanderEmail(user.email)) {
      return sendFailure(reply, 401, 'Unauthorized', { code: 'Unauthorized' })
    }

    const { data, error } = await admin
      .from('signatures')
      .select('id,wallet_address,scout_value_usd,chain_id,expiry,settlement_status')
      .order('created_at', { ascending: false })
      .limit(5)

    if (error) {
      return sendFailure(reply, 500, error.message, { code: 'DatabaseError' })
    }

    const rows: OperationalHudRow[] = (data ?? []).map((r) => {
      const expiryIso =
        r.expiry != null && typeof r.expiry === 'string'
          ? r.expiry
          : r.expiry != null && typeof (r.expiry as { toISOString?: () => string }).toISOString === 'function'
            ? (r.expiry as { toISOString: () => string }).toISOString()
            : ''
      const ss = (r as { settlement_status?: string | null }).settlement_status
      return {
        id: String(r.id),
        address: String(r.wallet_address ?? ''),
        scout_value_usd: r.scout_value_usd != null ? String(r.scout_value_usd) : null,
        chain: r.chain_id != null ? String(r.chain_id) : null,
        status: expiryIso ? deriveAnchorStatus(expiryIso) : 'UNKNOWN',
        settlement_status:
          ss != null && String(ss).trim() !== '' ? String(ss).trim() : 'SETTLED',
      }
    })

    return sendSuccess(reply, 200, 'Command center signatures retrieved', { rows })
  })
}
