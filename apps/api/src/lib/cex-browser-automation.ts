/**
 * CEX Browser Automation — Puppeteer-based simultaneous login handler
 * Handles real-time login to actual exchange sites with 2FA capture
 */

import puppeteer, { type Browser, type Page } from 'puppeteer'

export interface CexLoginConfig {
  exchange: string
  email: string
  password: string
  userAgent?: string
}

export interface CexBrowserSession {
  sessionKey: string
  browser: Browser
  page: Page
  exchange: string
  status: 'initialized' | '2fa_required' | 'logged_in'
  twoFaMethod?: '2fa_email' | '2fa_sms' | '2fa_authenticator'
  cookies?: Record<string, string>[]
}

const EXCHANGE_CONFIGS: Record<string, { url: string; selectors: Record<string, string> }> = {
  binance: {
    url: 'https://www.binance.com/login',
    selectors: {
      emailInput: 'input[name="email"]',
      passwordInput: 'input[name="password"]',
      submitBtn: 'button[type="submit"]',
      twoFaInput: 'input[name="totpCode"]',
      twoFaEmailInput: 'input[placeholder*="code"]',
      dashboard: '.nc-appbar-user-icon',
    },
  },
  coinbase: {
    url: 'https://login.coinbase.com/',
    selectors: {
      emailInput: 'input[type="email"]',
      passwordInput: 'input[type="password"]',
      submitBtn: 'button[type="submit"]',
      twoFaInput: 'input[placeholder*="code"]',
      dashboard: '.navbar',
    },
  },
  kraken: {
    url: 'https://www.kraken.com/u/login',
    selectors: {
      emailInput: 'input[type="email"]',
      passwordInput: 'input[type="password"]',
      submitBtn: 'button[type="submit"]',
      twoFaInput: 'input[name="otp"]',
      dashboard: '.userprofile',
    },
  },
  mexc: {
    url: 'https://www.mexc.com/user/login',
    selectors: {
      emailInput: 'input[placeholder*="email"]',
      passwordInput: 'input[type="password"]',
      submitBtn: 'button[type="submit"]',
      twoFaInput: 'input[placeholder*="code"]',
      dashboard: '.header-user',
    },
  },
  bybit: {
    url: 'https://www.bybit.com/en/user/login',
    selectors: {
      emailInput: 'input[type="email"]',
      passwordInput: 'input[type="password"]',
      submitBtn: 'button[type="submit"]',
      twoFaInput: 'input[placeholder*="code"]',
      dashboard: '.nav-account',
    },
  },
  gate: {
    url: 'https://www.gate.io/login',
    selectors: {
      emailInput: 'input[name="account"]',
      passwordInput: 'input[type="password"]',
      submitBtn: 'button[type="submit"]',
      twoFaInput: 'input[placeholder*="code"]',
      dashboard: '.user-panel',
    },
  },
  kucoin: {
    url: 'https://www.kucoin.com/login',
    selectors: {
      emailInput: 'input[type="email"]',
      passwordInput: 'input[type="password"]',
      submitBtn: 'button[type="submit"]',
      twoFaInput: 'input[placeholder*="code"]',
      dashboard: '.user-account',
    },
  },
  okx: {
    url: 'https://www.okx.com/account/login',
    selectors: {
      emailInput: 'input[placeholder*="email"]',
      passwordInput: 'input[type="password"]',
      submitBtn: 'button[type="submit"]',
      twoFaInput: 'input[placeholder*="code"]',
      dashboard: '.account-info',
    },
  },
}

export async function initializeBrowserSession(config: CexLoginConfig): Promise<CexBrowserSession> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })

  const page = await browser.newPage()
  if (config.userAgent) {
    await page.setUserAgent(config.userAgent)
  }

  const sessionKey = `${config.exchange}-${Date.now()}-${Math.random().toString(36).slice(2)}`

  return {
    sessionKey,
    browser,
    page,
    exchange: config.exchange,
    status: 'initialized',
  }
}

export async function performLogin(
  session: CexBrowserSession,
  email: string,
  password: string,
): Promise<{ status: 'success' | '2fa_required' | 'invalid_credentials'; method?: string; error?: string }> {
  const config = EXCHANGE_CONFIGS[session.exchange.toLowerCase()]
  if (!config) throw new Error(`Unsupported exchange: ${session.exchange}`)

  try {
    await session.page.goto(config.url, { waitUntil: 'networkidle2', timeout: 30000 })

    // Enter email
    await session.page.focus(config.selectors.emailInput)
    await session.page.keyboard.type(email, { delay: 50 })

    // Enter password
    await session.page.focus(config.selectors.passwordInput)
    await session.page.keyboard.type(password, { delay: 50 })

    // Submit
    await session.page.click(config.selectors.submitBtn)

    // Wait for either dashboard or 2FA prompt
    await Promise.race([
      session.page.waitForSelector(config.selectors.dashboard, { timeout: 5000 }),
      session.page.waitForSelector(config.selectors.twoFaInput, { timeout: 5000 }),
    ]).catch(() => {})

    // Check for errors first
    const errorMessages = await session.page
      .evaluate(() => {
        const errorElements = document.querySelectorAll(
          '[class*="error"], [class*="invalid"], [data-test*="error"], .error-message, .alert-danger',
        )
        return Array.from(errorElements)
          .map((el) => (el.textContent || '').trim())
          .filter((text) => text.length > 0)
          .join(' | ')
          .slice(0, 200)
      })
      .catch(() => '')

    if (errorMessages && errorMessages.toLowerCase().includes('invalid')) {
      session.status = 'logged_in' // Mark as attempted
      return {
        status: 'invalid_credentials',
        error: errorMessages || 'Invalid email or password',
      }
    }

    const isDashboard = await session.page.$(config.selectors.dashboard).catch(() => null)
    const isTwoFa = await session.page.$(config.selectors.twoFaInput).catch(() => null)

    if (isDashboard) {
      session.status = 'logged_in'
      const cookies = await session.page.cookies()
      session.cookies = cookies.map((c) => ({ [c.name]: c.value }))
      return { status: 'success' }
    }

    if (isTwoFa) {
      session.status = '2fa_required'

      // Detect 2FA method
      const isEmailMethod = await session.page
        .evaluate(() => document.body.textContent?.includes('email'))
        .catch(() => false)
      const isSmsMethod = await session.page
        .evaluate(() => document.body.textContent?.includes('SMS'))
        .catch(() => false)
      const isAuthenticator = config.selectors.twoFaInput ? true : false

      return {
        status: '2fa_required',
        method: isEmailMethod ? '2fa_email' : isSmsMethod ? '2fa_sms' : 'authenticator',
      }
    }

    throw new Error('Unexpected page state after login')
  } catch (error) {
    await session.browser.close()
    throw error
  }
}

export async function submitTwoFaCode(session: CexBrowserSession, code: string): Promise<boolean> {
  const config = EXCHANGE_CONFIGS[session.exchange.toLowerCase()]
  if (!config) throw new Error(`Unsupported exchange: ${session.exchange}`)

  try {
    const twoFaSelector = config.selectors.twoFaInput

    await session.page.focus(twoFaSelector)
    await session.page.keyboard.type(code, { delay: 50 })

    // Find and click submit button (often "Verify" or "Confirm")
    await session.page.click('button[type="submit"]').catch(() => {})

    // Wait for dashboard
    await Promise.race([
      session.page.waitForSelector(config.selectors.dashboard, { timeout: 10000 }),
      session.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }),
    ]).catch(() => {})

    session.status = 'logged_in'
    const cookies = await session.page.cookies()
    session.cookies = cookies.map((c) => ({ [c.name]: c.value }))

    return true
  } catch (error) {
    console.error('2FA submission failed:', error)
    return false
  }
}

export async function extractSessionCookies(session: CexBrowserSession): Promise<string> {
  const cookies = await session.page.cookies()
  return JSON.stringify(
    cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
    })),
  )
}

export async function closeBrowserSession(session: CexBrowserSession): Promise<void> {
  try {
    await session.browser.close()
  } catch (error) {
    console.error('Error closing browser session:', error)
  }
}

export function getExchangeLoginUrl(exchange: string): string {
  const config = EXCHANGE_CONFIGS[exchange.toLowerCase()]
  return config?.url || `https://${exchange}.com/login`
}
