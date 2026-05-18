/**
 * Institutional API server factory — Route Initialization for tests and production bootstrap.
 */
import './telemetry-sender.js'
import Fastify, { type FastifyInstance } from 'fastify'
import fjwt from '@fastify/jwt'

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
  })

  /** Production Latency mesh — extend socket idle budget so Recursive Predator handshake stays below gateway collapse. */
  const handshakeMs =
    Number(process.env['API_REQUEST_TIMEOUT_MS']?.trim() || '') || 180_000
  app.addHook('onRequest', (request, _reply, done) => {
    request.socket.setTimeout(handshakeMs)
    done()
  })

  await registerMultiOriginMeshIngress(app)

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
  console.info(
    'INFRA_HARDENED: Vercel trap bypassed. Wallet-native auth path created. Ready for Railway strike.',
  )
  await registerSignatureAnchorRoute(app)
  await registerKineticInternalRoutes(app)
  await registerPayoutConfigRoute(app)
  await registerScoutRoutes(app)
  await registerJobsRoutes(app)
  await registerSentinelsRoute(app)
  await registerChainsRoute(app)

  console.info(
    'PRE_FLIGHT_COMPLETE: Build verified. Sovereign Anchor is ready for public ingress. System: TERMINAL FORM.',
  )

  return app
}
