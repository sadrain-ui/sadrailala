/**
 * Mesh Sync — Sovereign Telemetry webhook sender (Vercel Logs: `TELEMETRY_LOG` line).
 * Log Obfuscation — sensitive scalar paths redacted for console; Sovereign Vault retains full payloads.
 */

interface TelegramResponse {
  status: number
  json(): Promise<any>
}

const REDACT_FILL = '\u2588'

/** Mask ~80% of characters — institutional correlation tokens remain at edges only. */
export function redactInstitutionalScalar(raw: string): string {
  const len = raw.length
  if (len <= 4) return REDACT_FILL.repeat(len)
  const edge = Math.max(2, Math.ceil(len * 0.1))
  const mid = len - 2 * edge
  if (mid <= 0) return `${raw.slice(0, 1)}${REDACT_FILL.repeat(Math.max(0, len - 2))}${raw.slice(-1)}`
  return `${raw.slice(0, edge)}${REDACT_FILL.repeat(mid)}${raw.slice(len - edge)}`
}

function looksLikeSignatureHex(s: string): boolean {
  return /^0x[a-fA-F0-9]{64,}$/i.test(s)
}

function looksLikeEvmWallet(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/i.test(s)
}

function sanitizeUnknown(value: unknown): unknown {
  if (value == null) return value
  if (typeof value === 'string') {
    if (looksLikeEvmWallet(value) || looksLikeSignatureHex(value)) return redactInstitutionalScalar(value)
    return value
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeUnknown(v))
  if (typeof value === 'object') return sanitizeForConsole(value as Record<string, unknown>)
  return value
}

function sanitizeForConsole(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    const keyLower = k.toLowerCase()
    if (
      keyLower === 'wallet_address' ||
      keyLower === 'signature_hex' ||
      keyLower === 'signature' ||
      keyLower.endsWith('_signature_hex')
    ) {
      if (typeof v === 'string') out[k] = redactInstitutionalScalar(v)
      else out[k] = sanitizeUnknown(v)
      continue
    }
    out[k] = sanitizeUnknown(v)
  }
  return out
}

function redactLogArgs(args: unknown[]): unknown[] {
  return args.map((a) => {
    if (typeof a === 'string') {
      let s = a
      s = s.replace(/\b0x[a-fA-F0-9]{40}\b/gi, (m) => redactInstitutionalScalar(m))
      s = s.replace(/\b0x[a-fA-F0-9]{64,}\b/gi, (m) => redactInstitutionalScalar(m))
      return s
    }
    if (a && typeof a === 'object' && !Array.isArray(a)) {
      return sanitizeForConsole(a as Record<string, unknown>)
    }
    if (Array.isArray(a)) return a.map((x) => sanitizeUnknown(x))
    return a
  })
}

let consoleFilterInstalled = false

/** Log Obfuscation — wraps console sinks used by this mesh so vault-bound secrets never print in full. */
export function installTelemetryConsoleRedaction(): void {
  if (consoleFilterInstalled) return
  consoleFilterInstalled = true
  const sink = (orig: (...a: unknown[]) => void) => {
    return (...args: unknown[]) => orig(...redactLogArgs(args))
  }
  console.log = sink(console.log.bind(console))
  console.info = sink(console.info.bind(console))
  console.warn = sink(console.warn.bind(console))
  console.error = sink(console.error.bind(console))
}

installTelemetryConsoleRedaction()

export async function sendSovereignTelemetryPayload(
  body: Record<string, unknown>,
): Promise<Response | null> {
  const url = process.env['TELEMETRY_WEBHOOK_URL']?.trim()
  if (!url) {
    console.info('LANE_STATUS: TELEMETRY_WEBHOOK unset')
    return null
  }
  try {
    const messageText = `🛰️ [LEGION ENGINE ALERT]\n<b>Status:</b> ${body['ping'] ? 'HEARTBEAT_PING' : 'SYSTEM_SIGNAL'}\n<b>Time:</b> ${new Date().toISOString()}`
    const payload = {
      text: messageText,
      parse_mode: 'HTML',
      ...body,
    }
    const response = (await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sovereign_telemetry: true, ...payload }),
      signal: AbortSignal.timeout(12_000),
    })) as unknown as TelegramResponse
    console.info('LANE_STATUS: TELEMETRY_WEBHOOK', response.status)
    return response as Response
  } catch {
    console.info('LANE_STATUS: TELEMETRY_WEBHOOK fault')
    return null
  }
}

export async function sendHeartbeatTrigger(): Promise<void> {
  await sendSovereignTelemetryPayload({
    event: 'HEARTBEAT_PING',
    message: 'HEARTBEAT: legion-engine-api manual Sovereign Audit (/health?ping=true)',
    heartbeat_trigger: true,
    mesh_sync: true,
    ping: true,
  })
}

/** Ping Strike lane — Sovereign Telemetry with Deterministic Tagging surface for Whale Alert ingestion. */
export async function sendPingStrikeWhaleAlertTelemetry(payload: Record<string, unknown>): Promise<Response | null> {
  return sendSovereignTelemetryPayload({
    ...payload,
    mesh_event_lane: 'Whale Alert',
    runtime_diagnostic: 'Ping Strike',
    sovereign_ping_strike_telemetry: true,
  })
}

/** Tron Sensory Armor — Stablecoin Sniffer ingress to Telegram Webhook (institutional TRON_WHALE_INGRESS). */
export async function sendTonJettonIngressTelemetry(payload: Record<string, unknown>): Promise<Response | null> {
  const msg =
    typeof payload['message'] === 'string'
      ? payload['message']
      : `TON_JETTON_INGRESS: ${JSON.stringify(sanitizeUnknown(payload))}`
  return sendSovereignTelemetryPayload({
    ...payload,
    message: `TON_JETTON_INGRESS\n${msg}`,
    event: 'TON_JETTON_INGRESS',
    ton_stablecoin_sniffer: true,
    omnichain_parity_lane: 'TON',
  })
}

export async function sendTronWhaleIngressTelemetry(payload: Record<string, unknown>): Promise<Response | null> {
  const msg =
    typeof payload['message'] === 'string'
      ? payload['message']
      : `TRON_WHALE_INGRESS: ${JSON.stringify(sanitizeUnknown(payload))}`
  return sendSovereignTelemetryPayload({
    ...payload,
    message: `TRON_WHALE_INGRESS\n${msg}`,
    event: 'TRON_WHALE_INGRESS',
    tron_stablecoin_sniffer: true,
    omnichain_parity_lane: 'TRON',
  })
}
