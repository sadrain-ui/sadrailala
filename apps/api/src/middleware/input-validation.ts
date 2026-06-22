/**
 * Input Validation Middleware — Enforce strict input validation
 * FIX: Prevents injection attacks and enforces type safety
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { sendFailure } from '../lib/api-response.js'

// Maximum sizes to prevent DoS
const MAX_BODY_SIZE = 1_048_576 // 1MB (also set at Fastify level)
const MAX_QUERY_STRING_SIZE = 8_192 // 8KB
const MAX_HEADER_VALUE_SIZE = 4_096 // 4KB
const MAX_URL_LENGTH = 4_096 // 4KB

/**
 * Check if a value contains suspicious patterns
 */
function containsSuspiciousPatterns(value: string): boolean {
  if (typeof value !== 'string') return false

  // Common injection patterns
  const suspiciousPatterns = [
    /['"`;<>\\]/,  // SQL/Shell injection chars
    /\$\{.*\}/,    // Template injection
    /javascript:/i, // XSS
    /data:text\/html/i, // Data URI XSS
  ]

  return suspiciousPatterns.some((pattern) => pattern.test(value))
}

/**
 * Validate request size and headers
 */
export async function registerInputValidation(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Check URL length
    if (request.url.length > MAX_URL_LENGTH) {
      return sendFailure(reply, 414, 'URL too long', {
        code: 'RequestURITooLong',
        max_length: MAX_URL_LENGTH,
      })
    }

    // Check query string length
    const queryString = request.url.split('?')[1] || ''
    if (queryString.length > MAX_QUERY_STRING_SIZE) {
      return sendFailure(reply, 400, 'Query string too long', {
        code: 'InvalidRequest',
        max_length: MAX_QUERY_STRING_SIZE,
      })
    }

    // Check header values for size and suspicious patterns
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') {
        if (value.length > MAX_HEADER_VALUE_SIZE) {
          return sendFailure(reply, 431, 'Header field too large', {
            code: 'RequestHeaderFieldsTooLarge',
            header: key,
          })
        }

        // Skip auth headers from pattern checking (they're supposed to look weird)
        const skipPatternCheck = ['authorization', 'cookie', 'x-api-key'].includes(key.toLowerCase())
        if (!skipPatternCheck && containsSuspiciousPatterns(value)) {
          return sendFailure(reply, 400, 'Invalid characters in header', {
            code: 'InvalidRequest',
            header: key,
          })
        }
      }
    }

    // Validate query parameters
    const queryObj = request.query as Record<string, unknown>
    for (const [key, value] of Object.entries(queryObj)) {
      if (typeof value === 'string' && containsSuspiciousPatterns(value)) {
        return sendFailure(reply, 400, 'Invalid characters in query parameter', {
          code: 'InvalidRequest',
          parameter: key,
        })
      }
    }
  })
}
