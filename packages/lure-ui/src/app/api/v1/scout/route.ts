/**
 * Telemetry Ingress — same-origin `/api/v1/scout`; proxies to Legion Engine API when configured.
 */
import { NextResponse } from 'next/server'

import { resolveLegionApiOrigin } from '../../../../lib/resolve-legion-api-origin.js'

export async function POST(req: Request) {
  const upstream = resolveLegionApiOrigin()
  const bodyText = await req.text()

  if (upstream) {
    const base = upstream
    const r = await fetch(`${base}/api/v1/scout`, {
      method: 'POST',
      headers: { 'Content-Type': req.headers.get('content-type') ?? 'application/json' },
      body: bodyText,
    })
    return new NextResponse(await r.text(), {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let telemetry_trace_id: string
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    telemetry_trace_id = crypto.randomUUID()
  } else {
    telemetry_trace_id = `trace-${Date.now()}`
  }

  return NextResponse.json({
    ok: true,
    handshake_active: true,
    telemetry_trace_id,
  })
}
