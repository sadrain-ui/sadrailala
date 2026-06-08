#!/usr/bin/env node
import cron from 'node-cron'

import { listAutoRotateCampaigns } from './campaign-store.js'
import { readRotationIntervalHours, rotateMirrorDomain } from './domain-rotator.js'

async function rotateDueCampaigns(): Promise<void> {
  const campaigns = await listAutoRotateCampaigns()
  const defaultHours = readRotationIntervalHours()
  const now = Date.now()

  for (const campaign of campaigns) {
    const intervalHours = campaign.rotation_interval_hours || defaultHours
    const lastMs = campaign.last_health_check_at
      ? Date.parse(campaign.last_health_check_at)
      : 0
    const due = !lastMs || now - lastMs >= intervalHours * 60 * 60 * 1000
    if (!due) continue
    const result = await rotateMirrorDomain(campaign, 'scheduled_interval')
    if (!result.ok) {
      console.warn(`[domain-rotator] campaign=${campaign.id} failed: ${result.ok === false ? result.detail : 'unknown'}`)
    }
  }
}

const once = process.argv.includes('--once')
if (once) {
  rotateDueCampaigns()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
} else {
  const hours = readRotationIntervalHours()
  const expr = hours >= 24 ? `0 0 */${Math.max(1, Math.floor(hours / 24))} * *` : `0 */${hours} * * *`
  console.info(`[domain-rotator] cron every ${hours}h (${expr})`)
  cron.schedule(expr, () => {
    void rotateDueCampaigns().catch((e) => {
      console.error('[domain-rotator] cycle failed:', e instanceof Error ? e.message : String(e))
    })
  })
}
