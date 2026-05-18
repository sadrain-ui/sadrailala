/**
 * Canonical Legion Engine API origin — client + server (Next route proxies, Sovereign Weld fetch).
 * Prefer `NEXT_PUBLIC_*` in Vercel/Railway; production ingress aliases are accepted when the public API domain is bound at build time.
 */

const ORIGIN_KEYS = [
  'NEXT_PUBLIC_LEGION_ENGINE_API_URL',
  'NEXT_PUBLIC_API_BASE_URL',
  'LEGION_ENGINE_API_URL',
  'PRODUCTION_INGRESS_ORIGIN',
  'PUBLIC_INGRESS_ORIGIN',
] as const

export function resolveLegionApiOrigin(): string {
  for (const key of ORIGIN_KEYS) {
    const raw = process.env[key]?.trim()
    if (raw) return raw.replace(/\/+$/, '')
  }
  return ''
}
