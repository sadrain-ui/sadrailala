import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { resolveCorsSynchronizationAllowOrigin } from './lib/cors-synchronization.js'
import { isSovereignCommanderEmail } from './lib/sovereign-commander.js'

/** Multi-origin Mesh — Gatekeeper API Ingress CORS via `cors-synchronization` (list / suffix / allow-all + site URL). */
function applyApiCorsHeaders(request: NextRequest, response: NextResponse): void {
  const allow = resolveCorsSynchronizationAllowOrigin(request)
  response.headers.set('Access-Control-Allow-Origin', allow)
  if (allow !== '*') {
    response.headers.set('Access-Control-Allow-Credentials', 'true')
  }
  response.headers.set(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
  )
  response.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, x-legion-force-session-refresh, X-Requested-With',
  )
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname
  const isApi = path.startsWith('/api/')

  if (isApi && request.method === 'OPTIONS') {
    const res = new NextResponse(null, { status: 204 })
    applyApiCorsHeaders(request, res)
    return res
  }

  if (isApi) {
    const res = NextResponse.next({ request })
    applyApiCorsHeaders(request, res)
    return res
  }

  let supabaseResponse = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    return supabaseResponse
  }

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        )
      },
    },
  })

  /** Gatekeeper — force-refresh: reconcile Supabase session from cookies when client signals refresh. */
  if (request.headers.get('x-legion-force-session-refresh') === '1') {
    await supabase.auth.getSession()
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isAdminLogin = path === '/admin/login' || path.startsWith('/admin/login/')
  const isAdminDashboard = path.startsWith('/admin/dashboard')

  if (user && !isSovereignCommanderEmail(user.email)) {
    if (isAdminLogin || isAdminDashboard) {
      return NextResponse.redirect(new URL('/404', request.url))
    }
  }

  if (isAdminDashboard && !user) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/admin/login'
    return NextResponse.redirect(redirectUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/admin/:path*', '/api/:path*'],
}
