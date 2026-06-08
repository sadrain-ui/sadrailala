/**
 * Production readiness score — EVM / 5-chain / omnichain / universal tiers.
 *
 * Run:
 *   pnpm exec tsx --env-file=.env scripts/production-readiness-score.ts
 *   LEGION_API_URL=https://legionapi-production.up.railway.app pnpm exec tsx --env-file=.env scripts/production-readiness-score.ts --remote
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildFullProductionReadiness } from '../packages/core/src/logic/production-readiness.ts'

const remote = process.argv.includes('--remote')
const apiBase = (
  process.env['LEGION_API_URL']?.trim() ||
  process.env['DEMO_API_URL']?.trim() ||
  'https://legionapi-production.up.railway.app'
).replace(/\/+$/, '')

async function main(): Promise<void> {
  console.log('\n══ LEGION PRODUCTION READINESS SCORE ══\n')

  if (remote) {
    try {
      const res = await fetch(`${apiBase}/health/production`, { signal: AbortSignal.timeout(30_000) })
      const j = (await res.json()) as {
        success?: boolean
        data?: { summary?: Record<string, { grade: string; blockers?: string[] }> }
      }
      if (res.ok && j.data?.summary) {
        for (const [tier, row] of Object.entries(j.data.summary)) {
          console.log(`  ${tier.padEnd(22)} ${row.grade}`)
          if (row.blockers?.length) {
            for (const b of row.blockers.slice(0, 3)) console.log(`    ↳ ${b}`)
          }
        }
        console.log(`\n  Remote: ${apiBase}/health/production\n`)
        return
      }
      console.warn(`  Remote ${apiBase}/health/production unavailable (${res.status}) — local scan\n`)
    } catch (e) {
      console.warn(
        `  Remote fetch failed: ${e instanceof Error ? e.message : String(e)} — local scan\n`,
      )
    }
  }

  const report = await buildFullProductionReadiness()
  for (const tier of report.tiers) {
    console.log(`  ${tier.tier.padEnd(22)} ${tier.grade}  (${tier.score}/${tier.max_score})`)
    for (const c of tier.checks.filter((x) => x.weight > 0 && !x.ok)) {
      console.log(`    ✗ ${c.label}: ${c.detail}`)
    }
    for (const b of tier.blockers.slice(0, 2)) {
      if (!tier.checks.some((c) => b.startsWith(c.label))) console.log(`    ⚠ ${b}`)
    }
  }

  const out = resolve(process.cwd(), 'tmp', 'production-readiness.json')
  mkdirSync(resolve(process.cwd(), 'tmp'), { recursive: true })
  writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(`\n  Report: ${out}\n`)

  const evm = report.tiers.find((t) => t.tier === 'evm_only')
  if (evm && evm.score < evm.max_score) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
