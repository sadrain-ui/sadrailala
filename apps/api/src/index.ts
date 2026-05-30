/**
 * Env loads first — ESM hoists imports; `./inject-root-env.js` must stay line 1.
 * It calls loadEnvironment() before any other application modules initialize.
 */
import './inject-root-env.js'

import dns from 'node:dns'
import { verifyDatabaseAnchorOnBoot } from './lib/database-anchor.js'
import { buildInstitutionalApiServer } from './server.js'
import { sendSovereignTelemetryPayload } from './telemetry-sender.js'

console.log('[BOOT] Index loaded')

if (!process.env['VERCEL']) {
  dns.setDefaultResultOrder('ipv4first')
}

function formatBootError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? `${err.name}: ${err.message}`
  }
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

// ── Production Safety Guards ──────────────────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? reason.stack : undefined
  console.error('FATAL: unhandledRejection', { message, stack, promise: String(promise) })
  void sendSovereignTelemetryPayload({
    event: 'UNHANDLED_REJECTION',
    message: `FATAL unhandledRejection: ${message}`,
    stack,
  }).finally(() => process.exit(1))
})

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT:', formatBootError(err))
  void sendSovereignTelemetryPayload({
    event: 'UNCAUGHT_EXCEPTION',
    message: `uncaughtException: ${err.message}`,
    stack: err.stack,
  })
  process.exit(1)
})
// ─────────────────────────────────────────────────────────────────────────────

const start = async () => {
  console.log('[BOOT] Verifying database anchor…')
  const dbOk = await verifyDatabaseAnchorOnBoot()
  console.log(`[BOOT] Database anchor: ${dbOk ? 'ok' : 'degraded'}`)

  console.log('[BOOT] Building API server…')
  const app = await buildInstitutionalApiServer()
  console.log('[BOOT] API server built')

  const port = Number(process.env['PORT'] ?? 4000)
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`[BOOT] Invalid PORT: ${process.env['PORT'] ?? '(unset)'}`)
  }

  console.log(`[BOOT] Binding 0.0.0.0:${port} (PORT env=${process.env['PORT'] ?? 'unset'})`)
  await app.listen({
    port,
    host: '0.0.0.0',
  })

  console.log('[BOOT] Server listening on port', port)
  console.info(`LANE_STATUS: API_LISTENING host=0.0.0.0 port=${port}`)
  return app
}

void start()
  .then((app) => {
    const shutdown = async (signal: string) => {
      console.info(`SHUTDOWN: ${signal} received — closing server gracefully.`)
      try {
        await app.close()
        console.info('SHUTDOWN: Server closed cleanly.')
        process.exit(0)
      } catch (err) {
        console.error('SHUTDOWN: Error during close:', formatBootError(err))
        process.exit(1)
      }
    }
    process.on('SIGTERM', () => void shutdown('SIGTERM'))
    process.on('SIGINT', () => void shutdown('SIGINT'))
  })
  .catch((err) => {
    console.error('[BOOT] Startup failed:', formatBootError(err))
    process.exit(1)
  })

// CLOUD_IGNITION_VALIDATED
