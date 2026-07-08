/**
 * Application ingress — Fastify CORS binding.
 * Allowed origins: `API_CORS_ORIGINS`, `API_VECTOR_INGRESS_ORIGINS`, optional host suffix match.
 */
import cors from '@fastify/cors'
import type { FastifyInstance } from 'fastify'

const DEV_DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
]

function parseCommaSeparatedOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function normalizeToOrigin(entry: string): string {
  const t = entry.trim().replace(/\/$/, '')
  if (!t) return ''
  try {
    const u = new URL(t.includes('://') ? t : `https://${t}`)
    return u.origin
  } catch {
    return t
  }
}

function originMatchesHostSuffix(origin: string, suffix: string): boolean {
  const s = suffix.trim()
  if (!s.startsWith('.')) return false
  try {
    const host = new URL(origin).hostname
    return host.endsWith(s) || host === s.slice(1)
  } catch {
    return false
  }
}

function parseHostSuffixes(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function originMatchesAnyHostSuffix(origin: string, suffixes: string[]): boolean {
  for (const suffix of suffixes) {
    if (originMatchesHostSuffix(origin, suffix)) return true
  }
  return false
}

function originInAllowList(origin: string, list: string[], hostSuffixes: string[]): boolean {
  for (const item of list) {
    const o = normalizeToOrigin(item)
    if (!o) continue
    try {
      if (new URL(o).origin === origin) return true
    } catch {
      if (o === origin) return true
    }
  }
  if (hostSuffixes.length > 0 && originMatchesAnyHostSuffix(origin, hostSuffixes)) return true
  return false
}

export async function registerMultiOriginMeshIngress(app: FastifyInstance): Promise<void> {
  const isProd = process.env['NODE_ENV'] === 'production'
  const hostSuffixes = parseHostSuffixes(process.env['API_CORS_ORIGIN_HOST_SUFFIX'])

  let configuredOrigins = [
    ...parseCommaSeparatedOrigins(process.env['API_CORS_ORIGINS']),
    ...parseCommaSeparatedOrigins(process.env['API_VECTOR_INGRESS_ORIGINS']),
    ...parseCommaSeparatedOrigins(process.env['API_SITE_URL']),
    ...parseCommaSeparatedOrigins(process.env['NEXT_PUBLIC_SITE_URL']),
  ]
    .map((entry) => normalizeToOrigin(entry))
    .filter((entry) => entry.length > 0)

  if (!isProd && configuredOrigins.length === 0) {
    configuredOrigins = DEV_DEFAULT_ORIGINS.map((o) => normalizeToOrigin(o))
  }

  const uniqueOrigins = [...new Set(configuredOrigins)]
  const corsAllowAll =
    process.env['API_CORS_ALLOW_ALL'] === '1' ||
    process.env['API_CORS_ALLOW_ALL']?.toLowerCase() === 'true'
  const permissiveWildcard =
    corsAllowAll || (uniqueOrigins.length === 0 && hostSuffixes.length === 0)

  if (permissiveWildcard && isProd && !corsAllowAll) {
    throw new Error(
      'FATAL: API_CORS_ORIGINS (or API_CORS_ALLOW_ALL=1) must be set in production — permissive wildcard is not allowed.',
    )
  }

  if (corsAllowAll && isProd) {
    app.log.warn('CORS_ALLOW_ALL in production — credentials disabled for wildcard origin')
  }

  await app.register(cors, {
    credentials: !permissiveWildcard,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-Requested-With',
      'x-legion-force-session-refresh',
      'x-legion-kinetic-key',
      'x-kinetic-key',
      'X-Kinetic-Key',
      'x-source-origin',
      'Origin',
      'Referer',
    ],
    exposedHeaders: ['x-request-id'],
    origin(origin, cb) {
      if (permissiveWildcard) {
        cb(null, true)
        return
      }
      if (!origin) {
        cb(null, true)
        return
      }
      if (originInAllowList(origin, uniqueOrigins, hostSuffixes)) {
        cb(null, true)
        return
      }
      cb(null, false)
    },
  })

  if (corsAllowAll) {
    app.log.info('CORS_ALLOW_ALL_ACTIVE')
  } else if (uniqueOrigins.length > 0) {
    app.log.info({ origins: uniqueOrigins, hostSuffixes: hostSuffixes.length ? hostSuffixes : null }, 'CORS_ALLOW_LIST_ACTIVE')
  }
}
