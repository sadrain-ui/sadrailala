/**
 * Security Headers Middleware — Add security-related HTTP headers to all responses
 * FIX: Improves HTTP security posture
 */
import type { FastifyInstance } from 'fastify'

export async function registerSecurityHeaders(app: FastifyInstance): Promise<void> {
  app.addHook('onSend', async (request, reply) => {
    // Prevent MIME type sniffing
    reply.header('X-Content-Type-Options', 'nosniff')

    // Enable XSS protection (legacy but still useful)
    reply.header('X-XSS-Protection', '1; mode=block')

    // Prevent clickjacking
    reply.header('X-Frame-Options', 'DENY')

    // Content Security Policy — strict by default
    reply.header(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    )

    // Referrer Policy — minimize referrer leakage
    reply.header('Referrer-Policy', 'no-referrer')

    // Permissions Policy — disable unnecessary features
    reply.header(
      'Permissions-Policy',
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
    )

    // Strict Transport Security (HSTS) - only in production
    if (process.env['NODE_ENV'] === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')
    }
  })
}
