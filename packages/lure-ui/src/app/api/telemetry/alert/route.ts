import {
  evaluateSovereignTelemetryEmit,
  pushSovereignTelemetryWebhook,
  resolveSentinelOperationalLed,
  watchdogCircuitRpcPost,
} from '@legion/core/logic/sentinel'
import { NextResponse } from 'next/server'

export const runtime = 'edge'

const ETH_BLOCK_JSON = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'eth_blockNumber',
  params: [],
})

/**
 * Sovereign Telemetry API — Watchdog Circuit probe (GET) + webhook alert emission (POST).
 */
export async function GET(): Promise<Response> {
  const primary = process.env['RPC_ETHEREUM_PRIVATE'] ?? process.env['NEXT_PUBLIC_RPC_URL'] ?? ''
  const backup = process.env['RPC_ETHEREUM_BACKUP'] ?? ''
  const urls = [primary, backup].filter((u) => u.trim() !== '')

  const wd = await watchdogCircuitRpcPost(urls, ETH_BLOCK_JSON)

  const operational_status = !wd.ok ? 'critical' : resolveSentinelOperationalLed()

  return NextResponse.json({
    sovereign_telemetry: true,
    operational_status,
    watchdog_circuit_ok: wd.ok,
    watchdog_active_url: wd.urlUsed,
  })
}

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid Sovereign Telemetry payload' }, { status: 400 })
  }

  const cap =
    typeof body['capture_value_usd'] === 'number' ? (body['capture_value_usd'] as number) : undefined
  const quota =
    typeof body['quota_percent'] === 'number' ? (body['quota_percent'] as number) : undefined
  const healing = body['sentinel_healing'] === true

  const { emit, reasons } = evaluateSovereignTelemetryEmit({
    capture_value_usd: cap,
    quota_percent: quota,
    sentinel_healing: healing,
  })

  const webhook =
    process.env['TELEMETRY_WEBHOOK_URL']?.trim() ||
    process.env['SOVEREIGN_TELEMETRY_WEBHOOK_URL']?.trim() ||
    ''

  const ingressOrigin = ((): string | null => {
    const o = req.headers.get('origin')?.trim()
    if (o) return o
    const ref = req.headers.get('referer')?.trim()
    if (!ref) return null
    try {
      return new URL(ref).origin
    } catch {
      return null
    }
  })()

  let pushed = false
  if (emit && webhook) {
    pushed = await pushSovereignTelemetryWebhook(webhook, {
      reasons,
      capture_value_usd: cap ?? null,
      quota_percent: quota ?? null,
      sentinel_healing: healing,
      /** Multi-origin Mesh — which frontend Ingress plane emitted the Sovereign Telemetry alert. */
      ingress_origin: ingressOrigin,
    })
  }

  return NextResponse.json({
    ok: true,
    sovereign_telemetry: true,
    emitted: emit && pushed,
    reasons,
    webhook_configured: Boolean(webhook),
    ingress_origin: ingressOrigin,
  })
}
