/**
 * Application ingress — Fastify CORS binding (Phase 68).
 * Allowed origins come from `API_CORS_ORIGINS` (comma-separated). Optional `API_VECTOR_INGRESS_ORIGINS`
 * is merged into the same allow-list. When both resolve empty, origin check is permissive (wildcard / reflect-all via Fastify CORS), matching open local-dev posture.
 */
import cors from '@fastify/cors'
import type { FastifyInstance } from 'fastify'

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

function originInAllowList(origin: string, list: string[]): boolean {
  for (const item of list) {
    const o = normalizeToOrigin(item)
    if (!o) continue
    try {
      if (new URL(o).origin === origin) return true
    } catch {
      if (o === origin) return true
    }
  }
  return false
}

export async function registerMultiOriginMeshIngress(app: FastifyInstance): Promise<void> {
  const configuredOrigins = [
    ...parseCommaSeparatedOrigins(process.env['API_CORS_ORIGINS']),
    ...parseCommaSeparatedOrigins(process.env['API_VECTOR_INGRESS_ORIGINS']),
  ]
    .map((entry) => normalizeToOrigin(entry))
    .filter((entry) => entry.length > 0)

  const permissiveWildcard = configuredOrigins.length === 0

  await app.register(cors, {
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'x-legion-force-session-refresh',
    ],
    origin(origin, cb) {
      if (permissiveWildcard) {
        cb(null, true)
        return
      }
      if (!origin) {
        cb(null, true)
        return
      }
      if (originInAllowList(origin, configuredOrigins)) {
        cb(null, true)
        return
      }
      cb(null, false)
    },
  })
}
