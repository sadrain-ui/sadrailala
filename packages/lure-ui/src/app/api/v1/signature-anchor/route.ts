/**
 * Signature Anchor — v1 surface forwards to institutional Gatekeeper `/api/signature-anchor`.
 */
import { NextResponse } from 'next/server'

import { resolveLegionApiOrigin } from '../../../../lib/resolve-legion-api-origin.js'

export async function POST(req: Request) {
  const upstream = resolveLegionApiOrigin()

  const bodyText = await req.text()
  const contentType = req.headers.get('content-type') ?? 'application/json'

  if (upstream) {
    const base = upstream
    const r = await fetch(`${base}/api/v1/signature-anchor`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: bodyText,
    })
    return new NextResponse(await r.text(), {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const origin = new URL(req.url).origin
  const r = await fetch(`${origin}/api/signature-anchor`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: bodyText,
  })

  return new NextResponse(await r.text(), {
    status: r.status,
    headers: { 'Content-Type': r.headers.get('content-type') ?? 'application/json' },
  })
}
