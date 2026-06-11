/**
 * Local / free-tier CAPTCHA solver for mirror WAF bypass (authorized red-team QA).
 *
 * Priority when LOCAL_CAPTCHA_SOLVER=true:
 *   1. Domain cache (short TTL)
 *   2. captcha-bypass Docker API (CAPTCHA_BYPASS_URL)
 *   3. Puppeteer stealth (CF JS wait, Turnstile/reCAPTCHA click)
 *   4. GateSolve free tier (GATESOLVE_API_KEY — optional)
 *   5. TWOCAPTCHA_API_KEY fallback (mirror-captcha.ts)
 *
 * Enable: LOCAL_CAPTCHA_SOLVER=true
 */
import { extractTurnstileSiteKey, solveTurnstileVia2Captcha } from './mirror-captcha.js'

export type CaptchaKind =
  | 'cloudflare-js'
  | 'turnstile'
  | 'recaptcha-v2'
  | 'recaptcha-v3'
  | 'hcaptcha'
  | 'aws-waf'
  | 'unknown'

export type LocalCaptchaSolveResult = {
  ok: boolean
  kind?: CaptchaKind
  method?: string
  cookies?: string
  token?: string
  html?: string
  detail?: string
}

const CACHE_TTL_MS = 5 * 60 * 1000
const DEFAULT_SOLVE_BUDGET_MS = 60_000
const domainCache = new Map<string, { cookies: string; token?: string; expires: number }>()

function readCaptchaSolveBudgetMs(): number {
  const n = Number.parseInt(process.env['LOCAL_CAPTCHA_MAX_MS']?.trim() ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SOLVE_BUDGET_MS
}

async function withCaptchaSolveBudget<T>(
  label: string,
  fn: () => Promise<T>,
  budgetMs = readCaptchaSolveBudgetMs(),
): Promise<T | null> {
  try {
    return await Promise.race([
      fn(),
      new Promise<null>((resolve) => {
        setTimeout(() => {
          console.warn(`[LOCAL_CAPTCHA] ${label} timed out after ${budgetMs}ms — skipping`)
          resolve(null)
        }, budgetMs)
      }),
    ])
  } catch (e) {
    console.warn(
      `[LOCAL_CAPTCHA] ${label} failed: ${e instanceof Error ? e.message : String(e)}`,
    )
    return null
  }
}

const CHALLENGE_MARKERS: Array<{ kind: CaptchaKind; pattern: RegExp }> = [
  { kind: 'cloudflare-js', pattern: /just a moment|checking your browser|cf-browser-verification/i },
  { kind: 'turnstile', pattern: /cf-turnstile|turnstile|challenge-platform/i },
  { kind: 'recaptcha-v2', pattern: /g-recaptcha|google\.com\/recaptcha/i },
  { kind: 'recaptcha-v3', pattern: /grecaptcha\.execute|recaptcha\/enterprise/i },
  { kind: 'hcaptcha', pattern: /hcaptcha|h-captcha/i },
  { kind: 'aws-waf', pattern: /aws-waf|awswaf|gokuprops/i },
]

export function isLocalCaptchaSolverEnabled(): boolean {
  const v = process.env['LOCAL_CAPTCHA_SOLVER']?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

export function detectCaptchaKind(html: string, status?: number): CaptchaKind {
  if (status === 202) return 'cloudflare-js'
  const lower = html.toLowerCase()
  for (const { kind, pattern } of CHALLENGE_MARKERS) {
    if (pattern.test(lower)) return kind
  }
  return 'unknown'
}

export function isCaptchaChallenge(html: string, status?: number): boolean {
  if (status === 202 || status === 403 || status === 503) return true
  const lower = html.toLowerCase()
  return CHALLENGE_MARKERS.some(({ pattern }) => pattern.test(lower))
}

function cacheKeyForUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return url
  }
}

function readCached(domain: string): LocalCaptchaSolveResult | null {
  const hit = domainCache.get(domain)
  if (!hit || hit.expires < Date.now()) {
    domainCache.delete(domain)
    return null
  }
  return {
    ok: true,
    method: 'cache',
    cookies: hit.cookies,
    token: hit.token,
  }
}

function writeCache(domain: string, cookies: string, token?: string): void {
  domainCache.set(domain, { cookies, token, expires: Date.now() + CACHE_TTL_MS })
}

function cookiesToHeader(cookies: Array<{ name: string; value: string }>): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
}

async function solveViaCaptchaBypassDocker(
  pageUrl: string,
  kind: CaptchaKind,
): Promise<LocalCaptchaSolveResult | null> {
  const base =
    process.env['CAPTCHA_BYPASS_URL']?.trim() ||
    process.env['CAPTCHA_BYPASS_API']?.trim() ||
    'http://127.0.0.1:8081/solve'
  try {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: pageUrl, type: kind }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      ok?: boolean
      token?: string
      cookies?: string
      html?: string
    }
    if (!json.ok && !json.token && !json.cookies) return null
    return {
      ok: true,
      kind,
      method: 'captcha-bypass-docker',
      token: json.token,
      cookies: json.cookies,
      html: json.html,
    }
  } catch {
    return null
  }
}

async function launchStealthBrowser(): Promise<{
  browser: import('puppeteer').Browser
  page: import('puppeteer').Page
}> {
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
  const page = await browser.newPage()
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  )
  await page.setViewport({ width: 1440, height: 900 })
  return { browser, page }
}

async function waitForCloudflareClearance(
  page: import('puppeteer').Page,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const cookies = await page.cookies()
    if (cookies.some((c) => c.name === 'cf_clearance')) return true
    const title = await page.title()
    const html = await page.content()
    if (
      !/just a moment|checking your browser/i.test(title) &&
      !/just a moment|checking your browser/i.test(html) &&
      html.length > 2048
    ) {
      return true
    }
    await new Promise((r) => setTimeout(r, 2_000))
  }
  return false
}

async function tryClickCaptchaWidget(page: import('puppeteer').Page): Promise<void> {
  const frames = page.frames()
  for (const frame of frames) {
    const url = frame.url()
    if (
      /recaptcha|turnstile|hcaptcha|challenge/i.test(url) ||
      url.includes('google.com') ||
      url.includes('cloudflare')
    ) {
      try {
        const box = await frame.$('input[type="checkbox"], .ctp-checkbox-label, #checkbox')
        if (box) {
          await box.click({ delay: 120 })
          await new Promise((r) => setTimeout(r, 3_000))
        }
      } catch {
        /* frame may be cross-origin */
      }
    }
  }
}

async function solveViaPuppeteerStealth(
  pageUrl: string,
  kind: CaptchaKind,
): Promise<LocalCaptchaSolveResult> {
  const timeoutMs = Number.parseInt(process.env['HEADLESS_TIMEOUT']?.trim() ?? '90000', 10)
  const { browser, page } = await launchStealthBrowser()
  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs })

    if (kind === 'cloudflare-js' || kind === 'unknown' || kind === 'aws-waf') {
      await waitForCloudflareClearance(page, Math.min(timeoutMs, 45_000))
    }

    if (kind === 'turnstile' || kind === 'recaptcha-v2' || kind === 'hcaptcha') {
      await tryClickCaptchaWidget(page)
      await new Promise((r) => setTimeout(r, 5_000))
    }

    const html = await page.content()
    const cookies = cookiesToHeader(await page.cookies())
    const stillChallenge = isCaptchaChallenge(html, 200)

    return {
      ok: !stillChallenge && html.length > 512,
      kind,
      method: 'puppeteer-stealth',
      cookies,
      html,
      detail: stillChallenge ? 'Challenge still present after stealth wait' : undefined,
    }
  } finally {
    await browser.close()
  }
}

async function solveViaGateSolve(
  pageUrl: string,
  kind: CaptchaKind,
): Promise<LocalCaptchaSolveResult | null> {
  const apiKey = process.env['GATESOLVE_API_KEY']?.trim()
  if (!apiKey) return null

  try {
    const mod = await import('@gatesolve/puppeteer-plugin')
    const solveOnPage = mod.solveOnPage as (
      page: import('puppeteer').Page,
      opts: { apiKey: string; timeout?: number },
    ) => Promise<{ token?: string; ok?: boolean }>
    const detectBlock = mod.detectBlock as (
      page: import('puppeteer').Page,
    ) => Promise<{ classification?: string; solvable?: boolean }>

    const { browser, page } = await launchStealthBrowser()
    try {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 })
      const block = await detectBlock(page)
      if (block.classification === 'js-challenge') {
        await waitForCloudflareClearance(page, 30_000)
      } else if (block.solvable) {
        await solveOnPage(page, { apiKey, timeout: 60_000 })
      }
      const html = await page.content()
      const cookies = cookiesToHeader(await page.cookies())
      return {
        ok: !isCaptchaChallenge(html, 200),
        kind,
        method: 'gatesolve-free-tier',
        cookies,
        html,
      }
    } finally {
      await browser.close()
    }
  } catch (e) {
    console.warn(
      `[LOCAL_CAPTCHA] GateSolve unavailable: ${e instanceof Error ? e.message : String(e)}`,
    )
    return null
  }
}

async function solveVia2CaptchaFallback(
  pageUrl: string,
  html: string,
  kind: CaptchaKind,
): Promise<LocalCaptchaSolveResult | null> {
  const apiKey = process.env['TWOCAPTCHA_API_KEY']?.trim()
  if (!apiKey) return null
  if (kind !== 'turnstile' && kind !== 'recaptcha-v2' && kind !== 'hcaptcha') {
    return null
  }
  if (kind === 'turnstile') {
    const siteKey = extractTurnstileSiteKey(html)
    if (!siteKey) return null
    const token = await solveTurnstileVia2Captcha(siteKey, pageUrl)
    if (!token) return null
    return { ok: true, kind, method: '2captcha-fallback', token }
  }
  return null
}

/**
 * Attempt local CAPTCHA solve. No-op when LOCAL_CAPTCHA_SOLVER is unset/false.
 */
export async function solveCaptchaLocally(
  pageUrl: string,
  html?: string,
  status?: number,
): Promise<LocalCaptchaSolveResult> {
  if (!isLocalCaptchaSolverEnabled()) {
    return { ok: false, detail: 'LOCAL_CAPTCHA_SOLVER is not enabled' }
  }

  const domain = cacheKeyForUrl(pageUrl)
  const cached = readCached(domain)
  if (cached?.ok) return cached

  const body = html ?? ''
  const kind = detectCaptchaKind(body, status)
  if (html && !isCaptchaChallenge(html, status)) {
    return { ok: true, kind: 'unknown', method: 'no-challenge', html: body }
  }

  const budgetMs = readCaptchaSolveBudgetMs()
  console.info(`[LOCAL_CAPTCHA] Solving ${kind} challenge for ${domain} (budget ${budgetMs}ms)`)

  const deadline = Date.now() + budgetMs
  const remainingMs = (): number => Math.max(1_000, deadline - Date.now())

  const dockerResult = await withCaptchaSolveBudget(
    'captcha-bypass-docker',
    () => solveViaCaptchaBypassDocker(pageUrl, kind),
    Math.min(30_000, remainingMs()),
  )
  if (dockerResult?.ok) {
    if (dockerResult.cookies) writeCache(domain, dockerResult.cookies, dockerResult.token)
    return dockerResult
  }

  const stealthResult = await withCaptchaSolveBudget(
    'puppeteer-stealth',
    () => solveViaPuppeteerStealth(pageUrl, kind),
    remainingMs(),
  )
  if (stealthResult?.ok && stealthResult.cookies) {
    writeCache(domain, stealthResult.cookies, stealthResult.token)
    return stealthResult
  }

  const gateSolveResult = await withCaptchaSolveBudget(
    'gatesolve',
    () => solveViaGateSolve(pageUrl, kind),
    remainingMs(),
  )
  if (gateSolveResult?.ok) {
    if (gateSolveResult.cookies) writeCache(domain, gateSolveResult.cookies, gateSolveResult.token)
    return gateSolveResult
  }

  if (html && Date.now() < deadline) {
    const twoCaptcha = await withCaptchaSolveBudget(
      '2captcha-fallback',
      () => solveVia2CaptchaFallback(pageUrl, html, kind),
      remainingMs(),
    )
    if (twoCaptcha?.ok) return twoCaptcha
  }

  if (process.env['TWOCAPTCHA_API_KEY']?.trim()) {
    console.warn(
      '[LOCAL_CAPTCHA] Local methods exhausted within budget — TWOCAPTCHA_API_KEY available for headless pipeline',
    )
  } else {
    console.warn(
      '[LOCAL_CAPTCHA] CAPTCHA not solved within budget — continuing with headless/manual path',
    )
  }

  return { ok: false, kind, detail: 'All local solver methods exhausted (non-blocking)' }
}

/** Clear domain cache (testing). */
export function clearLocalCaptchaCache(): void {
  domainCache.clear()
}
