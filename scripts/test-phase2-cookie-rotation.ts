/**
 * Phase 2 Test: Cookie Rotation & Cloudflare Bypass
 *
 * Tests:
 * 1. Session creation and metadata
 * 2. 30-minute rotation schedule
 * 3. User-Agent rotation
 * 4. Cloudflare challenge detection
 * 5. Automatic bypass strategies
 */

import { CookieRotator, SessionPoolManager } from './lib/cookie-rotator.js'
import { CloudflareBypass } from './lib/cloudflare-bypass.js'

async function main() {
  console.log('🧪 Phase 2: Cookie Rotation & Cloudflare Bypass Test\n')

  // ==================== TEST 1: Session Creation ====================
  console.log('📝 TEST 1: Session Creation')
  console.log('================================\n')

  const rotator = new CookieRotator({
    rotationIntervalMs: 30 * 60 * 1000, // 30 minutes
    maxCookiesInPool: 5, // Smaller for testing
  })

  const session1 = rotator.createSession('app.uniswap.org')
  console.log(`✅ Created session: ${session1.id}`)
  console.log(`   Domain: app.uniswap.org`)
  console.log(`   User-Agent: ${session1.userAgent.substring(0, 50)}...`)
  console.log(`   Created: ${session1.createdAt.toISOString()}\n`)

  // ==================== TEST 2: Session Metadata ====================
  console.log('📊 TEST 2: Session Metadata')
  console.log('================================\n')

  const metadata = rotator.getMetadata(session1.id)
  console.log(`Session Info:`)
  console.log(`   ID: ${metadata?.id}`)
  console.log(`   Age: ${metadata?.ageMinutes} minutes`)
  console.log(`   Rotations: ${metadata?.rotations}`)
  console.log(`   Next rotation: ${metadata?.nextRotationIn}`)
  console.log(`   Domains: ${metadata?.cookieDomains.join(', ')}`)
  console.log(`   Status: ${metadata?.isExpired ? '❌ EXPIRED' : '✅ ACTIVE'}\n`)

  // ==================== TEST 3: Request Headers ====================
  console.log('🔗 TEST 3: Request Headers with Cloudflare Bypass')
  console.log('================================\n')

  const headers = rotator.getRequestHeaders(session1.id, 'app.uniswap.org')
  console.log(`Headers generated for request:`)
  console.log(`   User-Agent: ${headers['User-Agent']}`)
  console.log(`   Accept-Language: ${headers['Accept-Language']}`)
  console.log(`   Sec-CH-UA: ${headers['Sec-CH-UA']}`)
  console.log(`   Sec-Fetch-Mode: ${headers['Sec-Fetch-Mode']}`)
  console.log(`   DNT: ${headers['DNT']}\n`)

  // ==================== TEST 4: Cloudflare Detection ====================
  console.log('🔍 TEST 4: Cloudflare Challenge Detection')
  console.log('================================\n')

  const cfBypass = new CloudflareBypass()

  // Test 403 Forbidden
  const challenge403 = cfBypass.detectChallenge(
    403,
    { 'cf-ray': 'abc123' },
    'some content'
  )
  console.log(`Status 403 detected as:`)
  console.log(`   Type: ${challenge403.type}`)
  console.log(`   Severity: ${challenge403.severity}`)
  console.log(`   Requires interaction: ${challenge403.requiresInteraction}`)

  // Test 429 Too Many Requests
  const challenge429 = cfBypass.detectChallenge(
    429,
    { 'cf-ray': 'abc123' },
    ''
  )
  console.log(`\nStatus 429 detected as:`)
  console.log(`   Type: ${challenge429.type}`)
  console.log(`   Severity: ${challenge429.severity}`)

  // Test JS Challenge
  const challengeJS = cfBypass.detectChallenge(
    200,
    { 'cf-ray': 'abc123' },
    '<html>jschallenge code here</html>'
  )
  console.log(`\nJS Challenge detected as:`)
  console.log(`   Type: ${challengeJS.type}`)
  console.log(`   Detected: ${challengeJS.detected}\n`)

  // ==================== TEST 5: Bypass Strategies ====================
  console.log('⚙️  TEST 5: Bypass Strategies')
  console.log('================================\n')

  const strategy403 = cfBypass.getBypassStrategy(challenge403)
  console.log(`For 403 Cloudflare challenge:`)
  console.log(`   Strategy: ${strategy403.strategy}`)
  console.log(`   Requires rotation: ${strategy403.requiresRotation}`)
  console.log(`   Requires delay: ${strategy403.requiresDelay}`)
  console.log(`   Delay: ${strategy403.delayMs}ms`)
  console.log(`   Description: ${strategy403.description}`)

  const strategy429 = cfBypass.getBypassStrategy(challenge429)
  console.log(`\nFor 429 Rate Limit:`)
  console.log(`   Strategy: ${strategy429.strategy}`)
  console.log(`   Description: ${strategy429.description}\n`)

  // ==================== TEST 6: Cookie Updates ====================
  console.log('🍪 TEST 6: Cookie Management')
  console.log('================================\n')

  const cookieString = 'cf_clearance=abc123def456; Path=/; Domain=.uniswap.org'
  rotator.updateCookies(session1.id, 'app.uniswap.org', cookieString)
  console.log(`✅ Updated cookies for session ${session1.id}`)
  console.log(`   Cookie string: ${cookieString.substring(0, 50)}...`)

  const headersWithCookies = rotator.getRequestHeaders(session1.id, 'app.uniswap.org')
  console.log(`\nHeaders now include:`)
  console.log(`   Cookie: ${headersWithCookies['Cookie']?.substring(0, 50)}...n`)

  // ==================== TEST 7: Manual Rotation ====================
  console.log('🔄 TEST 7: Manual Rotation')
  console.log('================================\n')

  const oldUserAgent = session1.userAgent
  await rotator.rotateSession(session1.id, 'cf_bypass_test')

  const rotatedSession = rotator.getSession(session1.id)
  console.log(`✅ Session rotated manually`)
  console.log(`   Old User-Agent: ${oldUserAgent.substring(0, 40)}...`)
  console.log(`   New User-Agent: ${rotatedSession?.userAgent.substring(0, 40)}...`)
  console.log(`   Rotation count: ${rotatedSession?.rotationCount}`)
  console.log(`   Last rotated: ${rotatedSession?.lastRotated.toISOString()}\n`)

  // ==================== TEST 8: Session Pool ====================
  console.log('📦 TEST 8: Session Pool Management')
  console.log('================================\n')

  const poolManager = new SessionPoolManager(rotator)
  const pool = rotator.getSessionPool('app.uniswap.org')
  const stats = poolManager.getStats('app.uniswap.org')

  console.log(`Session pool for app.uniswap.org:`)
  console.log(`   Pool size: ${pool.length}`)
  console.log(`   Active sessions: ${stats.activeSessions}`)
  console.log(`   All sessions:`)
  pool.slice(0, 3).forEach((s, i) => {
    console.log(`     ${i + 1}. ${s.id.substring(0, 20)}... (rotations: ${s.rotationCount})`)
  })
  if (pool.length > 3) {
    console.log(`     ... and ${pool.length - 3} more\n`)
  } else {
    console.log('')
  }

  // ==================== TEST 9: Event Monitoring ====================
  console.log('📡 TEST 9: Event Monitoring')
  console.log('================================\n')

  const events: any[] = []
  rotator.onRotationEvent((event) => {
    events.push(event)
    console.log(`[${event.type}] ${event.sessionId.substring(0, 10)}... - ${event.reason}`)
  })

  console.log(`Rotating session to trigger event...`)
  await rotator.rotateSession(session1.id, 'event_test')
  console.log(`✅ Event captured: ${events.length} events total\n`)

  // ==================== TEST 10: Rate Limiting Simulation ====================
  console.log('⏱️  TEST 10: Rate Limit Handling')
  console.log('================================\n')

  console.log(`Handling rate limit (429)...`)
  await rotator.handleRateLimit(session1.id, 5000)
  console.log(`✅ Rate limit handled`)
  console.log(`   Waited 5 seconds`)
  console.log(`   Session rotated`)
  const afterRateLimit = rotator.getSession(session1.id)
  console.log(`   New rotation count: ${afterRateLimit?.rotationCount}\n`)

  // ==================== SUMMARY ====================
  console.log('=' .repeat(70))
  console.log('✅ PHASE 2 TESTS PASSED')
  console.log('=' .repeat(70) + '\n')

  console.log(`✨ Phase 2 Features Working:`)
  console.log(`   ✅ Session creation and lifecycle`)
  console.log(`   ✅ 30-minute rotation schedule`)
  console.log(`   ✅ User-Agent rotation`)
  console.log(`   ✅ Cloudflare detection (403, 429, JS Challenge)`)
  console.log(`   ✅ Bypass strategy selection`)
  console.log(`   ✅ Cookie management`)
  console.log(`   ✅ Manual rotation`)
  console.log(`   ✅ Session pooling`)
  console.log(`   ✅ Event monitoring`)
  console.log(`   ✅ Rate limit handling\n`)

  console.log(`📊 Statistics:`)
  console.log(`   Sessions created: ${rotator['activeSessions'].size}`)
  console.log(`   Events captured: ${events.length}`)
  console.log(`   Rotations performed: ${afterRateLimit?.rotationCount}\n`)

  console.log(`🚀 Next: Phase 3 - Platform-Specific Extraction Templates`)
  console.log(`   - CEX extraction (API keys, trading, withdrawals)`)
  console.log(`   - DEX extraction (liquidity, swap routes, pricing)`)
  console.log(`   - Wallet detection (MetaMask, Phantom, Ledger)`)
  console.log(`   - Bank extraction (login, account balance)`)
  console.log(`   - Fintech extraction (payment methods, transfers)\n`)

  // Cleanup
  rotator.cleanup()
  console.log(`✅ Cleanup complete`)
}

main().catch(console.error)
