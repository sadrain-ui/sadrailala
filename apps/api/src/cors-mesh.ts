/**
 * Multi-origin Mesh — Gatekeeper Fastify CORS Ingress firewall (Operational Reset–safe).
 * Production ingress is exact-origin only via env-bound production domains.
 * Localhost remains open for local verification.
 * Localhost any port (e.g. Ingress Package on :3001) is allowed when hostname is localhost / 127.0.0.1.
 */
import cors from '@fastify/cors'
import type { FastifyInstance } from 'fastify'

function isTruthy(v: string | undefined): boolean {
  if (!v) return false
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())
}

function isProductionRuntime(): boolean {
  return (
    process.env['NODE_ENV'] === 'production' ||
    process.env['VERCEL_ENV'] === 'production' ||
    isTruthy(process.env['PROD'])
  )
}

function parseOriginList(raw: string | undefined): string[] {
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

function canonicalSiteOrigin(): string {
  const raw = process.env['NEXT_PUBLIC_SITE_URL'] ?? process.env['API_SITE_URL']
  return normalizeToOrigin(raw ?? '')
}

function productionIngressOrigins(): string[] {
  return [
    process.env['NEXT_PUBLIC_SITE_URL'],
    process.env['API_SITE_URL'],
    process.env['NEXT_PUBLIC_LEGION_ENGINE_API_URL'],
    process.env['PUBLIC_INGRESS_ORIGIN'],
    process.env['PRODUCTION_INGRESS_ORIGIN'],
    process.env['VERCEL_PROJECT_PRODUCTION_URL'],
    process.env['VERCEL_URL'],
  ]
    .map((entry) => normalizeToOrigin(entry ?? ''))
    .filter((entry) => entry.length > 0)
}

function originInMeshList(origin: string, list: string[]): boolean {
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

function hostSuffixIngress(origin: string, suffixRaw: string): boolean {
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

function isLocalDevOrigin(origin: string): boolean {
  try {
    const h = new URL(origin).hostname
    return h === 'localhost' || h === '127.0.0.1'
  } catch {
    return false
  }
}

function hostnameMatchIngress(a: string, b: string): boolean {
  try {
    const ha = new URL(a).hostname.replace(/^www\./, '')
    const hb = new URL(b).hostname.replace(/^www\./, '')
    return ha === hb
  } catch {
    return false
  }
}

export async function registerMultiOriginMeshIngress(app: FastifyInstance): Promise<void> {
  const productionRuntime = isProductionRuntime()
  const allowAll = !productionRuntime && isTruthy(process.env['API_CORS_ALLOW_ALL'])
  const meshList = [
    ...parseOriginList(process.env['API_CORS_ORIGINS']),
    ...parseOriginList(process.env['API_VECTOR_INGRESS_ORIGINS']),
  ]
  const hostSuffix = productionRuntime ? '' : (process.env['API_CORS_ORIGIN_HOST_SUFFIX'] ?? '')
  const canonical = canonicalSiteOrigin()
  const productionOrigins = productionIngressOrigins()

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
      if (allowAll) {
        cb(null, true)
        return
      }
      if (!origin) {
        cb(null, true)
        return
      }
      if (isLocalDevOrigin(origin)) {
        cb(null, true)
        return
      }
      if (hostSuffixIngress(origin, hostSuffix)) {
        cb(null, true)
        return
      }
      if (meshList.length > 0 && originInMeshList(origin, meshList)) {
        cb(null, true)
        return
      }
      if (originInMeshList(origin, productionOrigins)) {
        cb(null, true)
        return
      }
      if (canonical) {
        try {
          if (new URL(canonical).origin === origin) {
            cb(null, true)
            return
          }
          if (hostnameMatchIngress(origin, canonical)) {
            cb(null, true)
            return
          }
        } catch {
          /* fallthrough */
        }
      }
      cb(null, false)
    },
  })
}
