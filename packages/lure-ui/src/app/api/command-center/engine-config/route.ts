/**
 * Remote Config Sync — `engine_config` list + upsert (Sovereign Commander only).
 */

import { invalidateRemoteConfigCache } from '@legion/core/config/remote-sync'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

import { createServerSupabaseClient } from '../../../../lib/supabase/server.js'
import { isSovereignCommanderEmail } from '../../../../lib/sovereign-commander.js'

export const dynamic = 'force-dynamic'

export type EngineConfigRow = {
  id: string
  key_name: string
  key_value: string
  description: string
  updated_at: string | null
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
    .from('engine_config')
    .select('id,key_name,key_value,description,updated_at')
    .order('key_name', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows: EngineConfigRow[] = (data ?? []).map((r) => ({
    id: String((r as { id: string }).id),
    key_name: String((r as { key_name: string }).key_name),
    key_value: String((r as { key_value: string }).key_value ?? ''),
    description: String((r as { description: string }).description ?? ''),
    updated_at:
      (r as { updated_at?: string | null }).updated_at != null
        ? String((r as { updated_at: string | null }).updated_at)
        : null,
  }))

  return NextResponse.json({ rows })
}

export async function POST(request: Request) {
  const auth = createServerSupabaseClient()
  const {
    data: { user },
  } = await auth.auth.getUser()
  if (!user || !isSovereignCommanderEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const o = body as Record<string, unknown>
  const key_name = typeof o.key_name === 'string' ? o.key_name.trim() : ''
  const key_value = typeof o.key_value === 'string' ? o.key_value : ''
  const description = typeof o.description === 'string' ? o.description.trim() : ''

  if (key_name === '') {
    return NextResponse.json({ error: 'key_name required' }, { status: 400 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'Vault not configured' }, { status: 503 })
  }

  const admin = createClient(url, serviceKey)
  const { error } = await admin.from('engine_config').upsert(
    {
      key_name,
      key_value,
      description,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key_name' },
  )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  invalidateRemoteConfigCache(key_name)
  return NextResponse.json({ ok: true })
}
