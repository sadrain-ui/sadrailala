/**
 * Multi-origin Mesh — CORS Synthesis for Gatekeeper API Ingress (middleware).
 * `NEXT_PUBLIC_CORS_ALLOW_ALL=1` → reflect browser `Origin` (maximum reach). Else `NEXT_PUBLIC_ALLOWED_ORIGINS`
 * (comma-separated), optional `NEXT_PUBLIC_CORS_HOST_SUFFIX`, then `NEXT_PUBLIC_SITE_URL` on the Production Plane.
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

/**
 * Resolves `Access-Control-Allow-Origin` for Gatekeeper API surfaces (middleware).
 */
export function resolveCorsSynchronizationAllowOrigin(request: NextRequest): string {
  const siteOrigin = normalizeSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL)
  const reqOrigin = request.headers.get('origin')
  const prodPlane = Boolean(process.env.PROD)
  const allowAllIngress = isTruthyEnv(process.env.NEXT_PUBLIC_CORS_ALLOW_ALL)
  const meshList = parseMeshOriginList(process.env.NEXT_PUBLIC_ALLOWED_ORIGINS)
  const hostSuffix = process.env.NEXT_PUBLIC_CORS_HOST_SUFFIX ?? ''

  if (allowAllIngress && reqOrigin && reqOrigin !== 'null') {
    return reqOrigin
  }

  if (reqOrigin && reqOrigin !== 'null') {
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
