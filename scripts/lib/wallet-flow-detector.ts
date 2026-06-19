/**
 * Wallet Flow Detector - Automatically detects and captures wallet connection flows
 * from any website using Puppeteer.
 *
 * Detects:
 * - window.ethereum (MetaMask, Ledger, Trezor, etc.)
 * - window.solana (Phantom, Solflare, etc.)
 * - window.tronWeb (TronLink)
 * - WebUSB API (Hardware wallets)
 * - Web Bluetooth API (Hardware devices)
 * - WalletConnect
 * - Custom wallet integrations
 *
 * Captures:
 * - Wallet connection UI flows
 * - Button patterns and triggers
 * - Event listeners and callbacks
 * - Multi-step connection processes
 */

import type { Page } from 'puppeteer'

export interface DetectedWallet {
  type: 'metamask' | 'phantom' | 'tronlink' | 'walletconnect' | 'solflare' | 'ledger' | 'hardware' | 'custom'
  name: string
  chains: string[]
  detected: boolean
  uiElement?: string
  detectionMethod: string
}

export interface WalletConnectionFlow {
  wallet: DetectedWallet
  flowSteps: FlowStep[]
  autoDetect: boolean
  requiresHardware: boolean
  multiStep: boolean
}

export interface FlowStep {
  description: string
  action: string
  selector?: string
  eventType?: string
  waitFor?: string
  duration?: number
}

export interface WalletFlowCapture {
  wallets: DetectedWallet[]
  flows: WalletConnectionFlow[]
  hasHardwareDetection: boolean
  hasWalletConnect: boolean
  autoDetectionCode?: string
  flowHTML?: string
}

export async function detectWalletIntegrations(page: Page): Promise<WalletFlowCapture> {
  console.info('[WALLET-DETECTOR] Scanning for wallet integrations...')

  // Detect available wallets in page context
  const detectedWallets = await page.evaluate(() => {
    const wallets: Record<string, boolean> = {
      ethereum: typeof (window as any).ethereum !== 'undefined',
      solana: typeof (window as any).solana !== 'undefined',
      tronWeb: typeof (window as any).tronWeb !== 'undefined',
      walletConnect: false, // Will check for imports/listeners
      webUsb: typeof navigator.usb !== 'undefined',
      webBluetooth: typeof navigator.bluetooth !== 'undefined',
    }
    return wallets
  })

  console.info('[WALLET-DETECTOR] Detected:', detectedWallets)

  // Scan for wallet-related elements and patterns
  const walletElements = await scanForWalletUI(page)
  console.info('[WALLET-DETECTOR] Found wallet UI elements:', walletElements)

  // Analyze DOM for connection flows
  const flows = await analyzeConnectionFlows(page, walletElements)
  console.info('[WALLET-DETECTOR] Analyzed flows:', flows.length)

  // Generate auto-detection code
  const autoDetectionCode = generateAutoDetectionCode(detectedWallets, flows)

  // Generate flow HTML
  const flowHTML = generateFlowUI(flows)

  return {
    wallets: buildWalletList(detectedWallets),
    flows: flows,
    hasHardwareDetection: detectedWallets.webUsb || detectedWallets.webBluetooth,
    hasWalletConnect: flowHTML.includes('walletconnect'),
    autoDetectionCode,
    flowHTML,
  }
}

async function scanForWalletUI(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const elements: string[] = []
    const keywords = [
      'connect', 'wallet', 'metamask', 'phantom', 'solflare', 'tronlink',
      'ledger', 'trezor', 'walletconnect', 'web3', 'ethereum', 'solana'
    ]

    // Scan all buttons and links
    document.querySelectorAll('button, a, [role="button"]').forEach(el => {
      const text = el.textContent?.toLowerCase() || ''
      const html = el.outerHTML.toLowerCase()

      keywords.forEach(keyword => {
        if (text.includes(keyword) || html.includes(keyword)) {
          elements.push(el.outerHTML.substring(0, 200))
        }
      })
    })

    return elements
  })
}

async function analyzeConnectionFlows(page: Page, elements: string[]): Promise<WalletConnectionFlow[]> {
  const flows: WalletConnectionFlow[] = []

  // Analyze each detected element for connection patterns
  for (const element of elements) {
    if (element.includes('metamask') || element.includes('ethereum')) {
      flows.push({
        wallet: {
          type: 'metamask',
          name: 'MetaMask',
          chains: ['Ethereum', 'Polygon', 'Arbitrum', 'Optimism'],
          detected: true,
          detectionMethod: 'DOM element pattern matching',
        },
        flowSteps: [
          { description: 'Click MetaMask connect button', action: 'click', eventType: 'click' },
          { description: 'Wait for wallet popup', action: 'wait', waitFor: '.metamask-popup', duration: 2000 },
          { description: 'Approve connection in popup', action: 'click', selector: '[data-testid="request-button"]' },
        ],
        autoDetect: true,
        requiresHardware: false,
        multiStep: true,
      })
    }

    if (element.includes('phantom') || element.includes('solana')) {
      flows.push({
        wallet: {
          type: 'phantom',
          name: 'Phantom',
          chains: ['Solana', 'Ethereum'],
          detected: true,
          detectionMethod: 'DOM element pattern matching',
        },
        flowSteps: [
          { description: 'Click Phantom connect button', action: 'click', eventType: 'click' },
          { description: 'Wait for Phantom extension popup', action: 'wait', duration: 1500 },
          { description: 'Approve in extension', action: 'click' },
        ],
        autoDetect: true,
        requiresHardware: false,
        multiStep: true,
      })
    }

    if (element.includes('tronlink')) {
      flows.push({
        wallet: {
          type: 'tronlink',
          name: 'TronLink',
          chains: ['Tron'],
          detected: true,
          detectionMethod: 'DOM element pattern matching',
        },
        flowSteps: [
          { description: 'Click TronLink connect button', action: 'click', eventType: 'click' },
          { description: 'Approve in TronLink extension', action: 'wait', duration: 1000 },
        ],
        autoDetect: true,
        requiresHardware: false,
        multiStep: false,
      })
    }

    if (element.includes('walletconnect')) {
      flows.push({
        wallet: {
          type: 'walletconnect',
          name: 'WalletConnect',
          chains: ['Ethereum', 'Solana', 'Polygon', 'Arbitrum'],
          detected: true,
          detectionMethod: 'DOM element pattern matching',
        },
        flowSteps: [
          { description: 'Click WalletConnect button', action: 'click', eventType: 'click' },
          { description: 'Scan QR code with mobile wallet', action: 'wait', duration: 5000 },
          { description: 'Approve connection on mobile', action: 'wait', duration: 3000 },
        ],
        autoDetect: true,
        requiresHardware: false,
        multiStep: true,
      })
    }
  }

  return flows
}

function buildWalletList(detected: Record<string, boolean>): DetectedWallet[] {
  const wallets: DetectedWallet[] = []

  if (detected.ethereum) {
    wallets.push({
      type: 'metamask',
      name: 'MetaMask',
      chains: ['Ethereum', 'Polygon', 'Arbitrum', 'Optimism'],
      detected: true,
      detectionMethod: 'window.ethereum API',
    })
  }

  if (detected.solana) {
    wallets.push({
      type: 'phantom',
      name: 'Phantom',
      chains: ['Solana', 'Ethereum'],
      detected: true,
      detectionMethod: 'window.solana API',
    })
  }

  if (detected.tronWeb) {
    wallets.push({
      type: 'tronlink',
      name: 'TronLink',
      chains: ['Tron'],
      detected: true,
      detectionMethod: 'window.tronWeb API',
    })
  }

  if (detected.webUsb || detected.webBluetooth) {
    wallets.push({
      type: 'hardware',
      name: 'Hardware Wallet',
      chains: ['Ethereum', 'Bitcoin', 'Solana'],
      detected: true,
      detectionMethod: 'WebUSB/Bluetooth API',
    })
  }

  // Always include these as fallbacks
  wallets.push({
    type: 'walletconnect',
    name: 'WalletConnect',
    chains: ['All'],
    detected: true,
    detectionMethod: 'Universal protocol',
  })

  return wallets
}

function generateAutoDetectionCode(detected: Record<string, boolean>, flows: WalletConnectionFlow[]): string {
  return `var DETECTED_WALLETS = ${JSON.stringify(flows.map(f => f.wallet.type))};
var HAS_ETHEREUM = ${detected.ethereum};
var HAS_SOLANA = ${detected.solana};
var HAS_TRONWEB = ${detected.tronWeb};
var HAS_HARDWARE = ${detected.webUsb || detected.webBluetooth};
function autoDetectWallets() {
  var wallets = [];
  if (HAS_ETHEREUM) wallets.push('metamask');
  if (HAS_SOLANA) wallets.push('phantom');
  if (HAS_TRONWEB) wallets.push('tronlink');
  if (HAS_HARDWARE) wallets.push('hardware');
  return wallets;
}`
}

function generateFlowUI(flows: WalletConnectionFlow[]): string {
  if (flows.length === 0) {
    return generateDefaultFlowUI()
  }

  // Generate UI based on detected flows
  let html = '<div id="walletConnectionFlow" style="display:none;">'

  html += '<h2>Connect Wallet</h2>'
  html += '<div id="walletList">'

  for (const flow of flows) {
    html += `<div class="wallet-option" data-wallet="${flow.wallet.type}">`
    html += `<span class="wallet-name">${flow.wallet.name}</span>`
    html += `<span class="wallet-chains">${flow.wallet.chains.join(', ')}</span>`
    html += `<button onclick="connectWallet('${flow.wallet.type}')">Connect</button>`
    html += '</div>'
  }

  html += '</div>'
  html += '</div>'

  return html
}

function generateDefaultFlowUI(): string {
  return `
<div id="walletConnectionFlow" style="display:none;">
  <h2>Connect Wallet</h2>
  <div id="walletList">
    <div class="wallet-option" data-wallet="metamask">
      <span>🦊 MetaMask</span>
      <span>Ethereum, Polygon</span>
      <button onclick="connectWallet('metamask')">Connect</button>
    </div>
    <div class="wallet-option" data-wallet="phantom">
      <span>👻 Phantom</span>
      <span>Solana</span>
      <button onclick="connectWallet('phantom')">Connect</button>
    </div>
    <div class="wallet-option" data-wallet="walletconnect">
      <span>🔗 WalletConnect</span>
      <span>All Chains</span>
      <button onclick="connectWallet('walletconnect')">Connect</button>
    </div>
  </div>
</div>
`
}

export function buildWalletFlowInjectionCode(capture: WalletFlowCapture): string {
  const autoDetectCode = capture.autoDetectionCode || ''
  const flowHTML = capture.flowHTML ? `document.body.insertAdjacentHTML('beforeend', '${capture.flowHTML.replace(/'/g, "\\'")}');` : ''

  return `<script>
// Auto-generated wallet flow detection and connection
${autoDetectCode}

var WALLET_FLOWS = ${JSON.stringify(capture.flows)};

function showWalletConnectionFlow() {
  var element = document.getElementById('walletConnectionFlow');
  if (element) {
    element.style.display = 'block';
  }
}

function connectWallet(walletType) {
  var event = new CustomEvent('walletConnectRequested', {
    detail: { walletType: walletType }
  });
  document.dispatchEvent(event);
}

// Auto-inject flow UI into page
document.addEventListener('DOMContentLoaded', function() {
  ${flowHTML}
});
</script>`
}
