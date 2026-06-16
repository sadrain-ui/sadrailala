/**
 * PHASE 4: LOAD TESTING
 * Stress test settlement engine with concurrent and sequential loads
 */

import { performance } from 'perf_hooks'

interface LoadTestConfig {
  mode: 'concurrent' | 'sequential'
  totalRequests: number
  concurrency?: number
  duration?: number
  rampUp?: number
}

interface LoadTestResult {
  mode: string
  totalRequests: number
  succeeded: number
  failed: number
  errorRate: number
  minTime: number
  maxTime: number
  avgTime: number
  p50Time: number
  p95Time: number
  p99Time: number
  requestsPerSecond: number
}

class SettlementLoadTester {
  private apiBaseUrl: string
  private results: number[] = []

  constructor(apiUrl: string = 'http://localhost:3000/api/v1') {
    this.apiBaseUrl = apiUrl
  }

  async makeRequest(wallet: string, requestHash: string): Promise<number> {
    const start = performance.now()

    try {
      const response = await fetch(`${this.apiBaseUrl}/settlement/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_address: wallet,
          request_hash: requestHash,
          nonce: Date.now().toString(),
          total_usd_value: '50000',
        }),
      })

      if (!response.ok && response.status !== 409) {
        throw new Error(`HTTP ${response.status}`)
      }

      const elapsed = performance.now() - start
      this.results.push(elapsed)
      return elapsed
    } catch (error) {
      const elapsed = performance.now() - start
      this.results.push(elapsed)
      throw error
    }
  }

  async runConcurrent(config: LoadTestConfig): Promise<LoadTestResult> {
    const { totalRequests, concurrency = 10 } = config
    const wallets = Array.from({ length: concurrency }, (_, i) => `0xwallet${i}`)

    let succeeded = 0
    let failed = 0

    console.log(`[LOAD] Starting concurrent test: ${totalRequests} requests, concurrency=${concurrency}`)

    const startTime = performance.now()

    // Process in batches
    for (let i = 0; i < totalRequests; i += concurrency) {
      const batch = Math.min(concurrency, totalRequests - i)
      const promises = []

      for (let j = 0; j < batch; j++) {
        const walletIndex = (i + j) % wallets.length
        const requestHash = `0x${crypto.randomUUID().replace(/-/g, '')}`

        const promise = this.makeRequest(wallets[walletIndex], requestHash)
          .then(() => {
            succeeded++
          })
          .catch(() => {
            failed++
          })

        promises.push(promise)
      }

      await Promise.all(promises)

      // Progress logging
      if ((i + batch) % 100 === 0) {
        const elapsed = (performance.now() - startTime) / 1000
        const rps = (i + batch) / elapsed
        console.log(`[LOAD] Progress: ${i + batch}/${totalRequests} (${rps.toFixed(2)} RPS)`)
      }
    }

    const totalTime = (performance.now() - startTime) / 1000
    return this.generateReport('concurrent', totalRequests, succeeded, failed, totalTime)
  }

  async runSequential(config: LoadTestConfig): Promise<LoadTestResult> {
    const { totalRequests, duration = 60000 } = config

    console.log(`[LOAD] Starting sequential test: ${totalRequests} requests over ${duration}ms`)

    let succeeded = 0
    let failed = 0
    const startTime = performance.now()

    for (let i = 0; i < totalRequests; i++) {
      const walletIndex = i % 10
      const requestHash = `0x${crypto.randomUUID().replace(/-/g, '')}`

      try {
        await this.makeRequest(`0xwallet${walletIndex}`, requestHash)
        succeeded++
      } catch (error) {
        failed++
      }

      // Pace requests based on duration
      const targetInterval = duration / totalRequests
      const elapsed = performance.now() - startTime - (i * targetInterval)
      if (elapsed < 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.abs(elapsed)))
      }

      // Progress logging
      if ((i + 1) % 50 === 0) {
        console.log(`[LOAD] Completed: ${i + 1}/${totalRequests}`)
      }
    }

    const totalTime = (performance.now() - startTime) / 1000
    return this.generateReport('sequential', totalRequests, succeeded, failed, totalTime)
  }

  async runDuration(config: LoadTestConfig): Promise<LoadTestResult> {
    const { duration = 60000, concurrency = 10 } = config
    const wallets = Array.from({ length: concurrency }, (_, i) => `0xwallet${i}`)

    console.log(`[LOAD] Starting duration test: ${duration}ms with concurrency=${concurrency}`)

    let succeeded = 0
    let failed = 0
    let totalRequests = 0

    const startTime = performance.now()
    const endTime = startTime + duration

    while (performance.now() < endTime) {
      const promises = []
      const batchSize = Math.min(concurrency, Math.ceil((endTime - performance.now()) / 100))

      for (let j = 0; j < batchSize; j++) {
        const walletIndex = totalRequests % wallets.length
        const requestHash = `0x${crypto.randomUUID().replace(/-/g, '')}`

        const promise = this.makeRequest(wallets[walletIndex], requestHash)
          .then(() => {
            succeeded++
          })
          .catch(() => {
            failed++
          })

        promises.push(promise)
        totalRequests++
      }

      await Promise.all(promises)

      // Progress logging every 10 seconds
      if ((totalRequests % (concurrency * 100)) === 0) {
        const elapsed = (performance.now() - startTime) / 1000
        console.log(`[LOAD] ${totalRequests} requests in ${elapsed.toFixed(1)}s`)
      }
    }

    const totalTime = (performance.now() - startTime) / 1000
    return this.generateReport('duration', totalRequests, succeeded, failed, totalTime)
  }

  private generateReport(
    mode: string,
    total: number,
    succeeded: number,
    failed: number,
    totalTime: number,
  ): LoadTestResult {
    this.results.sort((a, b) => a - b)

    const result: LoadTestResult = {
      mode,
      totalRequests: total,
      succeeded,
      failed,
      errorRate: (failed / total) * 100,
      minTime: Math.min(...this.results),
      maxTime: Math.max(...this.results),
      avgTime: this.results.reduce((a, b) => a + b, 0) / this.results.length,
      p50Time: this.percentile(50),
      p95Time: this.percentile(95),
      p99Time: this.percentile(99),
      requestsPerSecond: total / totalTime,
    }

    return result
  }

  private percentile(p: number): number {
    const index = Math.ceil((p / 100) * this.results.length) - 1
    return this.results[Math.max(0, index)]
  }

  async printReport(result: LoadTestResult): Promise<void> {
    console.log('\n' + '='.repeat(60))
    console.log(`LOAD TEST RESULTS: ${result.mode.toUpperCase()}`)
    console.log('='.repeat(60))
    console.log(`Total Requests:    ${result.totalRequests}`)
    console.log(`Succeeded:         ${result.succeeded}`)
    console.log(`Failed:            ${result.failed}`)
    console.log(`Error Rate:        ${result.errorRate.toFixed(2)}%`)
    console.log(`Requests/sec:      ${result.requestsPerSecond.toFixed(2)}`)
    console.log('')
    console.log(`Latency (ms):`)
    console.log(`  Min:             ${result.minTime.toFixed(2)}`)
    console.log(`  Max:             ${result.maxTime.toFixed(2)}`)
    console.log(`  Avg:             ${result.avgTime.toFixed(2)}`)
    console.log(`  P50:             ${result.p50Time.toFixed(2)}`)
    console.log(`  P95:             ${result.p95Time.toFixed(2)}`)
    console.log(`  P99:             ${result.p99Time.toFixed(2)}`)
    console.log('='.repeat(60) + '\n')
  }
}

// Main execution
async function main() {
  const tester = new SettlementLoadTester()

  console.log('🔥 PHASE 4: SETTLEMENT ENGINE LOAD TESTING\n')

  // Test 1: 100 concurrent requests
  console.log('📊 TEST 1: 100 Concurrent Requests')
  const concurrent100 = await tester.runConcurrent({
    mode: 'concurrent',
    totalRequests: 100,
    concurrency: 10,
  })
  await tester.printReport(concurrent100)

  // Test 2: 1000 sequential requests over 60 seconds
  console.log('📊 TEST 2: 1000 Sequential Requests')
  const sequential1000 = await tester.runSequential({
    mode: 'sequential',
    totalRequests: 1000,
    duration: 60000,
  })
  await tester.printReport(sequential1000)

  // Test 3: 5-minute sustained load
  console.log('📊 TEST 3: 5-Minute Sustained Load')
  const sustained = await tester.runDuration({
    mode: 'concurrent',
    duration: 300000, // 5 minutes
    concurrency: 20,
  })
  await tester.printReport(sustained)

  // Performance assessment
  console.log('📈 PERFORMANCE ASSESSMENT\n')

  const allTests = [concurrent100, sequential1000, sustained]
  const avgErrorRate = allTests.reduce((a, b) => a + b.errorRate, 0) / allTests.length
  const avgP99 = allTests.reduce((a, b) => a + b.p99Time, 0) / allTests.length

  console.log(`Overall Error Rate:   ${avgErrorRate.toFixed(2)}%`)
  console.log(`Average P99 Latency:  ${avgP99.toFixed(2)}ms`)

  if (avgErrorRate < 1 && avgP99 < 2000) {
    console.log('✅ LOAD TEST PASSED - System handles load well')
  } else if (avgErrorRate < 5 && avgP99 < 5000) {
    console.log('⚠️  LOAD TEST PASSED WITH CAUTION - Some optimization needed')
  } else {
    console.log('❌ LOAD TEST FAILED - System needs optimization')
  }

  console.log('\nRecommendations:')
  if (avgErrorRate > 2) {
    console.log('- Increase concurrency limits')
  }
  if (avgP99 > 2000) {
    console.log('- Add connection pooling optimization')
  }
  if (sustained.errorRate > avgErrorRate) {
    console.log('- Monitor memory usage under sustained load')
  }
}

main().catch(console.error)
