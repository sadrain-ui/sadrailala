/**
 * Institutional API server factory — Route Initialization for tests and production bootstrap.
 */
import './telemetry-sender.js'
import Fastify, { type FastifyInstance } from 'fastify'
import fjwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'

import { registerMultiOriginMeshIngress } from './app.js'
import { registerSiweAuthRoutes } from './controllers/auth.controller.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerChainsRoute } from './routes/chains.js'
import { registerCommandCenterSignaturesRoute } from './routes/command-center-signatures.js'
import { registerHealthRoute } from './routes/health.js'
import { registerJobsRoutes } from './routes/jobs.js'
import { registerScoutRoutes } from './routes/scout.js'
import { registerSentinelsRoute } from './routes/sentinels.js'
import { registerSignatureAnchorRoute } from './routes/signature-anchor.js'
import { registerPayoutConfigRoute } from './routes/payout-config.js'
import { registerPingStrikeRoute } from './routes/ping-strike.js'
import { initializeTelegramHeartbeat } from './services/telemetry-service.js'
import { registerKineticInternalRoutes } from './routes/kinetic-internal.js'
import { sendSovereignTelemetryPayload } from './telemetry-sender.js'

initializeTelegramHeartbeat()

export type BuildApiServerOptions = {
  /** Disable default Fastify request logging (Vitest / load harness). */
  logger?: boolean
}

function resolveApiLogLevel(): string {
  const configured = process.env['LOG_LEVEL']?.trim()
  if (configured) return configured
  return process.env['NODE_ENV'] === 'development' ? 'debug' : 'info'
}

export async function buildInstitutionalApiServer(
  opts: BuildApiServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger !== undefined ? opts.logger : { level: resolveApiLogLevel() },
    bodyLimit: 1_048_576,
    // Attach a request-id to every request so errors are always traceable in logs.
    genReqId: () => `legion-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  })

  // ── Global Error Handler ────────────────────────────────────────────────────
  // Without this, Fastify returns raw 500s with no context. With it, every
  // unhandled route error is: (a) logged with the request-id, (b) forwarded to
  // Telegram telemetry in production, (c) returned as a clean JSON body.
  app.setErrorHandler(async (error, request, reply) => {
    const statusCode = error.statusCode ?? 500
    const reqId      = request.id

    // Log at warn for 4xx (client errors), error for 5xx (server errors).
    if (statusCode >= 500) {
      request.log.error({ err: error, reqId }, 'UNHANDLED_ROUTE_ERROR')
      // Fire-and-forget telemetry — do NOT await so the response is not delayed.
      void sendSovereignTelemetryPayload({
        event:      'ROUTE_ERROR_500',
        message:    `500 error on ${request.method} ${request.url}: ${error.message}`,
        reqId,
        statusCode,
      })
    } else {
      request.log.warn({ err: error, reqId }, 'CLIENT_ERROR')
    }

    await reply.status(statusCode).send({
      error:      error.name ?? 'InternalServerError',
      message:    statusCode < 500 ? error.message : 'Internal server error — request logged.',
      statusCode,
      reqId,
    })
  })
  // ───────────────────────────────────────────────────────────────────────────

  /** Production Latency mesh — extend socket idle budget so Recursive Predator handshake stays below gateway collapse. */
  const handshakeMs =
    Number(process.env['API_REQUEST_TIMEOUT_MS']?.trim() || '') || 180_000
  app.addHook('onRequest', (request, _reply, done) => {
    request.socket.setTimeout(handshakeMs)
    done()
  })

  await registerMultiOriginMeshIngress(app)
  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: 60_000,
    errorResponseBuilder: (_request, context) => ({
      error: 'Too Many Requests',
      message: `Rate limit exceeded — max ${context.max} requests per minute.`,
      statusCode: 429,
    }),
  })

  const jwtSecret = process.env['JWT_SECRET']?.trim()
  if (!jwtSecret) {
    throw new Error('FATAL_ENV_VALIDATION: JWT_SECRET is required for API boot.')
  }
  await app.register(fjwt, {
    secret: jwtSecret,
  })

  await registerHealthRoute(app)
  await registerPingStrikeRoute(app)
  await registerCommandCenterSignaturesRoute(app)

  await registerAuthRoutes(app)
  await registerSiweAuthRoutes(app)
  await registerSignatureAnchorRoute(app)
  await registerKineticInternalRoutes(app)
  await registerPayoutConfigRoute(app)
  await registerScoutRoutes(app)
  await registerJobsRoutes(app)
  await registerSentinelsRoute(app)
  await registerChainsRoute(app)

  return app
}
