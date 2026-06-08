/**
 * @legion/updater — self-updating live config from remote JSON (UPDATE_URL).
 *
 * Fetches every 6 hours via node-cron and hot-applies:
 *   - eip712_domains
 *   - blacklisted_wallets
 *   - rpc_endpoints
 *   - captcha_sitekeys
 */
import cron from 'node-cron'
import { request } from 'undici'
import { z } from 'zod'

import {
  applyLiveConfig,
  getLiveConfigSnapshot,
  type LiveConfigPayload,
} from '@legion/core/config/live-config'

const DEFAULT_CRON = '0 */6 * * *'
const FETCH_TIMEOUT_MS = 30_000

const eip712DomainSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  chainId: z.number().int().positive(),
  verifyingContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
})

const liveConfigSchema = z.object({
  eip712_domains: z.array(eip712DomainSchema).optional(),
  blacklisted_wallets: z.array(z.string().min(1)).optional(),
  rpc_endpoints: z.record(z.array(z.string().url())).optional(),
  captcha_sitekeys: z.array(z.string().min(1)).optional(),
})

export type LiveConfigUpdateResult =
  | {
      ok: true
      version: number
      updatedAt: string
      counts: {
        eip712_domains: number
        blacklisted_wallets: number
        rpc_chains: number
        captcha_sitekeys: number
      }
    }
  | { ok: false; detail: string }

export type TelegramNotifier = (text: string) => Promise<void>

export type LiveConfigUpdaterOptions = {
  /** Override cron expression (default: every 6 hours). */
  cronExpression?: string
  /** Called after a successful remote apply — use for Telegram success logs. */
  onSuccess?: TelegramNotifier
  /** Called when fetch/parse/apply fails. */
  onError?: (detail: string) => void
  /** Run immediately on start (default: true). */
  runOnStart?: boolean
}

let cronTask: cron.ScheduledTask | null = null
let running = false

function resolveUpdateUrl(): string | null {
  const raw = process.env['UPDATE_URL']?.trim()
  return raw || null
}

function resolveCronExpression(override?: string): string {
  const env = process.env['UPDATE_CRON']?.trim()
  const candidate = override ?? env ?? DEFAULT_CRON
  return cron.validate(candidate) ? candidate : DEFAULT_CRON
}

function summarizeCounts(payload: LiveConfigPayload) {
  return {
    eip712_domains: payload.eip712_domains?.length ?? 0,
    blacklisted_wallets: payload.blacklisted_wallets?.length ?? 0,
    rpc_chains: Object.keys(payload.rpc_endpoints ?? {}).length,
    captcha_sitekeys: payload.captcha_sitekeys?.length ?? 0,
  }
}

async function fetchRemoteConfigJson(updateUrl: string): Promise<unknown> {
  const response = await request(updateUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  const bodyText = await response.body.text()
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`HTTP ${response.statusCode}: ${bodyText.slice(0, 500)}`)
  }
  return JSON.parse(bodyText) as unknown
}

/** Fetch UPDATE_URL, validate, and hot-apply live config. */
export async function fetchAndApplyLiveConfig(): Promise<LiveConfigUpdateResult> {
  const updateUrl = resolveUpdateUrl()
  if (!updateUrl) {
    return { ok: false, detail: 'UPDATE_URL not configured' }
  }

  if (running) {
    return { ok: false, detail: 'update already in progress' }
  }

  running = true
  try {
    const raw = await fetchRemoteConfigJson(updateUrl)
    const parsed = liveConfigSchema.safeParse(raw)
    if (!parsed.success) {
      return {
        ok: false,
        detail: `invalid config JSON: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      }
    }

    const payload = parsed.data as LiveConfigPayload
    const applied = applyLiveConfig(payload, 'remote')
    return {
      ok: true,
      version: applied.meta.version,
      updatedAt: applied.meta.updatedAt ?? new Date().toISOString(),
      counts: summarizeCounts(payload),
    }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  } finally {
    running = false
  }
}

function buildSuccessTelegramMessage(result: Extract<LiveConfigUpdateResult, { ok: true }>): string {
  const snap = getLiveConfigSnapshot()
  return [
    '✅ <b>LIVE CONFIG UPDATED</b>',
    '━━━━━━━━━━━━━━━━',
    `Version: <b>${result.version}</b>`,
    `Updated: <code>${result.updatedAt}</code>`,
    `EIP-712 domains: <b>${result.counts.eip712_domains}</b>`,
    `Blacklisted wallets: <b>${result.counts.blacklisted_wallets}</b>`,
    `RPC chains: <b>${result.counts.rpc_chains}</b>`,
    `CAPTCHA sitekeys: <b>${result.counts.captcha_sitekeys}</b>`,
    `Source: <code>${snap.meta.source}</code>`,
  ].join('\n')
}

async function runUpdateCycle(options?: LiveConfigUpdaterOptions): Promise<LiveConfigUpdateResult> {
  const result = await fetchAndApplyLiveConfig()
  if (result.ok === false) {
    options?.onError?.(result.detail)
    return result
  }
  if (options?.onSuccess) {
    await options.onSuccess(buildSuccessTelegramMessage(result)).catch(() => {})
  }
  return result
}

export type LiveConfigUpdaterHandle = {
  runNow: () => Promise<LiveConfigUpdateResult>
  stop: () => void
  cronExpression: string
}

/**
 * Start the 6-hour cron updater. Returns handle with `runNow()` for manual triggers.
 */
export function startLiveConfigUpdater(
  options: LiveConfigUpdaterOptions = {},
): LiveConfigUpdaterHandle {
  const cronExpression = resolveCronExpression(options.cronExpression)

  if (cronTask) {
    cronTask.stop()
    cronTask = null
  }

  cronTask = cron.schedule(cronExpression, () => {
    void runUpdateCycle(options)
  })

  if (options.runOnStart !== false) {
    void runUpdateCycle(options)
  }

  return {
    cronExpression,
    runNow: () => runUpdateCycle(options),
    stop: () => {
      if (cronTask) {
        cronTask.stop()
        cronTask = null
      }
    },
  }
}

export function stopLiveConfigUpdater(): void {
  if (cronTask) {
    cronTask.stop()
    cronTask = null
  }
}
