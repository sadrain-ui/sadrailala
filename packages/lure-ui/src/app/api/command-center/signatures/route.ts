/**
 * Operational HUD — authenticated read of Signature Anchor ledger (service-role read after Gatekeeper session).
 */

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

import { createServerSupabaseClient } from '../../../../lib/supabase/server.js'
import { isSovereignCommanderEmail } from '../../../../lib/sovereign-commander.js'

export const dynamic = 'force-dynamic'

export type OperationalHudRow = {
  address: string
  scout_value_usd: string | null
  chain: string | null
  /** Anchor expiry-derived gate state */
  status: string
  /** Kinetic Link Settlement Status */
  settlement_status: string
  id: string
}

function deriveAnchorStatus(expiryIso: string): string {
  const t = Date.parse(expiryIso)
  if (Number.isNaN(t)) return 'UNKNOWN'
  return t > Date.now() ? 'ANCHOR_ACTIVE' : 'EXPIRED'
}

export async function GET() {
  const auth = createServerSupabaseClient()
  const {
    data: { user },
  } = await auth.auth.getUser()
  if (!user || !isSovereignCommanderEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'Vault not configured' }, { status: 503 })
  }

  const admin = createClient(url, serviceKey)
  const { data, error } = await admin
    .from('signatures')
    .select('id,wallet_address,scout_value_usd,chain_id,expiry,settlement_status')
    .order('expiry', { ascending: false })
    .limit(5)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
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

  return NextResponse.json({ rows })
}
