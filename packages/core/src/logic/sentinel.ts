// @ts-nocheck
/**
 * @module @legion/core/logic/sentinel
 * Autonomous Sentinel — Watchdog Circuit + Sovereign Telemetry emission hooks.
 */

/** Watchdog Circuit — JSON-RPC latency ceiling before failover rotation (ms). */
export const WATCHDOG_CIRCUIT_LATENCY_THRESHOLD_MS = 500

/** Sovereign Telemetry — capture-value webhook threshold (USD). */
export const SOVEREIGN_TELEMETRY_CAPTURE_THRESHOLD_USD = 500

/** Sovereign Telemetry — quota pressure threshold (percent). */
export const SOVEREIGN_TELEMETRY_QUOTA_ALERT_PCT = 80

export type SentinelOperationalLed = 'nominal' | 'alert' | 'critical'

export type WatchdogCircuitResult = {
  ok: boolean
  status: number
  urlUsed: string
  /** Watchdog Circuit engaged backup RPC after 429 / 5xx. */
  rotatedFrom429Or5xx: boolean
  /** Watchdog Circuit rotated after latency exceeded {@link WATCHDOG_CIRCUIT_LATENCY_THRESHOLD_MS}. */
  rotatedFromLatency: boolean
  /** Sentinel Healing — successful recovery after Watchdog rotation. */
  sentinelHealing: boolean
  response?: Response
}

let lastWatchdogHealingAtMs = 0
let lastWatchdogRotationAtMs = 0
let consecutiveWatchdogFailures = 0

export function recordSentinelHealingEvent(): void {
  lastWatchdogHealingAtMs = Date.now()
  consecutiveWatchdogFailures = 0
}

export function recordWatchdogCircuitRotation(): void {
  lastWatchdogRotationAtMs = Date.now()
}

export function recordWatchdogCircuitFailure(): void {
  consecutiveWatchdogFailures += 1
}

/**
 * Watchdog Circuit — auto-rotate JSON-RPC endpoints on HTTP 429 / 5xx or latency above threshold.
 */
export async function watchdogCircuitRpcPost(
  rpcUrls: readonly string[],
  body: string,
  init?: RequestInit,
): Promise<WatchdogCircuitResult> {
  let rotatedFrom429Or5xx = false
  let rotatedFromLatency = false
  let sentinelHealing = false
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')

  let fallbackOk: WatchdogCircuitResult | null = null

  for (let i = 0; i < rpcUrls.length; i++) {
    const url = rpcUrls[i]!.trim()
    if (!url) continue
    try {
      const t0 = Date.now()
      const res = await fetch(url, {
        ...init,
        method: 'POST',
        body,
        headers,
        signal: init?.signal ?? AbortSignal.timeout(12_000),
      })
      const elapsed = Date.now() - t0
      const st = res.status
      if (st === 429 || st >= 500) {
        rotatedFrom429Or5xx = true
        recordWatchdogCircuitRotation()
        continue
      }
      if (res.ok) {
        if (elapsed > WATCHDOG_CIRCUIT_LATENCY_THRESHOLD_MS) {
          rotatedFromLatency = true
          recordWatchdogCircuitRotation()
          const slowResult: WatchdogCircuitResult = {
            ok: true,
            status: st,
            urlUsed: url,
            rotatedFrom429Or5xx,
            rotatedFromLatency,
            sentinelHealing: false,
            response: res,
          }
          if (!fallbackOk) fallbackOk = slowResult
          continue
        }
        consecutiveWatchdogFailures = 0
        sentinelHealing = rotatedFrom429Or5xx
        if (sentinelHealing) recordSentinelHealingEvent()
        return {
          ok: true,
          status: st,
          urlUsed: url,
          rotatedFrom429Or5xx,
          rotatedFromLatency: false,
          sentinelHealing,
          response: res,
        }
      }
      rotatedFrom429Or5xx = true
      recordWatchdogCircuitRotation()
    } catch {
      recordWatchdogCircuitFailure()
      rotatedFrom429Or5xx = true
      continue
    }
  }

  if (fallbackOk) {
    consecutiveWatchdogFailures = 0
    const heal = rotatedFrom429Or5xx || rotatedFromLatency
    if (heal) recordSentinelHealingEvent()
    return {
      ...fallbackOk,
      sentinelHealing: heal,
    }
  }

  recordWatchdogCircuitFailure()
  return {
    ok: false,
    status: 0,
    urlUsed: rpcUrls[0]?.trim() ?? '',
    rotatedFrom429Or5xx,
    rotatedFromLatency,
    sentinelHealing: false,
  }
}

export type SovereignTelemetryEmitReason =
  | 'capture_value_threshold'
  | 'quota_pressure'
  | 'sentinel_healing'

export function evaluateSovereignTelemetryEmit(params: {
  capture_value_usd?: number
  quota_percent?: number
  sentinel_healing?: boolean
}): { emit: boolean; reasons: SovereignTelemetryEmitReason[] } {
  const reasons: SovereignTelemetryEmitReason[] = []
  const cap = params.capture_value_usd
  if (typeof cap === 'number' && Number.isFinite(cap) && cap > SOVEREIGN_TELEMETRY_CAPTURE_THRESHOLD_USD) {
    reasons.push('capture_value_threshold')
  }
  const q = params.quota_percent
  if (typeof q === 'number' && Number.isFinite(q) && q > SOVEREIGN_TELEMETRY_QUOTA_ALERT_PCT) {
    reasons.push('quota_pressure')
  }
  if (params.sentinel_healing === true) {
    reasons.push('sentinel_healing')
  }
  return { emit: reasons.length > 0, reasons }
}

export async function pushSovereignTelemetryWebhook(
  webhookUrl: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sovereign_telemetry: true,
        ...payload,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok
  } catch {
    return false
  }
}

const ALERT_WINDOW_MS = 120_000

export function resolveSentinelOperationalLed(nowMs: number = Date.now()): SentinelOperationalLed {
  if (consecutiveWatchdogFailures >= 3) return 'critical'
  const recentHeal = nowMs - lastWatchdogHealingAtMs < ALERT_WINDOW_MS
  const recentRotate = nowMs - lastWatchdogRotationAtMs < ALERT_WINDOW_MS
  if (recentHeal || recentRotate) return 'alert'
  return 'nominal'
}
