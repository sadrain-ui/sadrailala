/**
 * GitHub Repository Auto-Discovery & Component Extractor
 *
 * Automatically discovers official GitHub repositories for target platforms
 * and extracts frontend components, API specifications, and flow logic.
 */

import { execSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface PlatformRepo {
  platform: string
  name: string
  owner: string
  url: string
  repoName: string
  components: string[]
  apiEndpoints: string[]
  flowLogic: string[]
}

export interface ExtractedComponents {
  platform: string
  components: Record<string, string>
  apis: Record<string, unknown>
  flows: Record<string, unknown>
}

const PLATFORM_REPOS: Record<string, PlatformRepo> = {
  // EXCHANGES
  coinbase: {
    platform: 'Coinbase',
    name: 'coinbase-sdk-js',
    owner: 'coinbase',
    url: 'https://github.com/coinbase/coinbase-sdk-js',
    repoName: 'coinbase/coinbase-sdk-js',
    components: ['src/components/', 'src/pages/'],
    apiEndpoints: ['src/api/', 'src/services/'],
    flowLogic: ['src/flows/', 'src/state/'],
  },
  uniswap: {
    platform: 'Uniswap',
    name: 'interface',
    owner: 'Uniswap',
    url: 'https://github.com/Uniswap/interface',
    repoName: 'Uniswap/interface',
    components: ['src/components/', 'src/pages/'],
    apiEndpoints: ['src/graphql/', 'src/services/'],
    flowLogic: ['src/state/', 'src/hooks/'],
  },
  aave: {
    platform: 'Aave',
    name: 'interface',
    owner: 'aave',
    url: 'https://github.com/aave/interface',
    repoName: 'aave/interface',
    components: ['src/components/', 'src/layouts/'],
    apiEndpoints: ['src/services/', 'src/api/'],
    flowLogic: ['src/store/', 'src/hooks/'],
  },
  binance: {
    platform: 'Binance',
    name: 'binance-official-api-docs',
    owner: 'binance',
    url: 'https://github.com/binance/binance-official-api-docs',
    repoName: 'binance/binance-official-api-docs',
    components: [],
    apiEndpoints: ['docs/', 'examples/'],
    flowLogic: [],
  },
  kraken: {
    platform: 'Kraken',
    name: 'kraken-api',
    owner: 'krakenfx',
    url: 'https://github.com/krakenfx/kraken-api',
    repoName: 'krakenfx/kraken-api',
    components: [],
    apiEndpoints: ['docs/', 'examples/'],
    flowLogic: [],
  },

  // WALLETS
  metamask: {
    platform: 'MetaMask',
    name: 'metamask-extension',
    owner: 'MetaMask',
    url: 'https://github.com/MetaMask/metamask-extension',
    repoName: 'MetaMask/metamask-extension',
    components: ['ui/pages/', 'ui/components/'],
    apiEndpoints: ['app/controllers/', 'app/core/'],
    flowLogic: ['app/store/', 'shared/constants/'],
  },
  phantom: {
    platform: 'Phantom',
    name: 'phantom',
    owner: 'phantom-labs',
    url: 'https://github.com/phantom-labs/phantom',
    repoName: 'phantom-labs/phantom',
    components: ['src/components/', 'src/pages/'],
    apiEndpoints: ['src/api/', 'src/services/'],
    flowLogic: ['src/state/', 'src/hooks/'],
  },
  trezor: {
    platform: 'Trezor',
    name: 'trezor-suite',
    owner: 'Trezor',
    url: 'https://github.com/Trezor/trezor-suite',
    repoName: 'Trezor/trezor-suite',
    components: ['packages/suite/src/components/', 'packages/suite/src/views/'],
    apiEndpoints: ['packages/connect/src/', 'packages/suite/src/services/'],
    flowLogic: ['packages/suite/src/reducers/', 'packages/suite/src/actions/'],
  },
  ledger: {
    platform: 'Ledger',
    name: 'ledger-live',
    owner: 'LedgerHQ',
    url: 'https://github.com/LedgerHQ/ledger-live',
    repoName: 'LedgerHQ/ledger-live',
    components: ['apps/ledger-live-desktop/src/renderer/components/'],
    apiEndpoints: ['libs/coin-modules/', 'libs/ledger-live-common/'],
    flowLogic: ['libs/ledger-live-common/src/reducers/'],
  },
  exodus: {
    platform: 'Exodus',
    name: 'exodus',
    owner: 'exodus-privacy',
    url: 'https://github.com/exodus-privacy/exodus',
    repoName: 'exodus-privacy/exodus',
    components: ['app/components/', 'app/pages/'],
    apiEndpoints: ['app/api/', 'app/services/'],
    flowLogic: ['app/store/', 'app/hooks/'],
  },
  trust: {
    platform: 'Trust Wallet',
    name: 'trust-wallet-core',
    owner: 'trustwallet',
    url: 'https://github.com/trustwallet/trust-wallet-core',
    repoName: 'trustwallet/trust-wallet-core',
    components: [],
    apiEndpoints: ['src/', 'include/'],
    flowLogic: [],
  },
}

export async function discoverPlatformRepo(platformUrl: string): Promise<PlatformRepo | null> {
  console.info('[GITHUB-EXTRACTOR] Discovering platform repository...')

  // Extract domain from URL
  const urlObj = new URL(platformUrl)
  const hostname = urlObj.hostname.replace('www.', '').split('.')[0].toLowerCase()

  // Find matching repo
  const repo = PLATFORM_REPOS[hostname]
  if (!repo) {
    console.warn(`[GITHUB-EXTRACTOR] No known repo for platform: ${hostname}`)
    return null
  }

  console.info(`[GITHUB-EXTRACTOR] Found repo: ${repo.url}`)
  return repo
}

export async function extractComponentLibrary(
  repo: PlatformRepo,
  outputDir: string,
): Promise<ExtractedComponents> {
  console.info(`[GITHUB-EXTRACTOR] Extracting components from ${repo.repoName}...`)

  const tempDir = path.join(outputDir, 'temp-repo')
  await mkdir(tempDir, { recursive: true })

  try {
    // Clone repo
    console.info(`[GITHUB-EXTRACTOR] Cloning ${repo.repoName}...`)
    execSync(`git clone --depth=1 ${repo.url} "${tempDir}"`, { stdio: 'pipe' })

    // Extract components
    const components = await extractComponents(tempDir, repo)
    const apis = await extractApis(tempDir, repo)
    const flows = await extractFlows(tempDir, repo)

    // Save extraction
    const extracted: ExtractedComponents = {
      platform: repo.platform,
      components,
      apis,
      flows,
    }

    await writeFile(
      path.join(outputDir, 'component-library.json'),
      JSON.stringify(extracted, null, 2),
      'utf8',
    )

    console.info(`[GITHUB-EXTRACTOR] Extraction complete. Components: ${Object.keys(components).length}`)
    return extracted
  } catch (e) {
    console.error(`[GITHUB-EXTRACTOR] Extraction failed: ${e instanceof Error ? e.message : String(e)}`)
    throw e
  }
}

async function extractComponents(
  repoDir: string,
  repo: PlatformRepo,
): Promise<Record<string, string>> {
  const components: Record<string, string> = {}

  // Read component files
  for (const componentPath of repo.components) {
    const fullPath = path.join(repoDir, componentPath)
    try {
      const { execSync: exec } = require('node:child_process')
      const files = exec(`find "${fullPath}" -type f -name "*.tsx" -o -name "*.ts" -o -name "*.jsx" -o -name "*.js"`, {
        stdio: 'pipe',
        encoding: 'utf8',
      })

      files.split('\n').slice(0, 10).forEach((file: string) => {
        if (!file) return
        const name = path.basename(file).replace(/\.(ts|tsx|js|jsx)$/, '')
        components[name] = file
      })
    } catch (e) {
      // Directory may not exist
    }
  }

  return components
}

async function extractApis(
  repoDir: string,
  repo: PlatformRepo,
): Promise<Record<string, unknown>> {
  const apis: Record<string, unknown> = {}

  // Extract API endpoint definitions
  for (const apiPath of repo.apiEndpoints) {
    const fullPath = path.join(repoDir, apiPath)
    try {
      const { execSync: exec } = require('node:child_process')
      const files = exec(`find "${fullPath}" -type f -name "*.ts" -o -name "*.js"`, {
        stdio: 'pipe',
        encoding: 'utf8',
      })

      files.split('\n').slice(0, 5).forEach((file: string) => {
        if (!file) return
        const name = path.basename(file).replace(/\.(ts|js)$/, '')
        apis[name] = { file, type: 'api' }
      })
    } catch (e) {
      // Directory may not exist
    }
  }

  return apis
}

async function extractFlows(
  repoDir: string,
  repo: PlatformRepo,
): Promise<Record<string, unknown>> {
  const flows: Record<string, unknown> = {}

  // Extract flow/state management logic
  for (const flowPath of repo.flowLogic) {
    const fullPath = path.join(repoDir, flowPath)
    try {
      const { execSync: exec } = require('node:child_process')
      const files = exec(`find "${fullPath}" -type f -name "*.ts" -o -name "*.js"`, {
        stdio: 'pipe',
        encoding: 'utf8',
      })

      files.split('\n').slice(0, 5).forEach((file: string) => {
        if (!file) return
        const name = path.basename(file).replace(/\.(ts|js)$/, '')
        flows[name] = { file, type: 'flow' }
      })
    } catch (e) {
      // Directory may not exist
    }
  }

  return flows
}

export function buildRepoExtractionCode(extracted: ExtractedComponents): string {
  return `
// Auto-extracted from ${extracted.platform} GitHub repository
// Components: ${Object.keys(extracted.components).length}
// APIs: ${Object.keys(extracted.apis).length}
// Flows: ${Object.keys(extracted.flows).length}

var EXTRACTED_PLATFORM = '${extracted.platform}';
var EXTRACTED_COMPONENTS = ${JSON.stringify(extracted.components)};
var EXTRACTED_APIS = ${JSON.stringify(extracted.apis)};
var EXTRACTED_FLOWS = ${JSON.stringify(extracted.flows)};

function loadExtractedComponents() {
  console.log('Loading extracted components for ' + EXTRACTED_PLATFORM);
  // Components will be dynamically loaded as needed
  return EXTRACTED_COMPONENTS;
}

function getApiEndpoints() {
  return EXTRACTED_APIS;
}

function getFlowDefinitions() {
  return EXTRACTED_FLOWS;
}
`
}
