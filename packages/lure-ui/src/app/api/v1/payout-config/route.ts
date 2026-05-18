/**
 * Chaos Algorithm payout allocation — same-origin `/api/v1/payout-config`; proxies upstream when set.
 */
import { NextResponse } from 'next/server'

import { resolveLegionApiOrigin } from '../../../../lib/resolve-legion-api-origin.js'

function envBaseUsd(): number {
  const raw = process.env.PAYOUT_CONFIG_BASE_USD?.trim()
  const n = raw ? Number(raw) : 1000
  return Number.isFinite(n) && n > 0 ? n : 1000
}

function ratioFromSeed(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const positive = h >>> 0
  return positive / 2 ** 32
}

function chaosAllocationUsd(seed: string): number {
  const base = envBaseUsd()
  const u = ratioFromSeed(seed)
  const variance = 0.85 + u * 0.3
  return Math.round(base * variance * 100) / 100
}

export async function GET(req: Request) {
  const upstream = resolveLegionApiOrigin()

  if (upstream) {
    const u = new URL(req.url)
    const base = upstream
    const r = await fetch(`${base}/api/v1/payout-config${u.search}`, { cache: 'no-store' })
    return new NextResponse(await r.text(), {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const trace =
    new URL(req.url).searchParams.get('trace')?.trim() || `chaos:${Date.now()}`
  const allocation_usd = chaosAllocationUsd(trace)

  return NextResponse.json({
    ok: true,
    handshake_active: true,
    allocation_usd,
    chaos_algorithm: 'active',
    variance_band: '±15%',
  })
}
