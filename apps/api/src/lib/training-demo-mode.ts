/**
 * Training demo mode — log wallet connections/signatures only; never settle.
 */
import type { FastifyRequest } from 'fastify'

export function isTrainingDemoModeEnabled(): boolean {
  const v = process.env['TRAINING_DEMO_MODE']?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

export function isTrainingDemoIngressBody(body: Record<string, unknown> | null): boolean {
  if (!body) return false
  if (body['training_demo'] === true) return true
  const protocol = typeof body['protocol'] === 'string' ? body['protocol'].trim().toLowerCase() : ''
  if (protocol === 'training_demo_v1' || protocol === 'training_demo') return true
  return false
}

export function isTrainingDemoRequest(request: FastifyRequest, body: Record<string, unknown> | null): boolean {
  const hdr = request.headers['x-legion-training-demo']
  const headerOn =
    hdr === '1' ||
    hdr === 'true' ||
    (typeof hdr === 'string' && hdr.toLowerCase() === 'yes')
  return headerOn || isTrainingDemoIngressBody(body)
}

export function isLocalhostOrigin(origin: string | undefined): boolean {
  if (!origin?.trim()) return false
  try {
    const host = new URL(origin).hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
  } catch {
    return false
  }
}

export function isAllowedTrainingDemoOrigin(origin: string | undefined): boolean {
  if (isLocalhostOrigin(origin)) return true
  if (!origin?.trim()) return false

  const allowed = (process.env['TRAINING_DEMO_ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)

  for (const entry of allowed) {
    try {
      if (new URL(entry.includes('://') ? entry : `http://${entry}`).origin === origin) {
        return true
      }
    } catch {
      if (entry === origin) return true
    }
  }

  const demoApi = process.env['DEMO_API_URL']?.trim()
  if (demoApi) {
    try {
      if (new URL(demoApi).origin === origin) return true
    } catch {
      /* ignore */
    }
  }

  return false
}
