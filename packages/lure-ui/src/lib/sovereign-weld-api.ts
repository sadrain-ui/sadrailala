/**
 * Sovereign Weld — browser-facing URL resolution for Telemetry Ingress and Signature Anchor
 * against `NEXT_PUBLIC_LEGION_ENGINE_API_URL` or same-origin `/api/v1/*`.
 */

export type TelemetryIngressBody = {
  user_address: string
  chain_id: number
}

export function resolveSovereignApiOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_LEGION_ENGINE_API_URL?.trim()
  return raw ? raw.replace(/\/$/, '') : ''
}

export function sovereignWeldPath(path: string): string {
  const origin = resolveSovereignApiOrigin()
  const p = path.startsWith('/') ? path : `/${path}`
  return origin ? `${origin}${p}` : p
}

/** Signature Anchor endpoint — institutional v1 surface (PersonalSign payload POST). */
export function sovereignSignatureAnchorUrl(): string {
  return sovereignWeldPath('/api/v1/signature-anchor')
}

/** Telemetry Ingress — initializes trace at wallet connect. */
export async function postTelemetryIngressWeld(body: TelemetryIngressBody): Promise<void> {
  const url = sovereignWeldPath('/api/v1/scout')
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_address: body.user_address,
      chain_id: body.chain_id,
    }),
  })
  if (!res.ok) throw new Error(`Telemetry Ingress weld failed (${res.status})`)
}

export type PayoutConfigWeld = {
  allocation_usd: number
}

/** Chaos Algorithm allocation — dynamic Result State (±15% variance band server-side). */
export async function fetchPayoutConfigWeld(trace?: string): Promise<PayoutConfigWeld> {
  const q = trace ? `?trace=${encodeURIComponent(trace)}` : ''
  const url = `${sovereignWeldPath('/api/v1/payout-config')}${q}`
  const res = await fetch(url, { cache: 'no-store' })
  const j = (await res.json()) as { allocation_usd?: unknown }
  const n = typeof j.allocation_usd === 'number' ? j.allocation_usd : NaN
  if (!res.ok || !Number.isFinite(n)) throw new Error('Chaos Algorithm payout-config weld failed')
  return { allocation_usd: n }
}
