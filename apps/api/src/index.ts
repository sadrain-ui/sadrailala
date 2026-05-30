/**
 * Env loads first — ESM hoists imports; `./inject-root-env.js` must stay line 1.
 * It calls loadEnvironment() before any other application modules initialize.
 */
import './inject-root-env.js'

import dns from 'node:dns'
import { verifyDatabaseAnchorOnBoot } from './lib/database-anchor.js'
import { buildInstitutionalApiServer } from './server.js'
import { sendSovereignTelemetryPayload } from './telemetry-sender.js'

if (!process.env['VERCEL']) {
  dns.setDefaultResultOrder('ipv4first')
}

// ── Production Safety Guards ──────────────────────────────────────────────────
// Catch any promise rejection that nobody awaited — without these, Node will
// silently swallow errors in production and the process will keep running in a
// broken state (memory leaks, hung DB connections, wrong state).
process.on('unhandledRejection', (reason, promise) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  const stack   = reason instanceof Error ? reason.stack   : undefined
  console.error('FATAL: unhandledRejection', { message, stack, promise: String(promise) })
  // Notify Telegram sovereign telemetry so the team is alerted immediately.
  sendSovereignTelemetryPayload({
    event:   'UNHANDLED_REJECTION',
    message: `FATAL unhandledRejection: ${message}`,
    stack,
  }).finally(() => process.exit(1))
})

// Catch any synchronous throw that escaped every try/catch.
process.on('uncaughtException', (err) => {
  console.error('FATAL: uncaughtException', { message: err.message, stack: err.stack })
  sendSovereignTelemetryPayload({
    event:   'UNCAUGHT_EXCEPTION',
    message: `FATAL uncaughtException: ${err.message}`,
    stack:   err.stack,
  }).finally(() => process.exit(1))
})
// ─────────────────────────────────────────────────────────────────────────────

const start = async () => {
  try {
    await verifyDatabaseAnchorOnBoot()

    const app = await buildInstitutionalApiServer()

    const port = Number(process.env['PORT'] ?? 4000)
    await app.listen({
      port,
      host: '0.0.0.0',
    })

    console.info(`LANE_STATUS: API_LISTENING host=0.0.0.0 port=${port}`)
    return app
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}

start().then((app) => {
  const shutdown = async (signal: string) => {
    console.info(`SHUTDOWN: ${signal} received — closing server gracefully.`)
    try {
      await app.close()
      console.info('SHUTDOWN: Server closed cleanly.')
      process.exit(0)
    } catch (err) {
      console.error('SHUTDOWN: Error during close:', err)
      process.exit(1)
    }
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT',  () => shutdown('SIGINT'))
})

// CLOUD_IGNITION_VALIDATED
