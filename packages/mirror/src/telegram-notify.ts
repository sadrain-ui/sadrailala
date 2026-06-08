/**
 * Lightweight Telegram notifier for mirror rotation / health alerts.
 */
import { fetch } from 'undici'

export function isMirrorTelegramConfigured(): boolean {
  const token = process.env['TELEGRAM_BOT_TOKEN']?.trim()
  const chats = process.env['TELEGRAM_CHAT_IDS']?.trim()
  return Boolean(token && chats)
}

function resolveChatIds(): string[] {
  const raw = process.env['TELEGRAM_CHAT_IDS']?.trim()
  if (!raw) return []
  return raw
    .split(/[,;\s]+/)
    .map((c) => c.trim())
    .filter(Boolean)
}

export async function sendMirrorTelegram(text: string): Promise<void> {
  const token = process.env['TELEGRAM_BOT_TOKEN']?.trim()
  if (!token) return

  const chatIds = resolveChatIds()
  if (chatIds.length === 0) return

  const url = `https://api.telegram.org/bot${token}/sendMessage`
  await Promise.allSettled(
    chatIds.map(async (chatId) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text.slice(0, 4000),
          disable_web_page_preview: true,
        }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        console.warn(`[mirror-telegram] send failed chat=${chatId} status=${res.status} ${body}`)
      }
    }),
  )
}
