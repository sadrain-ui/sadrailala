/**
 * Background DNS rotation worker — spawned by clone-deploy-tunnel --rotate.
 * Rotates Cloudflare subdomain every N hours and updates campaign DB.
 *
 * LIMITATION: Requires VPS with MIRROR_VPS_IP reachable; does not restart cloudflared.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { updateCampaignMirrorById } from './clone-tunnel-campaign.js'
import {
  createCloudflareMirrorSubdomain,
  hasCloudflareDnsConfig,
  readRotateIntervalHours,
  resolveDuckDnsMirrorUrl,
  updateDuckDns,
} from './clone-tunnel-dns.js'

export type RotationState = {
  campaignId?: string
  targetUrl: string
  intervalHours: number
  provider: 'cloudflare' | 'duckdns'
  duckdnsSubdomain?: string
  lastRecordId?: string
  lastMirrorUrl: string
  lastFqdn: string
  startedAt: string
}

async function loadState(statePath: string): Promise<RotationState> {
  const raw = await readFile(statePath, 'utf8')
  return JSON.parse(raw) as RotationState
}

async function saveState(statePath: string, state: RotationState): Promise<void> {
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

async function rotateOnce(state: RotationState): Promise<RotationState> {
  console.warn(
    '[clone-rotate] EXPERIMENTAL: domain rotation — not guaranteed on all tunnel setups',
  )

  if (state.provider === 'cloudflare' && hasCloudflareDnsConfig()) {
    const created = await createCloudflareMirrorSubdomain({
      deletePreviousRecordId: state.lastRecordId,
    })
    if (created.ok === false) {
      console.error(`[clone-rotate] Cloudflare rotation failed: ${created.detail}`)
      return state
    }
    state.lastMirrorUrl = created.mirrorUrl
    state.lastFqdn = created.fqdn
    state.lastRecordId = created.recordId
  } else if (state.provider === 'duckdns' && state.duckdnsSubdomain) {
    const token = process.env['DUCKDNS_TOKEN']?.trim()
    if (!token) {
      console.error('[clone-rotate] DUCKDNS_TOKEN missing — skip rotation')
      return state
    }
    const ok = await updateDuckDns(state.duckdnsSubdomain, token)
    if (!ok) {
      console.error('[clone-rotate] DuckDNS IP refresh failed')
      return state
    }
    state.lastFqdn = `${state.duckdnsSubdomain}.duckdns.org`
    state.lastMirrorUrl = `https://${state.lastFqdn}/`
  } else {
    console.error('[clone-rotate] No DNS provider configured for rotation')
    return state
  }

  if (state.campaignId) {
    const updated = await updateCampaignMirrorById(state.campaignId, {
      mirror_url: state.lastMirrorUrl,
      mirror_subdomain: state.lastFqdn,
      auto_rotate: true,
      rotation_interval_hours: state.intervalHours,
    })
    if (updated.ok === false) {
      console.error(`[clone-rotate] Campaign update failed: ${updated.detail}`)
    } else {
      console.info(`[clone-rotate] Campaign ${state.campaignId} → ${state.lastMirrorUrl}`)
    }
  }

  console.info(`[clone-rotate] New mirror URL: ${state.lastMirrorUrl}`)
  return state
}

async function main(): Promise<void> {
  const stateArgIdx = process.argv.findIndex((a) => a === '--state')
  const statePath =
    stateArgIdx !== -1 ? process.argv[stateArgIdx + 1]?.trim() : undefined
  if (!statePath) {
    console.error('Usage: tsx clone-tunnel-rotation-worker.ts --state <path>')
    process.exit(1)
  }

  const absState = path.resolve(statePath)
  let state = await loadState(absState)
  const intervalMs = readRotateIntervalHours(state.intervalHours) * 60 * 60 * 1000

  console.info(
    `[clone-rotate] Worker started — interval ${state.intervalHours}h, provider=${state.provider}`,
  )

  const tick = async () => {
    state = await rotateOnce(state)
    await saveState(absState, state)
  }

  setInterval(() => {
    void tick().catch((e) => {
      console.error('[clone-rotate] tick failed:', e instanceof Error ? e.message : String(e))
    })
  }, intervalMs)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
