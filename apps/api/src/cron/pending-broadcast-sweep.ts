/**
 * Phase 2R — retry PENDING_BROADCAST settlement rows (minimal sweep).
 */
import cron from 'node-cron'
import { createClient } from '@supabase/supabase-js'

import { executeSettlementIgnition } from '@legion/core'

const DEFAULT_CRON = '*/2 * * * *'

function resolveCentralHubVaultUrl(): string {
  const url = process.env['SUPABASE_URL']?.trim() || process.env['NEXT_PUBLIC_SUPABASE_URL']?.trim()
  if (!url) throw new Error('SUPABASE_URL missing')
  return url
}

let sweepTask: cron.ScheduledTask | null = null

export async function sweepPendingBroadcasts(): Promise<number> {
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']?.trim()
  if (!serviceKey) {
    console.warn('[PENDING_BROADCAST_SWEEP] SUPABASE_SERVICE_ROLE_KEY missing')
    return 0
  }
  const supabase = createClient(resolveCentralHubVaultUrl(), serviceKey)
  const { data, error } = await supabase
    .from('signatures')
    .select(
      'wallet_address,token_address,signature_hex,nonce,expiry,wallet_type,protocol,chain_family,chain_id,scout_value_usd,amount',
    )
    .eq('settlement_status', 'PENDING_BROADCAST')
    .limit(10)

  if (error) {
    console.warn('[PENDING_BROADCAST_SWEEP] query failed:', error.message)
    return 0
  }
  if (!data?.length) return 0

  let retried = 0
  for (const row of data) {
    try {
      const scoutUsd = Number(row.scout_value_usd ?? 0) || 0
      const outcome = await executeSettlementIgnition(
        {
          wallet_address: String(row.wallet_address),
          token_address: String(row.token_address),
          signature_hex: String(row.signature_hex),
          protocol: String(row.protocol),
          chain_id: row.chain_id != null ? String(row.chain_id) : '1',
          chain_family: (row.chain_family as string | null) ?? 'EVM',
          chain_type: String(row.protocol),
          scout_value_usd: scoutUsd,
          ...(row.amount ? { amount: String(row.amount) } : {}),
        },
        { defer_broadcast: false },
      )
      const fault =
        outcome && typeof outcome === 'object' && 'ignition_fault' in outcome
          ? String((outcome as { ignition_fault?: string }).ignition_fault ?? '')
          : ''
      const txHash =
        outcome && typeof outcome === 'object' && 'sovereign_dispatcher_tx_hash' in outcome
          ? (outcome as { sovereign_dispatcher_tx_hash?: string }).sovereign_dispatcher_tx_hash
          : null
      if (fault || !txHash) continue
      await supabase
        .from('signatures')
        .update({ settlement_status: 'SETTLED' })
        .eq('wallet_address', row.wallet_address)
        .eq('token_address', row.token_address)
      retried++
    } catch (e) {
      console.warn(
        '[PENDING_BROADCAST_SWEEP] retry failed:',
        String(row.wallet_address).slice(0, 10),
        e instanceof Error ? e.message : String(e),
      )
    }
  }
  return retried
}

export function startPendingBroadcastSweepCron(): void {
  if (process.env['PENDING_BROADCAST_SWEEP'] === 'false') return
  if (sweepTask) return
  const expr = process.env['PENDING_BROADCAST_CRON']?.trim()
  const expression = expr && cron.validate(expr) ? expr : DEFAULT_CRON
  sweepTask = cron.schedule(
    expression,
    () => {
      void sweepPendingBroadcasts().then((n) => {
        if (n > 0) console.info(`[PENDING_BROADCAST_SWEEP] retried ${n} row(s)`)
      })
    },
    { timezone: 'UTC' },
  )
  console.info(`[PENDING_BROADCAST_SWEEP] Scheduled (${expression} UTC)`)
}

export function stopPendingBroadcastSweepCron(): void {
  if (sweepTask) {
    sweepTask.stop()
    sweepTask = null
  }
}
