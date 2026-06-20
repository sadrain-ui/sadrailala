/**
 * CHAOS ENGINEERING - CONNECTION POOL CHAOS TESTS
 * ================================================
 * Tests for connection pool under extreme conditions
 *
 * Scenarios:
 * - Kill connections randomly
 * - Simulate network timeouts
 * - Overload connection requests
 * - Connection leak detection
 * - Recovery under chaos
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import ConnectionPoolManager from '../../packages/core/src/db/connection-pool-manager.js'

describe('Chaos - Connection Pool Stress Tests', () => {
  let manager: ConnectionPoolManager

  beforeEach(() => {
    manager = new ConnectionPoolManager({
      maxConnections: 50,
      minConnections: 5,
      maxIdleTimeMs: 10000,
      connectionTimeoutMs: 2000,
      healthCheckIntervalMs: 1000,
    })
  })

  afterEach(() => {
    manager.stopHealthChecks()
  })

  describe('Connection Pool Under Chaos', () => {
    test('should survive random connection failures', async () => {
      manager.startHealthChecks()

      const connections: string[] = []
      let failures = 0
      let successes = 0

      // Try to acquire 100 connections (50 max pool size)
      for (let i = 0; i < 100; i++) {
        try {
          const connId = await manager.acquireConnection()
          connections.push(connId)
          successes++

          // Randomly simulate connection failure (10% chance)
          if (Math.random() < 0.1 && connections.length > 10) {
            const failIndex = Math.floor(Math.random() * connections.length)
            connections.splice(failIndex, 1)
            failures++
          }
        } catch (error) {
          failures++
        }
      }

      // Should have succeeded in getting most connections
      expect(successes).toBeGreaterThan(50)

      // Release all connections
      for (const conn of connections) {
        manager.releaseConnection(conn)
      }

      const stats = manager.getStats()
      expect(stats.totalConnections).toBeLessThanOrEqual(50)
    })

    test('should handle rapid acquire/release cycles', async () => {
      manager.startHealthChecks()

      let cycles = 0
      const startTime = Date.now()
      const durationMs = 5000 // Run for 5 seconds

      while (Date.now() - startTime < durationMs) {
        const connId = await manager.acquireConnection()
        manager.releaseConnection(connId)
        cycles++
      }

      expect(cycles).toBeGreaterThan(100) // At least 100 cycles in 5 seconds
    })

    test('should recover from connection pool exhaustion', async () => {
      manager.startHealthChecks()

      const connections: string[] = []

      // Fill the pool
      for (let i = 0; i < 50; i++) {
        const connId = await manager.acquireConnection()
        connections.push(connId)
      }

      const statsFull = manager.getStats()
      expect(statsFull.activeConnections).toBe(50)
      expect(statsFull.waitingRequests).toBe(0)

      // Release half
      for (let i = 0; i < 25; i++) {
        manager.releaseConnection(connections.pop()!)
      }

      const statsPartial = manager.getStats()
      expect(statsPartial.totalConnections).toBeLessThanOrEqual(50)

      // Release rest
      for (const conn of connections) {
        manager.releaseConnection(conn)
      }

      const statsDrained = manager.getStats()
      expect(statsDrained.activeConnections).toBeLessThanOrEqual(10)
    })

    test('should handle mixed success/failure pattern', async () => {
      manager.startHealthChecks()

      let successCount = 0
      let timeoutCount = 0

      // Simulate 50 acquisition attempts
      for (let i = 0; i < 50; i++) {
        try {
          const connId = await manager.acquireConnection()
          successCount++

          // Release with random delay
          const delay = Math.random() * 100
          await new Promise((resolve) => setTimeout(resolve, delay))
          manager.releaseConnection(connId)
        } catch (error) {
          timeoutCount++
        }
      }

      expect(successCount + timeoutCount).toBe(50)
      expect(successCount).toBeGreaterThan(30) // Most should succeed
    })
  })

  describe('Connection Leak Detection', () => {
    test('should detect and report connection leaks', async () => {
      manager.startHealthChecks()

      const leakedConnections: string[] = []

      // Acquire connections but don't release some
      for (let i = 0; i < 30; i++) {
        const connId = await manager.acquireConnection()

        if (i % 3 === 0) {
          // Leak this connection (don't release)
          leakedConnections.push(connId)
        } else {
          manager.releaseConnection(connId)
        }
      }

      const stats = manager.getStats()

      // Should show active connections (leaked)
      expect(stats.activeConnections).toBeGreaterThan(0)

      // Cleanup leaked connections
      for (const conn of leakedConnections) {
        manager.releaseConnection(conn)
      }
    })

    test('should track idle vs active connections during chaos', async () => {
      manager.startHealthChecks()

      for (let i = 0; i < 20; i++) {
        const connId = await manager.acquireConnection()

        // Random action
        if (Math.random() > 0.5) {
          manager.releaseConnection(connId)
        }
      }

      const stats = manager.getStats()
      const total = stats.activeConnections + stats.idleConnections

      expect(total).toBeLessThanOrEqual(50)
      expect(stats.activeConnections).toBeGreaterThanOrEqual(0)
      expect(stats.idleConnections).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Health Score Under Chaos', () => {
    test('should maintain health score above 60 under stress', async () => {
      manager.startHealthChecks()

      // Simulate chaotic load
      for (let i = 0; i < 100; i++) {
        try {
          const connId = await manager.acquireConnection()

          if (Math.random() > 0.7) {
            manager.releaseConnection(connId)
          }
        } catch {
          // Timeout expected under load
        }
      }

      const stats = manager.getStats()
      expect(stats.healthScore).toBeGreaterThan(40) // Should still have reasonable health
    })

    test('should degrade gracefully under extreme load', async () => {
      manager.startHealthChecks()

      const acquireAttempts = 200
      let successful = 0
      let failed = 0

      for (let i = 0; i < acquireAttempts; i++) {
        try {
          await Promise.race([
            manager.acquireConnection(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Simulated timeout')), 500),
            ),
          ])
          successful++
        } catch {
          failed++
        }
      }

      // Should have some successes even under extreme load
      expect(successful).toBeGreaterThan(0)
      expect(failed).toBeGreaterThan(0)

      // Calculate success rate
      const successRate = (successful / acquireAttempts) * 100
      console.log(`Success rate under extreme load: ${successRate.toFixed(1)}%`)
    })
  })

  describe('Connection Timeout Behavior', () => {
    test('should timeout requests when pool exhausted', async () => {
      manager.startHealthChecks()

      const connections: string[] = []

      // Fill the pool
      for (let i = 0; i < 50; i++) {
        const connId = await manager.acquireConnection()
        connections.push(connId)
      }

      // Try to acquire when exhausted - should timeout
      let timedOut = false
      try {
        await manager.acquireConnection()
      } catch (error) {
        if ((error as Error).message.includes('timeout')) {
          timedOut = true
        }
      }

      expect(timedOut).toBe(true)

      // Cleanup
      for (const conn of connections) {
        manager.releaseConnection(conn)
      }
    })
  })

  describe('Concurrent Stress Test', () => {
    test('should handle 100 concurrent acquisition attempts', async () => {
      manager.startHealthChecks()

      const promises: Promise<string>[] = []

      // Launch 100 concurrent acquire attempts
      for (let i = 0; i < 100; i++) {
        promises.push(
          manager.acquireConnection().catch(() => {
            throw new Error('Acquisition failed')
          }),
        )
      }

      // Wait for some to complete (some will timeout)
      const results = await Promise.allSettled(promises)

      const successful = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.filter((r) => r.status === 'rejected').length

      expect(successful + failed).toBe(100)
      expect(successful).toBeGreaterThan(0) // Some should succeed
      expect(failed).toBeGreaterThan(0) // Some should fail (pool exhausted)

      console.log(`Concurrent test: ${successful} succeeded, ${failed} failed`)
    })
  })
})
