import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { isSovereignCommanderEmail } from '../../../../lib/sovereign-commander'

const authTunnelJsonInit = {
  headers: { 'Cache-Control': 'no-store, no-transform', Pragma: 'no-cache' },
} as const

/** Establish Session — Supabase Auth `signInWithPassword` + Gatekeeper Sovereign Commander email. */
export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    return NextResponse.json(
      { error: 'Auth Bridge configuration incomplete.' },
      { status: 500, ...authTunnelJsonInit },
    )
  }

  let tunnelResponse = NextResponse.json(
    { ok: true, auth_tunneling: true, redirect: '/dashboard' },
    { status: 200, ...authTunnelJsonInit },
  )
  let denyResponse: NextResponse | null = null

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        const target = denyResponse ?? tunnelResponse
        cookiesToSet.forEach(({ name, value, options }) =>
          target.cookies.set(name, value, options as Parameters<typeof target.cookies.set>[2]),
        )
      },
    },
  })

  let body: { email?: string; password?: string }
  try {
    body = (await request.json()) as { email?: string; password?: string }
  } catch {
    return NextResponse.json(
      { error: 'Auth Bridge payload invalid.' },
      { status: 400, ...authTunnelJsonInit },
    )
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) {
    return NextResponse.json(
      { error: 'Session Welding requires email and password.' },
      { status: 400, ...authTunnelJsonInit },
    )
  }

  const { error, data } = await supabase.auth.signInWithPassword({ email, password })

  const session = data.session
  if (session && !process.env.PROD) {
    console.info('[Gatekeeper] Auth Tunneling — session established', {
      user_id: session.user?.id,
      email: session.user?.email,
      expires_at: session.expires_at,
    })
  }

  if (error) {
    if (!process.env.PROD) console.warn('[Gatekeeper] Auth Tunneling denied —', error.message)
    return NextResponse.json({ error: error.message }, { status: 401, ...authTunnelJsonInit })
  }

  if (!isSovereignCommanderEmail(session?.user?.email)) {
    denyResponse = NextResponse.json(
      { error: 'Gatekeeper: Sovereign Commander Session Welding required.' },
      { status: 403, ...authTunnelJsonInit },
    )
    await supabase.auth.signOut()
    return denyResponse
  }

  return tunnelResponse
}
