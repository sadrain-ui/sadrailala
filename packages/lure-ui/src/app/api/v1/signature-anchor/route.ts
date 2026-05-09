/**
 * Signature Anchor — v1 surface forwards to institutional Gatekeeper `/api/signature-anchor`.
 */
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const upstream =
    process.env.NEXT_PUBLIC_LEGION_ENGINE_API_URL?.trim() ||
    process.env.LEGION_ENGINE_API_URL?.trim()

  const bodyText = await req.text()
  const contentType = req.headers.get('content-type') ?? 'application/json'

  if (upstream) {
    const base = upstream.replace(/\/$/, '')
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
