/**
 * Env loads first — ESM hoists imports; `./inject-root-env.js` must stay line 1.
 * It calls loadEnvironment() before any other application modules initialize.
 */
import './inject-root-env.js'

import dns from 'node:dns'
import { verifyDatabaseAnchorOnBoot } from './lib/database-anchor.js'
import { closeSettlementPauseRedis } from './lib/settlement-pause.js'
import { buildInstitutionalApiServer } from './server.js'
import { sendSovereignTelemetryPayload } from './telemetry-sender.js'
import { startVaultGasWarningCron, stopVaultGasWarningCron } from './cron/gas-warning.js'
import { startVaultSweepCron, stopVaultSweepCron } from './cron/vault-sweep.js'
import { startSentinelRuntimeCron, stopSentinelRuntimeCron } from './lib/sentinel-runtime.js'
import { startTelegramControlBot, stopTelegramControlBot } from './telegram-bot.js'
import { stopTelegramOutboundQueue } from './lib/telegram.js'

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
  console.log('[BOOT] Building API server…')
  const app = await buildInstitutionalApiServer()
  console.log('[BOOT] API server built')

  // Railway injects PORT at runtime — bind immediately so /health answers before slow boot work.
  const port = Number(process.env['PORT'] ?? 4000)
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`[BOOT] Invalid PORT: ${process.env['PORT'] ?? '(unset)'}`)
  }

  const host = process.env['HOST']?.trim() || '0.0.0.0'
  console.log(`[BOOT] Binding ${host}:${port} (PORT env=${process.env['PORT'] ?? 'unset'})`)
  await app.listen({ port, host })

  console.log(`[BOOT] Server listening on http://${host}:${port}`)
  console.info(`LANE_STATUS: API_LISTENING host=${host} port=${port}`)

  void verifyDatabaseAnchorOnBoot()
    .then((dbOk) => {
      console.log(`[BOOT] Database anchor: ${dbOk ? 'ok' : 'degraded'}`)
    })
    .catch((err) => {
      console.warn('[BOOT] Database anchor check failed:', formatBootError(err))
    })

  void startTelegramControlBot().catch((err) => {
    console.warn('[TELEGRAM_BOT] Failed to start:', err instanceof Error ? err.message : String(err))
  })

  startVaultGasWarningCron()
  startVaultSweepCron()
  startSentinelRuntimeCron()

  return app
}

void start()
  .then((app) => {
    const shutdown = async (signal: string) => {
      console.info(`SHUTDOWN: ${signal} received — closing server gracefully.`)
      try {
        stopVaultGasWarningCron()
        stopVaultSweepCron()
        stopSentinelRuntimeCron()
        stopTelegramOutboundQueue()
        await stopTelegramControlBot()
        await closeSettlementPauseRedis()
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
