/**
 * Kinetic Audit API — RPC Connectivity Map, Vault posture, bundle Dry-run (no transmission).
 */

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

import { simulateBundleAssemblyDryRun } from '../../../../../lib/sovereign-diagnostic-bundle.js'
import { createServerSupabaseClient } from '../../../../../lib/supabase/server.js'
import { isSovereignCommanderEmail } from '../../../../../lib/sovereign-commander.js'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

const HTTP_URL = /^https?:\/\//i

function looksLikeHttpUrl(s: string): boolean {
  return HTTP_URL.test(s.trim())
}

function useSolanaProbe(keyName: string, url: string): boolean {
  return /SOLANA|HELIUS|JITO|solana|helius/i.test(keyName) || /solana\.com|helius-rpc|block-engine\.jito/i.test(url)
}

async function measureLaneLatencyMs(keyName: string, rawUrl: string): Promise<number | null> {
  const url = rawUrl.trim()
  if (!looksLikeHttpUrl(url)) return null

  const body = JSON.stringify(
    useSolanaProbe(keyName, url)
      ? { jsonrpc: '2.0', id: 1, method: 'getHealth', params: [] }
      : { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
  )

  const started = Date.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(12_000),
    })
    await res.arrayBuffer()
    return Math.max(0, Date.now() - started)
  } catch {
    return null
  }
}

export async function GET() {
  const auth = createServerSupabaseClient()
  const {
    data: { user },
  } = await auth.auth.getUser()
  if (!user || !isSovereignCommanderEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRunBundle = simulateBundleAssemblyDryRun()

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  let postgrestLatencyMs: number | null = null
  let supabaseReachable = false

  if (supabaseUrl && anonKey) {
    const base = supabaseUrl.replace(/\/$/, '')
    const t0 = Date.now()
    try {
      const res = await fetch(`${base}/rest/v1/`, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        signal: AbortSignal.timeout(10_000),
      })
      postgrestLatencyMs = Date.now() - t0
      supabaseReachable = res.ok || res.status === 404
    } catch {
      postgrestLatencyMs = null
      supabaseReachable = false
    }
  }

  let rlsStatus: 'restricted' | 'materializable' | 'unknown' = 'unknown'
  if (supabaseUrl && anonKey) {
    const base = supabaseUrl.replace(/\/$/, '')
    try {
      const res = await fetch(`${base}/rest/v1/engine_config?select=key_name&limit=1`, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.status === 401 || res.status === 403) {
        rlsStatus = 'restricted'
      } else if (res.ok) {
        rlsStatus = 'materializable'
      }
    } catch {
      rlsStatus = 'unknown'
    }
  }

  const rpcLanes: Array<{
    key_name: string
    latency_ms: number | null
    lane_class: 'http_probe' | 'skipped_non_url'
  }> = []

  let flashbotsLatencyMs: number | null = null
  let jitoLatencyMs: number | null = null
  let flashbotsProbeUrl = ''
  let jitoProbeUrl = ''

  if (serviceUrl && serviceKey) {
    const admin = createClient(serviceUrl, serviceKey)
    const { data, error } = await admin
      .from('engine_config')
      .select('key_name,key_value')
      .order('key_name', { ascending: true })

    if (!error && data) {
      for (const row of data as { key_name: string; key_value: string }[]) {
        const key_name = String(row.key_name ?? '')
        const key_value = String(row.key_value ?? '')
        if (!looksLikeHttpUrl(key_value)) {
          rpcLanes.push({ key_name, latency_ms: null, lane_class: 'skipped_non_url' })
          continue
        }
        const latency_ms = await measureLaneLatencyMs(key_name, key_value)
        rpcLanes.push({ key_name, latency_ms, lane_class: 'http_probe' })

        if (/FLASHBOTS/i.test(key_name)) {
          flashbotsProbeUrl = key_value.trim()
          flashbotsLatencyMs = latency_ms
        }
        if (/JITO/i.test(key_name)) {
          jitoProbeUrl = key_value.trim()
          jitoLatencyMs = latency_ms
        }
      }
    }
  }

  if (flashbotsProbeUrl === '' || flashbotsLatencyMs === null) {
    const fb = process.env['FLASHBOTS_RELAY_URL']?.trim() ?? ''
    flashbotsProbeUrl = fb
    flashbotsLatencyMs = fb ? await measureLaneLatencyMs('FLASHBOTS_RELAY_URL', fb) : null
  }
  if (jitoProbeUrl === '' || jitoLatencyMs === null) {
    const jito = process.env['JITO_SETTLEMENT_LANE_URL']?.trim() ?? ''
    jitoProbeUrl = jito
    jitoLatencyMs = jito ? await measureLaneLatencyMs('JITO_SETTLEMENT_LANE_URL', jito) : null
  }

  return NextResponse.json({
    kinetic_audit: {
      dry_run_bundle: dryRunBundle,
      database: {
        supabase_reachable: supabaseReachable,
        postgrest_latency_ms: postgrestLatencyMs,
        rls_anon_engine_config: rlsStatus,
      },
      rpc_lanes: rpcLanes,
      settlement_core: {
        flashbots_relay_latency_ms: flashbotsLatencyMs,
        jito_lane_latency_ms: jitoLatencyMs,
        flashbots_probe_url: flashbotsProbeUrl,
        jito_probe_url: jitoProbeUrl,
      },
    },
  })
}
