/**
 * CORS Synchronization — Deployment Sanity: allow-origin derives from `NEXT_PUBLIC_SITE_URL`
 * on the production plane (no localhost literals on prod paths).
 */

import type { NextRequest } from 'next/server'

function normalizeSiteOrigin(raw: string | undefined): string {
  if (!raw?.trim()) return ''
  const s = raw.trim().replace(/\/$/, '')
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`)
    return u.origin
  } catch {
    return ''
  }
}

function hostnameMatch(a: string, b: string): boolean {
  try {
    const ha = new URL(a).hostname.replace(/^www\./, '')
    const hb = new URL(b).hostname.replace(/^www\./, '')
    return ha === hb
  } catch {
    return false
  }
}

function isLocalDevOrigin(origin: string): boolean {
  try {
    const h = new URL(origin).hostname
    return h === 'localhost' || h === '127.0.0.1'
  } catch {
    return false
  }
}

/**
 * Resolves `Access-Control-Allow-Origin` for Gatekeeper API surfaces (middleware).
 */
export function resolveCorsSynchronizationAllowOrigin(request: NextRequest): string {
  const siteOrigin = normalizeSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL)
  const reqOrigin = request.headers.get('origin')
  const prodPlane = Boolean(process.env.PROD)

  if (!prodPlane) {
    if (reqOrigin && reqOrigin !== 'null') {
      if (siteOrigin && hostnameMatch(reqOrigin, siteOrigin)) return reqOrigin
      if (isLocalDevOrigin(reqOrigin)) return reqOrigin
      return reqOrigin
    }
    return '*'
  }

  if (reqOrigin && reqOrigin !== 'null' && siteOrigin) {
    if (reqOrigin === siteOrigin || hostnameMatch(reqOrigin, siteOrigin)) return reqOrigin
  }

  if (siteOrigin) return siteOrigin

  return '*'
}
