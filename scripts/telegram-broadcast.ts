/**
 * Telegram group broadcast — authorized red-team exercise tooling.
 *
 * Reads group targets from groups.txt, resolves public handles via getChat,
 * and posts a customizable message with 1 msg / 2s rate limiting.
 *
 * Usage:
 *   pnpm tg-broadcast
 *   pnpm tg-broadcast -- --dry-run
 *   pnpm tg-broadcast -- --message "Hello from Legion exercise"
 *   pnpm tg-broadcast -- --message-file broadcast.txt --resolve-only
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

const DEFAULT_GROUPS_FILE = path.join(REPO_ROOT, 'groups.txt')
const DEFAULT_MESSAGE_FILE = path.join(REPO_ROOT, 'message.txt')
const DEFAULT_RATE_MS = 2_000
const TELEGRAM_API_BASE = 'https://api.telegram.org'

type TelegramApiResponse<T> = {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
}

type TelegramChat = {
  id: number
  type: string
  title?: string
  username?: string
}

type ResolvedTarget = {
  raw: string
  chatId: string
  title?: string
  username?: string
}

type CliOptions = {
  dryRun: boolean
  resolveOnly: boolean
  groupsFile: string
  message?: string
  messageFile?: string
  rateMs: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dryRun: false,
    resolveOnly: false,
    groupsFile: DEFAULT_GROUPS_FILE,
    rateMs: DEFAULT_RATE_MS,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') {
      opts.dryRun = true
      continue
    }
    if (arg === '--resolve-only') {
      opts.resolveOnly = true
      continue
    }
    if (arg === '--groups-file' && argv[i + 1]) {
      opts.groupsFile = path.resolve(argv[++i]!)
      continue
    }
    if (arg === '--message' && argv[i + 1]) {
      opts.message = argv[++i]
      continue
    }
    if (arg === '--message-file' && argv[i + 1]) {
      opts.messageFile = path.resolve(argv[++i]!)
      continue
    }
    if (arg === '--rate-ms' && argv[i + 1]) {
      const n = Number(argv[++i])
      if (Number.isFinite(n) && n >= 500) opts.rateMs = Math.trunc(n)
      continue
    }
    if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
  }

  return opts
}

function printHelp(): void {
  console.log(`
Legion Telegram Broadcast (authorized red-team exercises only)

Usage:
  pnpm tg-broadcast [options]

Options:
  --dry-run              Resolve targets and print plan without sending
  --resolve-only         Resolve chat IDs only (no message send)
  --groups-file <path>   Target list (default: groups.txt)
  --message <text>       Inline message body
  --message-file <path>  Message file (default: message.txt if --message omitted)
  --rate-ms <n>          Delay between sends (default: 2000)
  -h, --help             Show this help

Environment:
  TELEGRAM_BOT_TOKEN     Required — bot token from @BotFather

groups.txt format (one target per line, # comments allowed):
  -1001234567890                 numeric supergroup/chat id
  @public_group_handle           public group username
  https://t.me/public_group      public invite URL (non-private)
  https://t.me/+PrivateHash      private link — bot must already be a member;
                                 replace with numeric id after joining

Private + invite links cannot be resolved via getChat alone. Add the bot to the
group first, then copy the chat id from a getUpdates payload or Bot API logs.
`.trim())
}

function resolveBotToken(): string {
  const token = process.env['TELEGRAM_BOT_TOKEN']?.trim()
  if (!token) {
    console.error(
      'TELEGRAM_BOT_TOKEN is not set. Add it to .env or pass via --env-file=.env',
    )
    process.exit(1)
  }
  return token
}

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
  const json = (await res.json()) as TelegramApiResponse<T>
  return json
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

function isNumericChatId(value: string): boolean {
  return /^-?\d+$/.test(value)
}

function isPrivateInviteLink(value: string): boolean {
  return /t\.me\/\+|t\.me\/joinchat\//i.test(value)
}

function normalizePublicHandle(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('@')) return trimmed
  const match = trimmed.match(/(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{5,})(?:\/)?$/i)
  if (match?.[1] && !match[1].startsWith('+')) return `@${match[1]}`
  return null
}

async function resolveTarget(token: string, rawLine: string): Promise<ResolvedTarget> {
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
      'private invite link — getChat cannot resolve t.me/+ links. Add the bot to the group and use the numeric chat id (e.g. -100…)',
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

async function lookupChat(token: string, chatId: string): Promise<TelegramChat | null> {
  const res = await telegramRequest<TelegramChat>(token, 'getChat', { chat_id: chatId })
  if (!res.ok) {
    if (res.error_code === 400) return null
    throw new Error(res.description ?? `getChat failed for ${chatId}`)
  }
  return res.result ?? null
}

async function readLines(filePath: string): Promise<string[]> {
  const text = await readFile(filePath, 'utf8')
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

async function loadMessage(opts: CliOptions): Promise<string> {
  if (opts.message?.trim()) return opts.message.trim()

  const messagePath = opts.messageFile ?? DEFAULT_MESSAGE_FILE
  try {
    const text = await readFile(messagePath, 'utf8')
    const trimmed = text.trim()
    if (!trimmed) throw new Error('message file is empty')
    return trimmed
  } catch (e) {
    if (opts.messageFile) {
      throw new Error(
        `Could not read message file ${messagePath}: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    throw new Error(
      'No message provided. Use --message, --message-file, or create message.txt in repo root.',
    )
  }
}

async function sendMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<{ ok: boolean; detail?: string }> {
  const res = await telegramPost<{ message_id: number }>(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  })
  if (!res.ok) {
    return { ok: false, detail: res.description ?? 'sendMessage failed' }
  }
  return { ok: true }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const token = resolveBotToken()

  let groupLines: string[]
  try {
    groupLines = await readLines(opts.groupsFile)
  } catch (e) {
    console.error(
      `Could not read groups file ${opts.groupsFile}: ${e instanceof Error ? e.message : String(e)}`,
    )
    console.error('Create groups.txt (see groups.txt.example) with one target per line.')
    process.exit(1)
  }

  if (groupLines.length === 0) {
    console.error(`No targets in ${opts.groupsFile}`)
    process.exit(1)
  }

  console.log(`Targets: ${groupLines.length} line(s) from ${opts.groupsFile}`)
  console.log(`Rate limit: 1 message / ${opts.rateMs}ms`)
  if (opts.dryRun) console.log('Mode: DRY RUN')
  if (opts.resolveOnly) console.log('Mode: RESOLVE ONLY')

  const resolved: ResolvedTarget[] = []
  const failures: Array<{ raw: string; error: string }> = []

  for (const line of groupLines) {
    try {
      const target = await resolveTarget(token, line)
      resolved.push(target)
      const label = target.title ?? target.username ?? target.chatId
      console.log(`✓ ${line} → ${target.chatId} (${label})`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      failures.push({ raw: line, error: msg })
      console.warn(`✗ ${line} — ${msg}`)
    }
    await sleep(350)
  }

  if (failures.length > 0) {
    console.warn(`\n${failures.length} target(s) could not be resolved.`)
  }

  if (resolved.length === 0) {
    console.error('No resolvable targets — fix groups.txt and retry.')
    process.exit(1)
  }

  if (opts.resolveOnly) {
    console.log('\nResolved chat IDs:')
    for (const t of resolved) {
      console.log(`  ${t.chatId}\t# ${t.raw}`)
    }
    process.exit(failures.length > 0 ? 1 : 0)
  }

  const message = await loadMessage(opts)
  console.log(`\nMessage preview (${message.length} chars):\n${message.slice(0, 200)}${message.length > 200 ? '…' : ''}\n`)

  if (opts.dryRun) {
    console.log('Dry run — would send to:')
    for (const t of resolved) {
      console.log(`  ${t.chatId} (${t.title ?? t.username ?? t.raw})`)
    }
    process.exit(failures.length > 0 ? 1 : 0)
  }

  let sent = 0
  let failed = 0

  for (let i = 0; i < resolved.length; i++) {
    const target = resolved[i]!
    if (i > 0) await sleep(opts.rateMs)

    const result = await sendMessage(token, target.chatId, message)
    if (result.ok) {
      sent++
      console.log(`✅ Sent to ${target.chatId} (${target.title ?? target.username ?? target.raw})`)
    } else {
      failed++
      console.error(
        `❌ Failed ${target.chatId} (${target.raw}): ${result.detail ?? 'unknown error'}`,
      )
    }
  }

  console.log(`\nDone — sent: ${sent}, failed: ${failed}, unresolved: ${failures.length}`)
  process.exit(failed > 0 || failures.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
