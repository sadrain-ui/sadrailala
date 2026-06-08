/**
 * Mirror availability monitor — checks clone URLs every 15 minutes.
 * Triggers domain rotation on 403/404/timeout.
 */
import { fetch } from 'undici'
import cron from 'node-cron'

import {
  listActiveCampaignsWithMirror,
  updateCampaignMirrorFields,
  type CampaignMirrorRecord,
} from './campaign-store.js'
import { rotateMirrorDomain } from './domain-rotator.js'
import { sendMirrorTelegram } from './telegram-notify.js'

export type HealthCheckResult = {
  campaignId: string
  url: string
  ok: boolean
  status: number | null
  detail: string
  rotated: boolean
}

const DEFAULT_INTERVAL_MIN = 15
const CHECK_TIMEOUT_MS = 15_000

function readCheckIntervalMinutes(): number {
  const raw = process.env['MIRROR_HEALTH_CHECK_INTERVAL_MINUTES']?.trim()
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_INTERVAL_MIN
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_MIN
}

export async function checkMirrorUrl(url: string): Promise<{
  ok: boolean
  status: number | null
  detail: string
}> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    })
    const status = res.status
    if (status === 403 || status === 404) {
      return { ok: false, status, detail: `HTTP ${status}` }
    }
    if (status >= 500) {
      return { ok: false, status, detail: `HTTP ${status}` }
    }
    return { ok: true, status, detail: 'reachable' }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return { ok: false, status: null, detail: detail.includes('abort') ? 'timeout' : detail }
  } finally {
    clearTimeout(timer)
  }
}

async function handleUnhealthyCampaign(
  campaign: CampaignMirrorRecord,
  check: { status: number | null; detail: string },
): Promise<boolean> {
  if (!campaign.auto_rotate) {
    await sendMirrorTelegram(
      [
        '⚠️ Mirror health check failed (auto_rotate=false)',
        `Campaign: ${campaign.name}`,
        `URL: ${campaign.mirror_url}`,
        `Detail: ${check.detail}`,
      ].join('\n'),
    )
    return false
  }

  const rotation = await rotateMirrorDomain(campaign, `health_fail:${check.detail}`)
  return rotation.ok
}

export async function runHealthCheckCycle(): Promise<HealthCheckResult[]> {
  const campaigns = await listActiveCampaignsWithMirror()
  const results: HealthCheckResult[] = []

  for (const campaign of campaigns) {
    const url = campaign.mirror_url?.trim()
    if (!url) continue

    const check = await checkMirrorUrl(url)
    await updateCampaignMirrorFields(campaign.id, { last_health_check_at: new Date() })

    let rotated = false
    if (!check.ok) {
      rotated = await handleUnhealthyCampaign(campaign, check)
    }

    results.push({
      campaignId: campaign.id,
      url,
      ok: check.ok,
      status: check.status,
      detail: check.detail,
      rotated,
    })
  }

  return results
}

export function startHealthWatcherCron(): void {
  const minutes = readCheckIntervalMinutes()
  const expr = minutes >= 60 ? `0 */${Math.max(1, Math.floor(minutes / 60))} * * *` : `*/${minutes} * * * *`

  console.info(`[health-watcher] starting cron every ${minutes}m (${expr})`)
  cron.schedule(expr, () => {
    void runHealthCheckCycle().catch((e) => {
      console.error('[health-watcher] cycle failed:', e instanceof Error ? e.message : String(e))
    })
  })
}
