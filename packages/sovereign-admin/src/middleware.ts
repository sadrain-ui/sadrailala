import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  return NextResponse.next({ request })
}

export const config = {
  matcher: ['/dashboard/:path*', '/diagnostic/:path*', '/login', '/login/:path*', '/api/:path*'],
}
