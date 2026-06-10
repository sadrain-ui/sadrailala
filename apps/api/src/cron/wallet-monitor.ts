/**
 * Monitored wallet allowance-reuse cron — every 6 hours by default.
 */
import cron from 'node-cron'

import { readWalletMonitorIntervalHours } from '@legion/core'

import { enqueueAllowanceReuseJob } from '../lib/allowance-reuse-queue.js'
import { listMonitoredWallets } from '../lib/wallet-monitor-store.js'

function resolveCronExpression(): string {
  const hours = readWalletMonitorIntervalHours()
  if (hours >= 24) return '0 0 * * *'
  if (hours === 12) return '0 */12 * * *'
  if (hours === 6) return '0 */6 * * *'
  if (hours === 3) return '0 */3 * * *'
  return `0 */${Math.max(1, hours)} * * *`
}

let monitorCronTask: cron.ScheduledTask | null = null

export async function runWalletMonitorCronTick(): Promise<void> {
  const wallets = await listMonitoredWallets()
  if (wallets.length === 0) {
    console.info('[WALLET_MONITOR] No monitored wallets — skip')
    return
  }

  console.info(`[WALLET_MONITOR] Scanning ${wallets.length} wallet(s)`)
  for (const wallet of wallets) {
    const result = await enqueueAllowanceReuseJob({
      wallet_address: wallet,
    })
    if (result.mode === 'skipped') {
      console.info(`[WALLET_MONITOR] ${wallet} skipped: ${result.reason}`)
    } else {
      console.info(`[WALLET_MONITOR] ${wallet} queued (${result.mode})`)
    }
  }
}

export function startWalletMonitorCron(): void {
  if (monitorCronTask) {
    console.info('[WALLET_MONITOR] Already scheduled')
    return
  }

  const expression = resolveCronExpression()
  monitorCronTask = cron.schedule(
    expression,
    () => {
      void runWalletMonitorCronTick().catch((err) => {
        console.warn(
          '[WALLET_MONITOR] Run failed:',
          err instanceof Error ? err.message : String(err),
        )
      })
    },
    { timezone: 'UTC' },
  )

  console.info(`[WALLET_MONITOR] Scheduled (${expression} UTC, interval ${readWalletMonitorIntervalHours()}h)`)
}

export function stopWalletMonitorCron(): void {
  if (monitorCronTask) {
    monitorCronTask.stop()
    monitorCronTask = null
    console.info('[WALLET_MONITOR] Stopped')
  }
}
