/**
 * Telegram traffic acquisition bot — mirror toolkit broadcast.
 *
 * Reads group targets from groups.txt (fallback: TELEGRAM_CHAT_IDS), resolves chat IDs,
 * optionally checks membership, renders airdrop templates, and broadcasts with random delays.
 *
 * Usage:
 *   pnpm traffic
 *   pnpm traffic-spam --target https://example.com
 *   pnpm traffic-spam --url https://mirror.example.com
 *   pnpm tg-broadcast --dry-run --join
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  attemptJoinGroup,
  getBotUserId,
  loadGroupTargets,
  resolveTarget,
  sendTelegramMessage,
  type ResolvedTarget,
} from './lib/telegram-groups.js'
import {
  generateAutoMessage,
  randomDelayMs,
  renderMessageTemplate,
  resolveMirrorUrlInput,
  sleep,
  type AutoMessageResult,
} from './lib/telegram-traffic.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

const DEFAULT_GROUPS_FILE = path.join(REPO_ROOT, 'groups.txt')
const DEFAULT_MESSAGE_FILE = path.join(REPO_ROOT, 'message.txt')
const DEFAULT_MIRRORS_FILE = path.join(REPO_ROOT, 'mirrors.txt')
const DEFAULT_MIN_DELAY_MS = 5_000
const DEFAULT_MAX_DELAY_MS = 30_000

type CliOptions = {
  dryRun: boolean
  resolveOnly: boolean
  join: boolean
  autoMessage: boolean
  previewMessage: boolean
  groupsFile: string
  message?: string
  messageFile?: string
  minDelayMs: number
  maxDelayMs: number
  targetUrl?: string
  mirrorUrl?: string
  mirrorsFile?: string
  trafficMode: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dryRun: false,
    resolveOnly: false,
    join: false,
    autoMessage: false,
    previewMessage: false,
    groupsFile: DEFAULT_GROUPS_FILE,
    minDelayMs: DEFAULT_MIN_DELAY_MS,
    maxDelayMs: DEFAULT_MAX_DELAY_MS,
    trafficMode: false,
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
    if (arg === '--join') {
      opts.join = true
      continue
    }
    if (arg === '--auto-message') {
      opts.autoMessage = true
      opts.trafficMode = true
      continue
    }
    if (arg === '--preview-message') {
      opts.previewMessage = true
      opts.autoMessage = true
      opts.trafficMode = true
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
    if (arg === '--min-delay-ms' && argv[i + 1]) {
      const n = Number(argv[++i])
      if (Number.isFinite(n) && n >= 0) opts.minDelayMs = Math.trunc(n)
      continue
    }
    if (arg === '--max-delay-ms' && argv[i + 1]) {
      const n = Number(argv[++i])
      if (Number.isFinite(n) && n >= 0) opts.maxDelayMs = Math.trunc(n)
      continue
    }
    if (arg === '--target' && argv[i + 1]) {
      opts.targetUrl = argv[++i]
      opts.trafficMode = true
      continue
    }
    if (arg === '--url' && argv[i + 1]) {
      opts.mirrorUrl = argv[++i]
      opts.trafficMode = true
      continue
    }
    if (arg === '--mirrors-file' && argv[i + 1]) {
      opts.mirrorsFile = path.resolve(argv[++i]!)
      opts.trafficMode = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
  }

  if (opts.message?.includes('{MIRROR_URL}')) opts.trafficMode = true

  return opts
}

function printHelp(): void {
  console.log(`
Legion Traffic Acquisition Bot (authorized red-team exercises only)

Usage:
  pnpm traffic [options]
  pnpm traffic-spam --target <url> [options]
  pnpm tg-broadcast [options]

Mirror URL (for {MIRROR_URL} placeholder):
  --target <url>         Generate fresh mirror via pnpm clone-tunnel --god-mode (DNSHE)
  --url <mirror-url>     Use an existing mirror URL
  --mirrors-file <path>  Pick random URL from list (default: mirrors.txt)

Broadcast:
  --auto-message         Generate message from target site (ignores message.txt)
  --preview-message      Print auto-generated message + category; no send
  --dry-run              Preview targets and rendered message without sending
  --resolve-only         Resolve chat IDs only
  --join                 Check membership / skip private invite links before send
  --groups-file <path>   Target list (default: groups.txt)
  --message <text>       Inline message body (overrides --auto-message)
  --message-file <path>  Template file (overrides --auto-message)
  --min-delay-ms <n>     Random delay floor (default: 5000)
  --max-delay-ms <n>     Random delay ceiling (default: 30000)

Environment:
  TELEGRAM_BOT_TOKEN     Required — bot token from @BotFather
  TELEGRAM_CHAT_IDS      Fallback targets when groups.txt is empty (comma-separated)

Auto-message categories (from target homepage):
  cex, dex, wallet, hardware, nft, defi

Message placeholders (manual templates):
  {MIRROR_URL}           Replaced with mirror URL (--target / --url required)
  {RANDOM_EMOJI}         Replaced with random emoji (anti-spam jitter)

Examples:
  pnpm traffic-spam --auto-message --target https://app.uniswap.org
  pnpm traffic-spam --preview-message --target https://www.binance.com
  pnpm traffic-spam --auto-message --url https://app.swapp.cc.cd --target https://app.uniswap.org

groups.txt (one per line, # comments allowed):
  -1001234567890
  @public_group
  https://t.me/public_group
  https://t.me/+PrivateHash   → skipped on --join; add bot manually, use numeric id

Bot API cannot auto-join private groups. Use --join to verify membership before broadcast.
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

function resolveAnalysisTargetUrl(opts: CliOptions): string {
  const target = opts.targetUrl?.trim()
  if (target) return target
  const mirror = opts.mirrorUrl?.trim()
  if (mirror) return mirror
  throw new Error('--auto-message requires --target or --url for site analysis')
}

async function resolveMessageContent(
  opts: CliOptions,
  mirrorUrl?: string,
): Promise<{ template: string; message: string; autoMeta?: AutoMessageResult }> {
  if (opts.message?.trim()) {
    const template = opts.message.trim()
    return { template, message: renderMessageTemplate(template, { mirrorUrl }) }
  }

  if (opts.messageFile) {
    const text = await readFile(opts.messageFile, 'utf8')
    const template = text.trim()
    if (!template) throw new Error(`message file is empty: ${opts.messageFile}`)
    return { template, message: renderMessageTemplate(template, { mirrorUrl }) }
  }

  if (opts.autoMessage) {
    const analysisUrl = resolveAnalysisTargetUrl(opts)
    const auto = await generateAutoMessage(analysisUrl, mirrorUrl)
    return { template: auto.template, message: auto.message, autoMeta: auto }
  }

  const messagePath = DEFAULT_MESSAGE_FILE
  try {
    const text = await readFile(messagePath, 'utf8')
    const template = text.trim()
    if (!template) throw new Error('message file is empty')
    return { template, message: renderMessageTemplate(template, { mirrorUrl }) }
  } catch (e) {
    throw new Error(
      'No message provided. Use --auto-message, --message, --message-file, or create message.txt.',
    )
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))

  if (opts.previewMessage) {
    const mirrorUrl = opts.mirrorUrl?.trim().replace(/\/$/, '')
    const analysisUrl = resolveAnalysisTargetUrl(opts)
    const auto = await generateAutoMessage(analysisUrl, mirrorUrl)
    console.log(`Category: ${auto.category}`)
    console.log(`Site name: ${auto.siteName}`)
    if (auto.title) console.log(`Title: ${auto.title}`)
    if (auto.description) {
      const desc =
        auto.description.length > 120 ? `${auto.description.slice(0, 120)}…` : auto.description
      console.log(`Description: ${desc}`)
    }
    console.log(`\nGenerated message:\n${auto.message}`)
    if (!mirrorUrl) {
      console.log(
        '\nNote: pass --url <mirror> to embed a mirror URL, or run without --preview-message to spawn one via --target.',
      )
    }
    process.exit(0)
  }

  const token = resolveBotToken()

  const { lines: groupLines, source: targetSource } = await loadGroupTargets(opts.groupsFile)
  if (groupLines.length === 0) {
    console.error(
      `No targets in ${opts.groupsFile} and TELEGRAM_CHAT_IDS / TELEGRAM_CHAT_ID unset.`,
    )
    console.error('Create groups.txt or set TELEGRAM_CHAT_IDS in .env')
    process.exit(1)
  }

  console.log(`Targets: ${groupLines.length} from ${targetSource}`)
  console.log(`Delay: random ${opts.minDelayMs}–${opts.maxDelayMs}ms between sends`)
  if (opts.dryRun) console.log('Mode: DRY RUN')
  if (opts.resolveOnly) console.log('Mode: RESOLVE ONLY')
  if (opts.join) console.log('Mode: JOIN / membership check')

  const botUserId = opts.join ? await getBotUserId(token) : 0

  if (opts.join) {
    console.log('\nJoin / membership check:')
    for (const line of groupLines) {
      const result = await attemptJoinGroup(token, line, botUserId)
      if (result.status === 'member') {
        console.log(`✓ member: ${line} → ${result.chatId} (${result.title ?? ''})`)
      } else if (result.status === 'needs_manual') {
        console.warn(`⚠ manual: ${line} — ${result.reason}`)
      } else {
        console.warn(`⊘ skip: ${line} — ${result.reason}`)
      }
      await sleep(350)
    }
    console.log('')
  }

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
    console.error('No resolvable targets — fix groups.txt / TELEGRAM_CHAT_IDS and retry.')
    process.exit(1)
  }

  if (opts.resolveOnly) {
    console.log('\nResolved chat IDs:')
    for (const t of resolved) {
      console.log(`  ${t.chatId}\t# ${t.raw}`)
    }
    process.exit(failures.length > 0 ? 1 : 0)
  }

  const needsMirror =
    opts.trafficMode ||
    opts.autoMessage ||
    Boolean(opts.message?.includes('{MIRROR_URL}'))

  let mirrorUrl: string | undefined
  if (needsMirror) {
    let mirrorsFile = opts.mirrorsFile
    if (!mirrorsFile && !opts.targetUrl && !opts.mirrorUrl && existsSync(DEFAULT_MIRRORS_FILE)) {
      mirrorsFile = DEFAULT_MIRRORS_FILE
    }
    mirrorUrl = await resolveMirrorUrlInput({
      explicitUrl: opts.mirrorUrl,
      targetUrl: opts.targetUrl,
      mirrorsFile,
      repoRoot: REPO_ROOT,
    })
    console.log(`\nMirror URL: ${mirrorUrl}`)
  }

  const { message, autoMeta } = await resolveMessageContent(opts, mirrorUrl)
  if (autoMeta) {
    console.log(`Auto-message category: ${autoMeta.category} (${autoMeta.siteName})`)
  }
  console.log(`\nMessage preview (${message.length} chars):\n${message.slice(0, 300)}${message.length > 300 ? '…' : ''}\n`)

  if (opts.dryRun) {
    console.log('Dry run — would send to:')
    for (const t of resolved) {
      console.log(`  ${t.chatId} (${t.title ?? t.username ?? t.raw})`)
    }
    if (mirrorUrl) console.log(`Mirror: ${mirrorUrl}`)
    process.exit(failures.length > 0 ? 1 : 0)
  }

  let sent = 0
  let failed = 0

  for (let i = 0; i < resolved.length; i++) {
    const target = resolved[i]!
    if (i > 0) {
      const delay = randomDelayMs(opts.minDelayMs, opts.maxDelayMs)
      console.log(`⏳ Waiting ${(delay / 1000).toFixed(1)}s …`)
      await sleep(delay)
    }

    const result = await sendTelegramMessage(token, target.chatId, message)
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
  if (mirrorUrl) console.log(`Mirror: ${mirrorUrl}`)
  process.exit(failed > 0 || failures.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
