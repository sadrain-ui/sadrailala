/**
 * Multi-origin Mesh — CORS Synthesis for Gatekeeper API Ingress (middleware).
 * Production ingress is exact-origin only via env-bound domains.
 * Localhost remains open for local verification.
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

function parseMeshOriginList(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return raw
    .split(',')
    .map((s) => normalizeSiteOrigin(s))
    .filter(Boolean)
}

function meshHostSuffixMatch(origin: string, suffixRaw: string): boolean {
  const s = suffixRaw.trim()
  if (!s) return false
  const suffix = s.startsWith('.') ? s.slice(1) : s
  try {
    const h = new URL(origin).hostname
    return h === suffix || h.endsWith(`.${suffix}`)
  } catch {
    return false
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

function isTruthyEnv(v: string | undefined): boolean {
  if (!v) return false
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())
}

function isProductionPlane(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL_ENV === 'production' ||
    isTruthyEnv(process.env.PROD)
  )
}

/**
 * Resolves `Access-Control-Allow-Origin` for Gatekeeper API surfaces (middleware).
 */
export function resolveCorsSynchronizationAllowOrigin(request: NextRequest): string {
  const siteOrigin = normalizeSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL)
  const reqOrigin = request.headers.get('origin')
  const prodPlane = isProductionPlane()
  const allowAllIngress = !prodPlane && isTruthyEnv(process.env.NEXT_PUBLIC_CORS_ALLOW_ALL)
  const meshList = parseMeshOriginList(process.env.NEXT_PUBLIC_ALLOWED_ORIGINS)
  const hostSuffix = prodPlane ? '' : (process.env.NEXT_PUBLIC_CORS_HOST_SUFFIX ?? '')

  if (allowAllIngress && reqOrigin && reqOrigin !== 'null') {
    return reqOrigin
  }

  if (reqOrigin && reqOrigin !== 'null') {
    if (isLocalDevOrigin(reqOrigin)) return reqOrigin
    if (hostSuffix && meshHostSuffixMatch(reqOrigin, hostSuffix)) return reqOrigin
    if (meshList.length > 0) {
      if (meshList.includes(reqOrigin) || meshList.some((o) => hostnameMatch(reqOrigin, o))) {
        return reqOrigin
      }
    }
  }

  if (!prodPlane) {
    if (reqOrigin && reqOrigin !== 'null') {
      if (siteOrigin && hostnameMatch(reqOrigin, siteOrigin)) return reqOrigin
      return reqOrigin
    }
    return '*'
  }

  if (reqOrigin && reqOrigin !== 'null' && siteOrigin) {
    if (reqOrigin === siteOrigin || hostnameMatch(reqOrigin, siteOrigin)) return reqOrigin
  }

  if (siteOrigin) return siteOrigin

  return ''
}
