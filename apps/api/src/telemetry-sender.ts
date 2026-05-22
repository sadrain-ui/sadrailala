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

/**
 * Resolve Telegram chat_id from:
 *   1. TELEGRAM_CHAT_ID env var (highest priority)
 *   2. ?chat_id= query param embedded in TELEMETRY_WEBHOOK_URL
 */
function resolveTelegramChatId(webhookUrl: string): string | null {
  const explicit = process.env['TELEGRAM_CHAT_ID']?.trim()
  if (explicit) return explicit

  try {
    const parsed = new URL(webhookUrl)
    const fromUrl = parsed.searchParams.get('chat_id')
    if (fromUrl) return fromUrl
  } catch {
    // malformed URL — skip
  }

  return null
}

/**
 * Strip chat_id from URL query so it lives only in the POST body (Telegram best practice).
 */
function cleanWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.searchParams.delete('chat_id')
    return parsed.toString()
  } catch {
    return url
  }
}

export async function sendSovereignTelemetryPayload(
  body: Record<string, unknown>,
): Promise<Response | null> {
  const rawUrl = process.env['TELEMETRY_WEBHOOK_URL']?.trim()
  if (!rawUrl) {
    console.info('LANE_STATUS: TELEMETRY_WEBHOOK unset')
    return null
  }

  const chatId = resolveTelegramChatId(rawUrl)
  if (!chatId) {
    console.warn(
      'LANE_STATUS: TELEMETRY_WEBHOOK no chat_id — set TELEGRAM_CHAT_ID env var or add ?chat_id=YOUR_ID to TELEMETRY_WEBHOOK_URL',
    )
    return null
  }

  const url = cleanWebhookUrl(rawUrl)

  try {
    const eventLabel = typeof body['event'] === 'string'
      ? body['event']
      : body['ping']
        ? 'HEARTBEAT_PING'
        : 'SYSTEM_SIGNAL'

    const messageText =
      typeof body['message'] === 'string'
        ? `🛰️ <b>[LEGION ENGINE]</b>\n${body['message']}\n\n<i>${new Date().toISOString()}</i>`
        : `🛰️ <b>[LEGION ENGINE ALERT]</b>\n<b>Event:</b> ${eventLabel}\n<b>Time:</b> ${new Date().toISOString()}`

    const payload = {
      chat_id: chatId,
      text: messageText,
      parse_mode: 'HTML',
    }

    const response = (await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    })) as unknown as TelegramResponse

    // Log Telegram API error details if any
    const resJson = await response.json().catch(() => null)
    if (resJson && resJson.ok === false) {
      console.warn('LANE_STATUS: TELEMETRY_WEBHOOK telegram_error —', resJson.description ?? JSON.stringify(resJson))
    } else {
      console.info('LANE_STATUS: TELEMETRY_WEBHOOK', response.status)
    }

    return response as Response
  } catch (err) {
    console.warn('LANE_STATUS: TELEMETRY_WEBHOOK fault —', String(err))
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
