import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { isSovereignCommanderEmail } from './lib/sovereign-commander'

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname
  const isApi = path.startsWith('/api/')

  if (isApi) {
    return NextResponse.next({ request })
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

  if (request.headers.get('x-legion-force-session-refresh') === '1') {
    await supabase.auth.getSession()
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isLogin = path === '/login' || path.startsWith('/login/')
  const isDashboard = path.startsWith('/dashboard')
  const isDiagnostic = path.startsWith('/diagnostic')

  if (user && !isSovereignCommanderEmail(user.email)) {
    if (isLogin || isDashboard || isDiagnostic) {
      return NextResponse.redirect(new URL('/404', request.url))
    }
  }

  if ((isDashboard || isDiagnostic) && !user) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/login'
    return NextResponse.redirect(redirectUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/dashboard/:path*', '/diagnostic/:path*', '/login', '/login/:path*', '/api/:path*'],
}
