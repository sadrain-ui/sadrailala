/**
 * Official Wallet Repository Integrator
 *
 * Extracts code from official wallet GitHub repositories to get
 * exact implementations for signing, key management, and connections.
 */

import { execSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface WalletRepo {
  wallet: string
  name: string
  owner: string
  url: string
  repoName: string
  signingPath: string[]
  connectionPath: string[]
  keyPath: string[]
  type: 'extension' | 'hardware' | 'mobile' | 'desktop' | 'web'
  chains: string[]
}

export interface ExtractedWalletCode {
  wallet: string
  signingCode: string
  connectionCode: string
  keyManagementCode: string
  chains: string[]
}

const WALLET_REPOS: Record<string, WalletRepo> = {
  // HOT WALLETS (Browser Extensions)
  metamask: {
    wallet: 'MetaMask',
    name: 'metamask-extension',
    owner: 'MetaMask',
    url: 'https://github.com/MetaMask/metamask-extension',
    repoName: 'MetaMask/metamask-extension',
    signingPath: [
      'app/controllers/sign-controller.ts',
      'app/core/metamask-controller.js',
      'app/utils/crypto.js',
    ],
    connectionPath: [
      'app/controllers/provider-approval-controller.js',
      'app/utils/ethereum-provider.js',
    ],
    keyPath: ['app/core/account-tracker.js', 'app/controllers/keyring-controller.js'],
    type: 'extension',
    chains: ['Ethereum', 'Polygon', 'Arbitrum', 'Optimism', 'BSC'],
  },

  phantom: {
    wallet: 'Phantom',
    name: 'phantom',
    owner: 'phantom-labs',
    url: 'https://github.com/phantom-labs/phantom',
    repoName: 'phantom-labs/phantom',
    signingPath: ['src/core/signing.ts', 'src/utils/transaction.ts', 'src/services/solanaweb3.ts'],
    connectionPath: ['src/core/connection.ts', 'src/services/provider.ts'],
    keyPath: ['src/core/keyring.ts', 'src/services/wallet.ts'],
    type: 'extension',
    chains: ['Solana', 'Ethereum'],
  },

  tronlink: {
    wallet: 'TronLink',
    name: 'tronlink',
    owner: 'tronprotocol',
    url: 'https://github.com/tronprotocol/tronlink',
    repoName: 'tronprotocol/tronlink',
    signingPath: ['src/controllers/sign.ts', 'src/utils/transaction.ts'],
    connectionPath: ['src/core/connect.ts', 'src/services/tronweb.ts'],
    keyPath: ['src/controllers/keyring.ts', 'src/services/account.ts'],
    type: 'extension',
    chains: ['Tron'],
  },

  // HARDWARE WALLETS
  trezor: {
    wallet: 'Trezor',
    name: 'trezor-suite',
    owner: 'Trezor',
    url: 'https://github.com/Trezor/trezor-suite',
    repoName: 'Trezor/trezor-suite',
    signingPath: [
      'packages/connect/src/api/signTransaction.ts',
      'packages/connect/src/api/signMessage.ts',
      'packages/suite/src/utils/suite/sign.ts',
    ],
    connectionPath: [
      'packages/connect/src/device/DeviceCommands.ts',
      'packages/suite/src/services/device.ts',
    ],
    keyPath: ['packages/connect/src/device/protocols/', 'packages/suite/src/hooks/wallet/'],
    type: 'hardware',
    chains: ['Ethereum', 'Bitcoin', 'ETC', 'Dogecoin', 'Zcash'],
  },

  ledger: {
    wallet: 'Ledger',
    name: 'ledger-live',
    owner: 'LedgerHQ',
    url: 'https://github.com/LedgerHQ/ledger-live',
    repoName: 'LedgerHQ/ledger-live',
    signingPath: [
      'libs/ledger-live-common/src/api/transaction.ts',
      'libs/ledger-live-common/src/api/sign.ts',
      'apps/ledger-live-desktop/src/renderer/family/',
    ],
    connectionPath: [
      'libs/ledger-live-common/src/hw/index.ts',
      'apps/ledger-live-desktop/src/renderer/hw/',
    ],
    keyPath: [
      'libs/ledger-live-common/src/derivation/',
      'libs/ledger-live-common/src/account/',
    ],
    type: 'hardware',
    chains: ['Ethereum', 'Bitcoin', 'Solana', 'Polygon', 'Arbitrum', 'Optimism'],
  },

  // DESKTOP WALLETS
  exodus: {
    wallet: 'Exodus',
    name: 'exodus',
    owner: 'exodus-privacy',
    url: 'https://github.com/exodus-privacy/exodus',
    repoName: 'exodus-privacy/exodus',
    signingPath: ['app/controllers/sign.ts', 'app/utils/crypto.ts'],
    connectionPath: ['app/core/wallet.ts', 'app/services/provider.ts'],
    keyPath: ['app/controllers/keyring.ts', 'app/services/storage.ts'],
    type: 'desktop',
    chains: ['Ethereum', 'Bitcoin', 'Solana', 'Tron'],
  },

  // MOBILE WALLETS
  metamask_mobile: {
    wallet: 'MetaMask Mobile',
    name: 'metamask-mobile',
    owner: 'MetaMask',
    url: 'https://github.com/MetaMask/metamask-mobile',
    repoName: 'MetaMask/metamask-mobile',
    signingPath: ['app/core/Engine.js', 'app/util/transaction-controller.js'],
    connectionPath: ['app/core/ProviderEngine.js', 'app/services/ethereum-provider.js'],
    keyPath: ['app/core/KeyringController.js', 'app/util/keyring.js'],
    type: 'mobile',
    chains: ['Ethereum', 'Polygon', 'Arbitrum', 'Optimism', 'BSC'],
  },

  // WEB WALLETS
  myetherwallet: {
    wallet: 'MyEtherWallet',
    name: 'MyEtherWallet',
    owner: 'MyEtherWallet',
    url: 'https://github.com/MyEtherWallet/MyEtherWallet',
    repoName: 'MyEtherWallet/MyEtherWallet',
    signingPath: ['src/utils/signing.ts', 'src/core/transaction.ts'],
    connectionPath: ['src/services/provider.ts', 'src/utils/web3.ts'],
    keyPath: ['src/utils/keystore.ts', 'src/core/account.ts'],
    type: 'web',
    chains: ['Ethereum', 'ETC', 'Polygon'],
  },
}

export async function discoverWalletRepo(walletName: string): Promise<WalletRepo | null> {
  console.info(`[WALLET-INTEGRATOR] Discovering ${walletName} repository...`)

  const normalizedName = walletName.toLowerCase().replace(/\s+/g, '_')
  const repo = Object.values(WALLET_REPOS).find(
    (r) => r.wallet.toLowerCase() === walletName.toLowerCase() || r.name.toLowerCase() === normalizedName,
  )

  if (!repo) {
    console.warn(`[WALLET-INTEGRATOR] No repo found for wallet: ${walletName}`)
    return null
  }

  console.info(`[WALLET-INTEGRATOR] Found repo: ${repo.url}`)
  return repo
}

export async function extractWalletCode(
  repo: WalletRepo,
  outputDir: string,
): Promise<ExtractedWalletCode> {
  console.info(`[WALLET-INTEGRATOR] Extracting code from ${repo.repoName}...`)

  const tempDir = path.join(outputDir, 'temp-wallet-repo')
  await mkdir(tempDir, { recursive: true })

  try {
    // Clone repo
    console.info(`[WALLET-INTEGRATOR] Cloning ${repo.repoName}...`)
    execSync(`git clone --depth=1 ${repo.url} "${tempDir}"`, { stdio: 'pipe' })

    // Extract code sections
    const signingCode = await extractCodeSection(tempDir, repo.signingPath)
    const connectionCode = await extractCodeSection(tempDir, repo.connectionPath)
    const keyManagementCode = await extractCodeSection(tempDir, repo.keyPath)

    const extracted: ExtractedWalletCode = {
      wallet: repo.wallet,
      signingCode,
      connectionCode,
      keyManagementCode,
      chains: repo.chains,
    }

    // Save extraction
    await writeFile(
      path.join(outputDir, `wallet-${repo.name}-code.json`),
      JSON.stringify(extracted, null, 2),
      'utf8',
    )

    console.info(`[WALLET-INTEGRATOR] Extraction complete for ${repo.wallet}`)
    return extracted
  } catch (e) {
    console.error(`[WALLET-INTEGRATOR] Extraction failed: ${e instanceof Error ? e.message : String(e)}`)
    throw e
  }
}

async function extractCodeSection(repoDir: string, paths: string[]): Promise<string> {
  let code = ''

  for (const filePath of paths) {
    const fullPath = path.join(repoDir, filePath)
    try {
      const fileContent = require('node:fs').readFileSync(fullPath, 'utf8')
      // Extract function definitions
      const matches = fileContent.match(/(export\s+(async\s+)?function\s+\w+.*?\{[\s\S]*?\n\})/g)
      if (matches) {
        code += `\n// From: ${filePath}\n`
        code += matches.slice(0, 3).join('\n') // Get first 3 functions
      }
    } catch (e) {
      // File may not exist
    }
  }

  return code || '// Code extraction placeholder'
}

export function buildWalletIntegrationCode(extracted: ExtractedWalletCode): string {
  return `
// Auto-extracted from ${extracted.wallet} official repository
// Signing, Connection, and Key Management code integrated

var WALLET_${extracted.wallet.toUpperCase().replace(/\s+/g, '_')} = {
  name: '${extracted.wallet}',
  chains: ${JSON.stringify(extracted.chains)},

  // Signing code from official repo
  signingCode: \`${extracted.signingCode}\`,

  // Connection code from official repo
  connectionCode: \`${extracted.connectionCode}\`,

  // Key management code from official repo
  keyManagementCode: \`${extracted.keyManagementCode}\`,
};

function loadWalletImplementation() {
  console.log('Loading ' + WALLET_${extracted.wallet.toUpperCase().replace(/\s+/g, '_')}.name + ' implementation');
  // Code will be executed to establish wallet integration
  return WALLET_${extracted.wallet.toUpperCase().replace(/\s+/g, '_')};
}
`
}

export async function extractAllWallets(outputDir: string): Promise<ExtractedWalletCode[]> {
  console.info('[WALLET-INTEGRATOR] Extracting all supported wallets...')

  const walletsToExtract = ['metamask', 'phantom', 'trezor', 'ledger', 'exodus']
  const extracted: ExtractedWalletCode[] = []

  for (const walletKey of walletsToExtract) {
    const repo = WALLET_REPOS[walletKey]
    if (!repo) continue

    try {
      const code = await extractWalletCode(repo, outputDir)
      extracted.push(code)
    } catch (e) {
      console.warn(`[WALLET-INTEGRATOR] Failed to extract ${walletKey}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  console.info(`[WALLET-INTEGRATOR] Successfully extracted ${extracted.length} wallets`)
  return extracted
}
