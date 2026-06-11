/**
 * Headless browser fallback — puppeteer-extra + stealth full-page capture.
 * Solves Turnstile via 2captcha when TWOCAPTCHA_API_KEY is set.
 * Retries up to 2 times; persists cookies for nginx reuse.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { extractTurnstileSiteKey, solveTurnstileVia2Captcha } from './mirror-captcha.js'
import { isLocalCaptchaSolverEnabled, solveCaptchaLocally } from './local-captcha-solver.js'

export type HeadlessCaptureResult =
  | {
      ok: true
      htmlPath: string
      cookiesPath: string
      cookiesJsonPath: string
      cookies: string
      html: string
      assetCount: number
      attempts: number
    }
  | { ok: false; detail: string; attempts: number }

const DEFAULT_HEADLESS_TIMEOUT_MS = 60_000
const DEFAULT_HEADLESS_RETRIES = 2

function readHeadlessTimeoutMs(): number {
  const raw = process.env['HEADLESS_TIMEOUT']?.trim()
  if (!raw) return DEFAULT_HEADLESS_TIMEOUT_MS
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 15_000 ? n : DEFAULT_HEADLESS_TIMEOUT_MS
}

function readHeadlessRetries(): number {
  const raw = process.env['HEADLESS_CAPTURE_RETRIES']?.trim()
  if (!raw) return DEFAULT_HEADLESS_RETRIES
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : DEFAULT_HEADLESS_RETRIES
}

function cookiesToHeader(cookies: Array<{ name: string; value: string }>): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
}

async function applyCookiesToPage(
  page: import('puppeteer').Page,
  cookieHeader: string,
  pageUrl: string,
): Promise<void> {
  const pairs = cookieHeader.split(';').map((p) => p.trim()).filter(Boolean)
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    try {
      await page.setCookie({ name, value, url: pageUrl })
    } catch {
      /* ignore invalid cookie for domain */
    }
  }
}

async function trySolveTurnstileOnPage(
  page: import('puppeteer').Page,
  pageUrl: string,
  timeoutMs: number,
): Promise<boolean> {
  const html = await page.content()
  const siteKey = extractTurnstileSiteKey(html)
  if (!siteKey) return false

  const token = await solveTurnstileVia2Captcha(siteKey, pageUrl)
  if (!token) return false

  await page.evaluate((turnstileToken) => {
    const selectors = [
      '[name="cf-turnstile-response"]',
      '[name="g-recaptcha-response"]',
      'input[name="cf-turnstile-response"]',
    ]
    for (const sel of selectors) {
      const el = document.querySelector(sel) as HTMLInputElement | null
      if (el) el.value = turnstileToken
    }
    const w = window as unknown as {
      turnstile?: { execute?: () => void }
      cfCallback?: (t: string) => void
    }
    if (typeof w.cfCallback === 'function') w.cfCallback(turnstileToken)
    if (w.turnstile?.execute) w.turnstile.execute()
  }, token)

  try {
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: timeoutMs })
  } catch {
    await new Promise((r) => setTimeout(r, 4_000))
  }
  return true
}

async function captureOnce(
  targetUrl: string,
  outDir: string,
  timeoutMs: number,
  persistedCookies?: string,
): Promise<HeadlessCaptureResult> {
  const puppeteerExtra = await import('puppeteer-extra')
  const stealthMod = await import('puppeteer-extra-plugin-stealth')
  const StealthPlugin = stealthMod.default ?? stealthMod
  const puppeteer = puppeteerExtra.default ?? puppeteerExtra
  puppeteer.use(StealthPlugin())

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  })

  try {
    const page = await browser.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    )
    await page.setViewport({ width: 1440, height: 900 })

    if (persistedCookies?.trim()) {
      await page.goto(new URL(targetUrl).origin, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      })
      await applyCookiesToPage(page, persistedCookies, targetUrl)
    }

    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: timeoutMs })

    if (isLocalCaptchaSolverEnabled()) {
      const preHtml = await page.content()
      const local = await solveCaptchaLocally(targetUrl, preHtml, 200)
      if (local.ok && local.cookies) {
        await applyCookiesToPage(page, local.cookies, targetUrl)
        if (local.html && local.html.length > 512) {
          await page.setContent(local.html, { waitUntil: 'domcontentloaded' })
        } else {
          await page.reload({ waitUntil: 'networkidle2', timeout: timeoutMs })
        }
      }
    }

    await trySolveTurnstileOnPage(page, targetUrl, timeoutMs)

    const html = await page.content()
    const cookies = await page.cookies()
    const cookieHeader = cookiesToHeader(cookies)

    const htmlPath = path.join(outDir, 'headless-capture.html')
    const cookiesPath = path.join(outDir, 'mirror-session-cookies.txt')
    const cookiesJsonPath = path.join(outDir, 'mirror-session-cookies.json')
    await writeFile(htmlPath, html, 'utf8')
    await writeFile(cookiesPath, cookieHeader, 'utf8')
    await writeFile(
      cookiesJsonPath,
      `${JSON.stringify(
        {
          url: targetUrl,
          session_cookies: cookieHeader,
          cookies,
          captured_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    const assetDir = path.join(outDir, 'headless-assets')
    await mkdir(assetDir, { recursive: true })
    const screenshotPath = path.join(assetDir, 'viewport.png')
    await page.screenshot({ path: screenshotPath, fullPage: false })

    return {
      ok: true,
      htmlPath,
      cookiesPath,
      cookiesJsonPath,
      cookies: cookieHeader,
      html,
      assetCount: 1,
      attempts: 1,
    }
  } finally {
    await browser.close()
  }
}

export async function captureMirrorWithHeadless(
  targetUrl: string,
  outDir: string,
): Promise<HeadlessCaptureResult> {
  const timeoutMs = readHeadlessTimeoutMs()
  const maxRetries = readHeadlessRetries()
  let lastError = 'unknown error'
  let persistedCookies: string | undefined

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const result = await captureOnce(targetUrl, outDir, timeoutMs, persistedCookies)
      if (result.ok) {
        return { ...result, attempts: attempt }
      }
      lastError = result.detail
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      if (lastError.includes('Cannot find module') || lastError.includes('puppeteer')) {
        return {
          ok: false,
          detail:
            'puppeteer-extra not installed — run: pnpm add -D puppeteer puppeteer-extra puppeteer-extra-plugin-stealth',
          attempts: attempt,
        }
      }
    }

    try {
      const { readFile } = await import('node:fs/promises')
      persistedCookies = await readFile(
        path.join(outDir, 'mirror-session-cookies.txt'),
        'utf8',
      ).catch(() => persistedCookies)
    } catch {
      /* ignore */
    }

    if (attempt <= maxRetries) {
      console.error(
        `[headless-capture] Attempt ${attempt}/${maxRetries + 1} failed: ${lastError} — retrying…`,
      )
      await new Promise((r) => setTimeout(r, 2_000 * attempt))
    }
  }

  return { ok: false, detail: lastError, attempts: maxRetries + 1 }
}
