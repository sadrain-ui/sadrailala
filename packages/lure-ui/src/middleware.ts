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

  return NextResponse.next({ request })
}

export const config = {
  matcher: ['/api/:path*'],
}
