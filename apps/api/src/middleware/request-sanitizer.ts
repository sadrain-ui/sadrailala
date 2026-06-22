/**
 * Request Sanitizer Middleware — Prevent sensitive data from being logged
 * FIX: Protects passwords, tokens, and private keys from exposure in logs
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'

const SENSITIVE_FIELDS = [
  'password',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'private_key',
  'secret',
  'totp',
  'otp',
  '2fa',
  'mfa',
  'session_cookies',
  'local_storage',
  'authorization',
  'x-api-key',
]

function sanitizeObject(obj: unknown, depth = 0): unknown {
  // Prevent deep recursion
  if (depth > 5) return '[REDACTED - deep object]'

  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, depth + 1))
  }

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase()
    const isSensitive = SENSITIVE_FIELDS.some((field) => lowerKey.includes(field))

    if (isSensitive) {
      result[key] = '[REDACTED]'
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeObject(value, depth + 1)
    } else {
      result[key] = value
    }
  }
  return result
}

export async function registerRequestSanitizer(app: FastifyInstance): Promise<void> {
  // Wrap the logger to sanitize sensitive fields
  const originalChildLogger = app.log.child.bind(app.log)

  app.log.child = function (bindings: Record<string, unknown>) {
    const sanitized = sanitizeObject(bindings) as Record<string, unknown>
    return originalChildLogger(sanitized)
  }

  // Add hook to sanitize request bodies in error logs
  app.addHook('onError', async (request, reply, error) => {
    // Don't modify the actual request body, just ensure logs don't expose it
    if (request.body && typeof request.body === 'object') {
      const sanitized = sanitizeObject(request.body)
      request.log.debug({ sanitized_body: sanitized }, 'Request body (sanitized)')
    }
  })
}
