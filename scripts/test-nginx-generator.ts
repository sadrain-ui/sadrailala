/**
 * Test script for nginx-generator
 * Demonstrates Phase 1 foundation: generating nginx configs for Uniswap
 */

import { NginxGenerator, detectPlatformCategory, getBrowserHeaders, getInjectionPoints } from './lib/nginx-generator.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  console.log('🚀 Phase 1: NGINX Generator Test\n')

  // Test with Uniswap
  const uniswapUrl = 'https://app.uniswap.org'
  const category = detectPlatformCategory(uniswapUrl)

  console.log(`📋 Configuration:`)
  console.log(`   URL: ${uniswapUrl}`)
  console.log(`   Category: ${category}`)
  console.log(`   Listen Port: 8080`)
  console.log(`   Target Port: 443\n`)

  const browserHeaders = getBrowserHeaders(category)
  const injectionPoints = getInjectionPoints(category)

  console.log(`📝 Injection Points: ${injectionPoints.join(', ')}\n`)

  const generator = new NginxGenerator({
    targetUrl: uniswapUrl,
    targetHost: 'app.uniswap.org',
    targetPort: 443,
    listenPort: 8080,
    platformCategory: category as any,
    injectionPoints,
    headerRules: browserHeaders,
    cookieHeaders: undefined,
  })

  // Generate to temp directory for testing
  const outputDir = path.join(__dirname, '../clones/test-uniswap-mirror/generated')
  const result = generator.generate(outputDir)

  if (result.success) {
    console.log(`✅ Success! Config saved to: ${result.configPath}\n`)
    console.log(`📌 Next steps:`)
    console.log(`   1. Copy config to nginx: cp ${result.configPath} /etc/nginx/nginx.conf`)
    console.log(`   2. Start nginx: nginx`)
    console.log(`   3. Visit http://localhost:8080/swap in browser`)
    console.log(`   4. Check console for legion script loading`)
    console.log(`   5. Monitor /api/v1/scout calls in Network tab\n`)
  } else {
    console.error(`❌ Error: ${result.message}`)
    process.exit(1)
  }

  console.log(`🔗 Generated Config Preview:\n`)
  console.log(`   - Proxies all traffic to app.uniswap.org:443`)
  console.log(`   - Injects legion-loader.js via sub_filter on key pages`)
  console.log(`   - Passes real browser headers (User-Agent, Sec-CH-UA, etc)`)
  console.log(`   - Allows CORS for extraction API calls`)
  console.log(`   - Hides security headers to appear as real browser traffic`)
  console.log(`   - Supports WebSocket upgrade for real-time data\n`)

  console.log(`✨ Phase 1 Complete! Foundation ready for:`)
  console.log(`   - Phase 2: Cookie rotation system`)
  console.log(`   - Phase 3: Category-specific extraction templates`)
  console.log(`   - Phase 4: Intelligent platform detection`)
  console.log(`   - Phase 5: Code generation engines`)
}

main().catch(console.error)
