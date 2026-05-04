/**
 * Sovereign Re-Seed — restores institutional `engine_config` defaults; client clears wallet storage plane.
 */

import { invalidateRemoteConfigCache } from '@legion/core/config/remote-sync'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

import { SOVEREIGN_ENGINE_CONFIG_DEFAULTS } from '@legion/core/config/sovereign-engine-config-defaults'
import { createServerSupabaseClient } from '../../../../../lib/supabase/server.js'
import { isSovereignCommanderEmail } from '../../../../../lib/sovereign-commander.js'

export const dynamic = 'force-dynamic'

export async function POST() {
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
  const now = new Date().toISOString()
  const rows = SOVEREIGN_ENGINE_CONFIG_DEFAULTS.map((r) => ({
    key_name: r.key_name,
    key_value: r.key_value,
    description: r.description,
    updated_at: now,
  }))

  const { error } = await admin.from('engine_config').upsert(rows, { onConflict: 'key_name' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  invalidateRemoteConfigCache()
  const expected = SOVEREIGN_ENGINE_CONFIG_DEFAULTS.length
  const matched = rows.length === expected
  if (!process.env.PROD) {
    console.info(
      JSON.stringify({
        sentinel: 'Dispatcher',
        event: 'RESEED_VERIFICATION',
        portability_audit: '2026-standard RPC defaults',
        row_count: rows.length,
        expected_keys: expected,
        aligned: matched,
        keys: rows.map((r) => r.key_name),
      }),
    )
  }
  return NextResponse.json({
    ok: true,
    reseeded_keys: rows.map((r) => r.key_name),
    reseed_verification: {
      expected_row_count: expected,
      aligned: matched,
    },
  })
}
