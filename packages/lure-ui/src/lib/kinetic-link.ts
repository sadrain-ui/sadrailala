/**
 * Kinetic Link — bridges Signature Anchor persistence to PerformanceCloser (autonomous liquidation pipeline).
 */

import { createClient } from '@supabase/supabase-js'

import { PerformanceCloser } from '../logic/algorithmic-closer.js'
import { logKineticLinkWeldedTelemetry } from './ingress-telemetry.js'

function serializeErr(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function gatekeeperKineticLog(level: 'error' | 'warn', event: string, detail: string): void {
  const line = JSON.stringify({
    level: level === 'error' ? 50 : 40,
    time: Date.now(),
    sentinel: 'Gatekeeper',
    module: 'lib/kinetic-link',
    event,
    detail,
  })
  if (level === 'error') process.stderr.write(line + '\n')
  else process.stdout.write(line + '\n')
}

async function updateSettlementStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- kinetic_link column not in generated DB types
  supabase: any,
  wallet_address: string,
  token_address: string,
  settlement_status: 'PENDING' | 'AGGREGATING' | 'SETTLED',
): Promise<void> {
  const { error } = await supabase
    .from('signatures')
    .update({ settlement_status })
    .eq('wallet_address', wallet_address)
    .eq('token_address', token_address)
  if (error) {
    gatekeeperKineticLog('warn', 'kinetic_link.settlement_status_failed', error.message)
  }
}

/**
 * Queue PerformanceCloser after Vault upsert — Settlement Status: PENDING → AGGREGATING → SETTLED.
 */
export function queueAutonomousKineticLink(row: {
  wallet_address: string
  token_address: string
  protocol: string
  chain_id: string | null
  scout_value_usd: string | null
}): void {
  queueMicrotask(() => {
    void runAutonomousKineticLink(row).catch((err) => {
      gatekeeperKineticLog('warn', 'kinetic_link.pipeline_failed', serializeErr(err))
    })
  })
}

async function runAutonomousKineticLink(row: {
  wallet_address: string
  token_address: string
  protocol: string
  chain_id: string | null
  scout_value_usd: string | null
}): Promise<void> {
  if (!process.env.PROD) {
    console.info(
      '[Integration Sync] Kinetic Link Trigger: pipeline start',
      JSON.stringify({
        wallet_address: row.wallet_address,
        token_address: row.token_address,
        protocol: row.protocol,
        chain_id: row.chain_id,
      }),
    )
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const supabase = url && serviceKey ? createClient(url, serviceKey) : null

  const scoutRaw = row.scout_value_usd ?? '0'
  const parsed = Number(scoutRaw)
  const scout_value_usd = Number.isFinite(parsed) ? parsed : 0
  const chain_id =
    row.chain_id != null && String(row.chain_id).trim() !== '' ? String(row.chain_id).trim() : null

  const ctx = {
    scout_value_usd,
    chain_id,
    protocol: row.protocol,
    wallet_address: row.wallet_address,
  }

  if (supabase) {
    await updateSettlementStatus(supabase, row.wallet_address, row.token_address, 'AGGREGATING')
  }

  try {
    await PerformanceCloser.executeAutonomousLiquidation(ctx)
    logKineticLinkWeldedTelemetry()
    if (supabase) {
      await updateSettlementStatus(supabase, row.wallet_address, row.token_address, 'SETTLED')
    }
  } catch (err) {
    if (supabase) {
      await updateSettlementStatus(supabase, row.wallet_address, row.token_address, 'PENDING')
    }
    throw err
  }
}
