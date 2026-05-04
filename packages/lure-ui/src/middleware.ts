import { NextResponse, type NextRequest } from 'next/server'

import { resolveCorsSynchronizationAllowOrigin } from './lib/cors-synchronization.js'

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

/** Vercel Routing — map `/admin/*` to Vault deployment when `NEXT_PUBLIC_SOVEREIGN_ADMIN_URL` is bound. */
function resolveAdminVaultRedirect(request: NextRequest): NextResponse | null {
  const path = request.nextUrl.pathname
  if (path !== '/admin' && !path.startsWith('/admin/')) {
    return null
  }
  const vaultBase = process.env.NEXT_PUBLIC_SOVEREIGN_ADMIN_URL?.trim().replace(/\/+$/, '')
  if (!vaultBase) {
    return null
  }
  const rest = path.replace(/^\/admin\/?/, '')
  const segments = rest.split('/').filter(Boolean)
  let targetPath = '/login'
  if (segments[0] === 'dashboard') targetPath = '/dashboard'
  else if (segments[0] === 'diagnostic') targetPath = '/diagnostic'
  else if (segments[0] === 'login') targetPath = '/login'
  return NextResponse.redirect(new URL(targetPath, vaultBase))
}

export async function middleware(request: NextRequest) {
  const vaultRedirect = resolveAdminVaultRedirect(request)
  if (vaultRedirect) {
    return vaultRedirect
  }

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

  return NextResponse.next({ request })
}

export const config = {
  matcher: ['/api/:path*', '/admin', '/admin/:path*'],
}
