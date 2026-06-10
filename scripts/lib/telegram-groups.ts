/**
 * Telegram group target resolution, membership checks, and join attempts.
 */
const TELEGRAM_API_BASE = 'https://api.telegram.org'

export type TelegramApiResponse<T> = {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
}

export type TelegramChat = {
  id: number
  type: string
  title?: string
  username?: string
}

export type TelegramChatMember = {
  status: string
  user?: { id: number; is_bot?: boolean }
}

export type ResolvedTarget = {
  raw: string
  chatId: string
  title?: string
  username?: string
}

export type JoinAttemptResult =
  | { status: 'member'; chatId: string; title?: string }
  | { status: 'skipped'; raw: string; reason: string }
  | { status: 'needs_manual'; chatId?: string; raw: string; reason: string }

async function telegramRequest<T>(
  token: string,
  method: string,
  params?: Record<string, string | number | boolean>,
): Promise<TelegramApiResponse<T>> {
  const url = new URL(`${TELEGRAM_API_BASE}/bot${token}/${method}`)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value))
    }
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  return (await res.json()) as TelegramApiResponse<T>
}

async function telegramPost<T>(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<TelegramApiResponse<T>> {
  const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  return (await res.json()) as TelegramApiResponse<T>
}

export function isNumericChatId(value: string): boolean {
  return /^-?\d+$/.test(value)
}

export function isPrivateInviteLink(value: string): boolean {
  return /t\.me\/\+|t\.me\/joinchat\//i.test(value)
}

export function normalizePublicHandle(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('@')) return trimmed
  const match = trimmed.match(/(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{5,})(?:\/)?$/i)
  if (match?.[1] && !match[1].startsWith('+')) return `@${match[1]}`
  return null
}

export async function getBotUserId(token: string): Promise<number> {
  const res = await telegramRequest<{ id: number }>(token, 'getMe')
  if (!res.ok || !res.result?.id) {
    throw new Error(res.description ?? 'getMe failed')
  }
  return res.result.id
}

export async function lookupChat(token: string, chatId: string): Promise<TelegramChat | null> {
  const res = await telegramRequest<TelegramChat>(token, 'getChat', { chat_id: chatId })
  if (!res.ok) {
    if (res.error_code === 400) return null
    throw new Error(res.description ?? `getChat failed for ${chatId}`)
  }
  return res.result ?? null
}

async function getChatMember(
  token: string,
  chatId: string,
  userId: number,
): Promise<TelegramChatMember | null> {
  const res = await telegramRequest<TelegramChatMember>(token, 'getChatMember', {
    chat_id: chatId,
    user_id: userId,
  })
  if (!res.ok) return null
  return res.result ?? null
}

export async function resolveTarget(token: string, rawLine: string): Promise<ResolvedTarget> {
  const raw = rawLine.trim()
  if (!raw) throw new Error('empty line')

  if (isNumericChatId(raw)) {
    const chat = await lookupChat(token, raw)
    return {
      raw,
      chatId: raw,
      title: chat?.title,
      username: chat?.username,
    }
  }

  if (isPrivateInviteLink(raw)) {
    throw new Error(
      'private invite link — Bot API cannot resolve t.me/+ links. Add the bot manually, then use numeric chat id',
    )
  }

  const handle = normalizePublicHandle(raw)
  if (handle) {
    const chat = await lookupChat(token, handle)
    if (!chat?.id) {
      throw new Error(`getChat returned no id for ${handle}`)
    }
    return {
      raw,
      chatId: String(chat.id),
      title: chat.title,
      username: chat.username,
    }
  }

  throw new Error(
    'unrecognized target — use numeric chat id, @username, or public https://t.me/handle URL',
  )
}

/**
 * Best-effort join check. Bot API cannot self-join via invite links — public groups
 * are resolved; private links are skipped; non-members get a manual-add notice.
 */
export async function attemptJoinGroup(
  token: string,
  rawLine: string,
  botUserId: number,
): Promise<JoinAttemptResult> {
  const raw = rawLine.trim()
  if (!raw) return { status: 'skipped', raw, reason: 'empty line' }

  if (isPrivateInviteLink(raw)) {
    return {
      status: 'skipped',
      raw,
      reason: 'private invite link — bot cannot auto-join; add bot manually and use numeric chat id',
    }
  }

  try {
    const target = await resolveTarget(token, raw)
    const member = await getChatMember(token, target.chatId, botUserId)
    const active =
      member?.status &&
      member.status !== 'left' &&
      member.status !== 'kicked' &&
      member.status !== 'restricted'

    if (active) {
      return { status: 'member', chatId: target.chatId, title: target.title }
    }

    return {
      status: 'needs_manual',
      chatId: target.chatId,
      raw,
      reason: `bot not in group (${target.title ?? target.username ?? target.chatId}) — add via group admin, then broadcast`,
    }
  } catch (e) {
    return {
      status: 'skipped',
      raw,
      reason: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function readGroupLines(filePath: string): Promise<string[]> {
  const { readFile } = await import('node:fs/promises')
  const text = await readFile(filePath, 'utf8')
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

export function parseTelegramChatIdsFromEnv(): string[] {
  const multi = process.env['TELEGRAM_CHAT_IDS']?.trim()
  if (multi) {
    return multi
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  }
  const single = process.env['TELEGRAM_CHAT_ID']?.trim()
  return single ? [single] : []
}

export async function loadGroupTargets(
  groupsFile: string,
): Promise<{ lines: string[]; source: 'groups.txt' | 'env' }> {
  try {
    const lines = await readGroupLines(groupsFile)
    if (lines.length > 0) return { lines, source: 'groups.txt' }
  } catch {
    /* fall through to env */
  }

  const envIds = parseTelegramChatIdsFromEnv()
  if (envIds.length > 0) {
    return { lines: envIds, source: 'env' }
  }

  return { lines: [], source: 'groups.txt' }
}

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<{ ok: boolean; detail?: string }> {
  const res = await telegramPost<{ message_id: number }>(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: false,
  })
  if (!res.ok) {
    return { ok: false, detail: res.description ?? 'sendMessage failed' }
  }
  return { ok: true }
}
