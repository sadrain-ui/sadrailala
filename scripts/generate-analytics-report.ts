/**
 * Phase 5 — Analytics Report Generator
 *
 * Run:
 *   pnpm tsx scripts/generate-analytics-report.ts
 *   pnpm tsx scripts/generate-analytics-report.ts --days 30  (custom window)
 *   pnpm tsx scripts/generate-analytics-report.ts --telegram  (also send to Telegram)
 *
 * Prints the report to stdout and optionally sends to Telegram.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadEnv(filePath: string): void {
  if (!existsSync(filePath)) return
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1)
    if (process.env[key] === undefined) process.env[key] = val
  }
}

loadEnv(path.join(__dirname, '..', '.env'))
loadEnv(path.join(__dirname, '..', '.env.development'))

const args = process.argv.slice(2)
const daysIdx = args.indexOf('--days')
const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1] ?? '7', 10) : 7
const sendTelegram = args.includes('--telegram')

const { AnalyticsReporter } = await import('./lib/analytics-reporter.js')
const reporter = new AnalyticsReporter(days)

console.log(`[analytics] Generating report for last ${days} days…`)

const digest = await reporter.buildDigest()

if (!digest) {
  console.error('[analytics] No database connection or no data — set DATABASE_URL env var')
  process.exit(1)
}

const formatted = reporter.formatTelegramDigest(digest)
console.log('\n' + formatted.replace(/\*/g, '').replace(/_/g, ''))

if (sendTelegram) {
  console.log('\n[analytics] Sending to Telegram…')
  await reporter.sendTelegramDigest(digest)
  console.log('[analytics] Telegram digest sent')
}
