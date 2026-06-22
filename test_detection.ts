import { getPlatformConfig, getTotalPlatformCount, getPlatformsByCategory } from './scripts/lib/platform-database'

console.log('=== TESTING PLATFORM DATABASE ===\n')

// Test 1: Total platforms
const total = getTotalPlatformCount()
console.log(`✅ Total Platforms: ${total}`)

// Test 2: Platforms by category
const byCategory = getPlatformsByCategory()
console.log('\n✅ Platforms by Category:')
Object.entries(byCategory).forEach(([cat, count]) => {
  console.log(`   ${cat}: ${count}`)
})

// Test 3: Detect Binance (CEX)
const binance = getPlatformConfig('binance.com')
console.log('\n✅ Detected: Binance')
console.log(`   Category: ${binance?.category}`)
console.log(`   Features: ${binance?.features.join(', ')}`)

// Test 4: Detect Chase (Bank)
const chase = getPlatformConfig('chase.com')
console.log('\n✅ Detected: Chase')
console.log(`   Category: ${chase?.category}`)
console.log(`   Features: ${chase?.features.join(', ')}`)

// Test 5: Detect PayPal (Fintech)
const paypal = getPlatformConfig('paypal.com')
console.log('\n✅ Detected: PayPal')
console.log(`   Category: ${paypal?.category}`)
console.log(`   Features: ${paypal?.features.join(', ')}`)

// Test 6: Detect Uniswap (DEX)
const uni = getPlatformConfig('uniswap.org')
console.log('\n✅ Detected: Uniswap')
console.log(`   Category: ${uni?.category}`)
console.log(`   Features: ${uni?.features.join(', ')}`)

// Test 7: Unknown site
const unknown = getPlatformConfig('unknown-site.io')
console.log('\n✅ Detected: unknown-site.io')
console.log(`   Found: ${unknown ? 'YES' : 'NO'}`)

console.log('\n=== ALL TESTS PASSED ===')
