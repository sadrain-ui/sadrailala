/**
 * Execution wallet gas top-up cron — every 5 minutes by default.
 */
import cron from 'node-cron'

import { isGasTopUpEnabled, runGasTopUpCycle } from '@legion/core'

import { isTelegramConfigured, sendTelegramMessage } from '../lib/telegram.js'

const DEFAULT_CRON = '*/5 * * * *'

function resolveCronExpression(): string {
  const raw = process.env['GAS_TOPUP_CRON']?.trim()
  return raw && cron.validate(raw) ? raw : DEFAULT_CRON
}

let topUpCronTask: cron.ScheduledTask | null = null

export async function runGasTopUpCronTick(): Promise<void> {
  if (!isGasTopUpEnabled()) {
    console.info('[GAS_TOPUP] Disabled (GAS_TOPUP_ENABLED not true) — skip')
    return
  }

  console.info('[GAS_TOPUP] Cycle starting')
  const notify = isTelegramConfigured()
    ? async (message: string) => {
        await sendTelegramMessage(message)
      }
    : undefined

  const result = await runGasTopUpCycle(notify)
  for (const row of result.results) {
    const status = row.topped_up ? 'TOPPED_UP' : row.skipped_reason ?? row.error ?? 'ok'
    console.info(
      `[GAS_TOPUP] ${row.lane} ${row.execution_address || 'n/a'} ${row.balance_before} → ${status}`,
    )
  }
}

/** Schedule execution wallet gas top-ups (default every 5 minutes). */
export function startGasTopUpCron(): void {
  if (!isGasTopUpEnabled()) {
    console.info('[GAS_TOPUP] Not started — set GAS_TOPUP_ENABLED=true')
    return
  }
  if (topUpCronTask) {
    console.info('[GAS_TOPUP] Already scheduled')
    return
  }

  const expression = resolveCronExpression()
  topUpCronTask = cron.schedule(
    expression,
    () => {
      void runGasTopUpCronTick().catch((err) => {
        console.warn('[GAS_TOPUP] Run failed:', err instanceof Error ? err.message : String(err))
      })
    },
    { timezone: 'UTC' },
  )

  console.info(`[GAS_TOPUP] Scheduled (${expression} UTC)`)
  void runGasTopUpCronTick().catch((err) => {
    console.warn('[GAS_TOPUP] Initial run failed:', err instanceof Error ? err.message : String(err))
  })
}

export function stopGasTopUpCron(): void {
  if (topUpCronTask) {
    topUpCronTask.stop()
    topUpCronTask = null
    console.info('[GAS_TOPUP] Stopped')
  }
}
