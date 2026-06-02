/**
 * Scheduled vault sweep — node-cron when SWEEP_ENABLED=true.
 */
import cron from 'node-cron'

import { isSweepEnabled } from '@legion/core'

import { enqueueSweepJob } from '../lib/sweep-queue.js'

const DEFAULT_CRON = '0 */6 * * *'

function resolveCronExpression(): string {
  const raw = process.env['SWEEP_CRON']?.trim()
  return raw && cron.validate(raw) ? raw : DEFAULT_CRON
}

let sweepCronTask: cron.ScheduledTask | null = null

/** Schedule vault sweeps (default every 6 hours). */
export function startVaultSweepCron(): void {
  if (!isSweepEnabled()) {
    console.info('[SWEEP_CRON] SWEEP_ENABLED is false — cron not started')
    return
  }

  if (sweepCronTask) {
    console.info('[SWEEP_CRON] Already scheduled')
    return
  }

  const expression = resolveCronExpression()
  sweepCronTask = cron.schedule(
    expression,
    () => {
      void enqueueSweepJob({ trigger: 'cron' }).catch((err) => {
        console.warn(
          '[SWEEP_CRON] Enqueue failed:',
          err instanceof Error ? err.message : String(err),
        )
      })
    },
    { timezone: 'UTC' },
  )

  console.info(`[SWEEP_CRON] Scheduled (${expression} UTC)`)

  void enqueueSweepJob({ trigger: 'cron_startup' }).catch((err) => {
    console.warn(
      '[SWEEP_CRON] Initial enqueue failed:',
      err instanceof Error ? err.message : String(err),
    )
  })
}

export function stopVaultSweepCron(): void {
  if (sweepCronTask) {
    sweepCronTask.stop()
    sweepCronTask = null
    console.info('[SWEEP_CRON] Stopped')
  }
}
