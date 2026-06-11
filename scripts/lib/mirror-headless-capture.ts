/**
 * Headless browser fallback — puppeteer-extra + stealth full-page capture.
 * Solves Turnstile via 2captcha when TWOCAPTCHA_API_KEY is set.
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
      cookies: string
      html: string
      assetCount: number
    }
  | { ok: false; detail: string }

const DEFAULT_HEADLESS_TIMEOUT_MS = 90_000

function readHeadlessTimeoutMs(): number {
  const raw = process.env['HEADLESS_TIMEOUT']?.trim()
  if (!raw) return DEFAULT_HEADLESS_TIMEOUT_MS
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 15_000 ? n : DEFAULT_HEADLESS_TIMEOUT_MS
}

function cookiesToHeader(cookies: Array<{ name: string; value: string }>): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
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

export async function captureMirrorWithHeadless(
  targetUrl: string,
  outDir: string,
): Promise<HeadlessCaptureResult> {
  const timeoutMs = readHeadlessTimeoutMs()
  try {
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
      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: timeoutMs })

      if (isLocalCaptchaSolverEnabled()) {
        const preHtml = await page.content()
        const local = await solveCaptchaLocally(targetUrl, preHtml, 200)
        if (local.ok && local.cookies) {
          const pairs = local.cookies.split(';').map((p) => p.trim()).filter(Boolean)
          for (const pair of pairs) {
            const eq = pair.indexOf('=')
            if (eq <= 0) continue
            const name = pair.slice(0, eq).trim()
            const value = pair.slice(eq + 1).trim()
            try {
              await page.setCookie({ name, value, url: targetUrl })
            } catch {
              /* ignore invalid cookie for domain */
            }
          }
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
      await writeFile(htmlPath, html, 'utf8')
      await writeFile(cookiesPath, cookieHeader, 'utf8')

      const assetDir = path.join(outDir, 'headless-assets')
      await mkdir(assetDir, { recursive: true })

      const screenshotPath = path.join(assetDir, 'viewport.png')
      await page.screenshot({ path: screenshotPath, fullPage: false })

      return {
        ok: true,
        htmlPath,
        cookiesPath,
        cookies: cookieHeader,
        html,
        assetCount: 1,
      }
    } finally {
      await browser.close()
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('Cannot find module') || msg.includes('puppeteer')) {
      return {
        ok: false,
        detail:
          'puppeteer-extra not installed — run: pnpm add -D puppeteer puppeteer-extra puppeteer-extra-plugin-stealth',
      }
    }
    return { ok: false, detail: msg }
  }
}
