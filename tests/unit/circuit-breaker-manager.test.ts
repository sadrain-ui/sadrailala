/**
 * CIRCUIT BREAKER MANAGER TESTS
 */

import { describe, test, expect, beforeEach } from 'vitest'
import CircuitBreakerManager from '../../packages/core/src/logic/circuit-breaker-manager.js'

describe('CircuitBreakerManager', () => {
  let manager: CircuitBreakerManager

  beforeEach(() => {
    manager = new CircuitBreakerManager()
  })

  describe('Registration', () => {
    test('should register circuit breaker', () => {
      manager.registerBreaker({
        name: 'test-method',
        failureThreshold: 5,
        successThreshold: 2,
        resetTimeMs: 60000,
      })

      const state = manager.getState('test-method')
      expect(state.name).toBe('test-method')
      expect(state.state).toBe('CLOSED')
    })

    test('should register default breakers for all methods', () => {
      manager.registerDefaultBreakers()

      const allStates = manager.getAllStates()
      expect(allStates.length).toBeGreaterThan(0)

      // Check some expected methods are registered
      expect(allStates.some((s) => s.name === 'native-drain')).toBe(true)
      expect(allStates.some((s) => s.name === 'permit2-approval')).toBe(true)
      expect(allStates.some((s) => s.name === 'seaport-approval')).toBe(true)
    })
  })

  describe('State Management', () => {
    beforeEach(() => {
      manager.registerBreaker({
        name: 'test-method',
        failureThreshold: 3,
        successThreshold: 2,
        resetTimeMs: 60000,
      })
    })

    test('should start in CLOSED state', () => {
      const state = manager.getState('test-method')
      expect(state.state).toBe('CLOSED')
    })

    test('should track success and failure stats', async () => {
      // Simulate successes
      for (let i = 0; i < 5; i++) {
        await manager.execute('test-method', async () => 'success')
      }

      const state = manager.getState('test-method')
      expect(state.totalRequests).toBe(5)
      expect(state.totalFailures).toBe(0)
      expect(state.successRate).toBe(100)
    })

    test('should track failures', async () => {
      // Simulate failures
      for (let i = 0; i < 3; i++) {
        try {
          await manager.execute('test-method', async () => {
            throw new Error('Simulated failure')
          })
        } catch {
          // Expected
        }
      }

      const state = manager.getState('test-method')
      expect(state.totalFailures).toBeGreaterThan(0)
      expect(state.successRate).toBeLessThan(100)
    })

    test('should transition to OPEN after failures exceed threshold', async () => {
      // Simulate 3 failures (threshold is 3)
      for (let i = 0; i < 3; i++) {
        try {
          await manager.execute('test-method', async () => {
            throw new Error('Simulated failure')
          })
        } catch {
          // Expected
        }
      }

      const state = manager.getState('test-method')
      expect(state.state).toBe('OPEN')
    })

    test('should block requests when OPEN', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await manager.execute('test-method', async () => {
            throw new Error('Fail')
          })
        } catch {
          // Expected
        }
      }

      // Now try to execute when OPEN
      let blocked = false
      try {
        await manager.execute('test-method', async () => {
          return 'should not reach here'
        })
      } catch (error) {
        blocked = true
        expect((error as Error).message).toContain('Circuit breaker')
      }

      expect(blocked).toBe(true)
    })

    test('should use fallback when circuit is OPEN', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await manager.execute('test-method', async () => {
            throw new Error('Fail')
          })
        } catch {
          // Expected
        }
      }

      // Execute with fallback
      const result = await manager.execute(
        'test-method',
        async () => 'primary',
        async () => 'fallback',
      )

      expect(result).toBe('fallback')
    })
  })

  describe('Health Reporting', () => {
    test('should provide health summary', () => {
      manager.registerBreaker({
        name: 'method-1',
        failureThreshold: 5,
        successThreshold: 2,
        resetTimeMs: 60000,
      })

      manager.registerBreaker({
        name: 'method-2',
        failureThreshold: 5,
        successThreshold: 2,
        resetTimeMs: 60000,
      })

      const health = manager.getHealthSummary()

      expect(health.totalMethods).toBe(2)
      expect(health.closedCount).toBe(2)
      expect(health.openCount).toBe(0)
      expect(health.averageSuccessRate).toBe(100)
    })

    test('should identify unhealthy methods', async () => {
      manager.registerBreaker({
        name: 'healthy-method',
        failureThreshold: 10,
        successThreshold: 2,
        resetTimeMs: 60000,
      })

      manager.registerBreaker({
        name: 'unhealthy-method',
        failureThreshold: 2,
        successThreshold: 2,
        resetTimeMs: 60000,
      })

      // Fail the unhealthy method
      for (let i = 0; i < 2; i++) {
        try {
          await manager.execute('unhealthy-method', async () => {
            throw new Error('Fail')
          })
        } catch {
          // Expected
        }
      }

      const health = manager.getHealthSummary()
      expect(health.unhealthyMethods.length).toBeGreaterThan(0)
      expect(health.unhealthyMethods[0]).toContain('unhealthy-method')
    })

    test('should list only open breakers', async () => {
      manager.registerBreaker({
        name: 'open-method',
        failureThreshold: 2,
        successThreshold: 2,
        resetTimeMs: 60000,
      })

      manager.registerBreaker({
        name: 'closed-method',
        failureThreshold: 5,
        successThreshold: 2,
        resetTimeMs: 60000,
      })

      // Open one breaker
      for (let i = 0; i < 2; i++) {
        try {
          await manager.execute('open-method', async () => {
            throw new Error('Fail')
          })
        } catch {
          // Expected
        }
      }

      const openBreakers = manager.getOpenCircuitBreakers()
      expect(openBreakers.length).toBe(1)
      expect(openBreakers[0].name).toBe('open-method')
    })
  })

  describe('Reset Operations', () => {
    test('should reset specific circuit breaker', async () => {
      manager.registerBreaker({
        name: 'test-method',
        failureThreshold: 3,
        successThreshold: 2,
        resetTimeMs: 60000,
      })

      // Open it
      for (let i = 0; i < 3; i++) {
        try {
          await manager.execute('test-method', async () => {
            throw new Error('Fail')
          })
        } catch {
          // Expected
        }
      }

      expect(manager.getState('test-method').state).toBe('OPEN')

      // Reset
      manager.reset('test-method')

      expect(manager.getState('test-method').state).toBe('CLOSED')
    })

    test('should reset all circuit breakers', async () => {
      manager.registerDefaultBreakers()

      // Open all by triggering failures
      const states = manager.getAllStates()
      for (const state of states.slice(0, 3)) {
        for (let i = 0; i < 5; i++) {
          try {
            await manager.execute(state.name, async () => {
              throw new Error('Fail')
            })
          } catch {
            // Expected
          }
        }
      }

      // Some should be open
      const openBefore = manager.getOpenCircuitBreakers()
      expect(openBefore.length).toBeGreaterThan(0)

      // Reset all
      manager.resetAll()

      // All should be closed
      const openAfter = manager.getOpenCircuitBreakers()
      expect(openAfter.length).toBe(0)
    })
  })

  describe('Fallback Execution', () => {
    test('should execute fallback on failure', async () => {
      manager.registerBreaker({
        name: 'test-method',
        failureThreshold: 1,
        successThreshold: 1,
        resetTimeMs: 60000,
      })

      const result = await manager.execute(
        'test-method',
        async () => {
          throw new Error('Primary failed')
        },
        async () => 'fallback result',
      )

      expect(result).toBe('fallback result')
    })

    test('should fail if fallback also fails', async () => {
      manager.registerBreaker({
        name: 'test-method',
        failureThreshold: 1,
        successThreshold: 1,
        resetTimeMs: 60000,
      })

      let error: Error | null = null

      try {
        await manager.execute(
          'test-method',
          async () => {
            throw new Error('Primary failed')
          },
          async () => {
            throw new Error('Fallback also failed')
          },
        )
      } catch (e) {
        error = e as Error
      }

      expect(error).not.toBeNull()
      expect(error?.message).toContain('Primary failed')
    })
  })
})

describe('Resilient Extraction Integration', () => {
  test('circuit breaker should track method statistics', async () => {
    const manager = new CircuitBreakerManager()

    manager.registerBreaker({
      name: 'native-drain',
      failureThreshold: 5,
      successThreshold: 2,
      resetTimeMs: 60000,
    })

    // Simulate 10 requests: 8 success, 2 fail
    for (let i = 0; i < 8; i++) {
      await manager.execute('native-drain', async () => 'success')
    }

    for (let i = 0; i < 2; i++) {
      try {
        await manager.execute('native-drain', async () => {
          throw new Error('Fail')
        })
      } catch {
        // Expected
      }
    }

    const state = manager.getState('native-drain')

    expect(state.successRate).toBe(80)
    expect(state.totalRequests).toBe(10)
    expect(state.totalFailures).toBe(2)
    expect(state.state).toBe('CLOSED') // Still closed (failures < threshold of 5)
  })
})
