/**
 * RPC mesh health — circuit-breaker status per chain with metrics and resilience info.
 */
import type { FastifyInstance } from 'fastify'
import { getRpcMesh } from '@legion/core/lib/rpc-mesh'
import { getMetricsCollector, getCircuitBreaker } from '@legion/core/lib/rpc-resilience'

import { sendSuccess } from '../lib/api-response.js'

export async function registerRpcRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/rpc/status', async (_request, reply) => {
    const mesh = getRpcMesh()
    mesh.refreshAllChains()
    const snapshot = mesh.getStatusSnapshot()

    // Enrich with resilience metrics
    const metrics = mesh.getMetrics()
    const circuitBreakerStatus = {
      'evm:1': getCircuitBreaker('evm:1').getState(),
      'evm:56': getCircuitBreaker('evm:56').getState(),
      'evm:137': getCircuitBreaker('evm:137').getState(),
      'solana': getCircuitBreaker('solana').getState(),
      'aptos': getCircuitBreaker('aptos').getState(),
      'sui': getCircuitBreaker('sui').getState(),
    }

    return sendSuccess(reply, 200, 'RPC mesh status with metrics', {
      mesh: snapshot,
      metrics,
      circuitBreakerStatus,
      timestamp: new Date().toISOString(),
    })
  })

  // New endpoint: Get detailed RPC metrics
  app.get('/api/v1/rpc/metrics', async (_request, reply) => {
    const metrics = getMetricsCollector().getAllMetrics()
    return sendSuccess(reply, 200, 'RPC performance metrics', {
      chains: metrics,
      collectedAt: new Date().toISOString(),
    })
  })

  // New endpoint: Get health check
  app.get('/api/v1/rpc/health', async (_request, reply) => {
    const mesh = getRpcMesh()
    const snapshot = mesh.getStatusSnapshot()

    const totalEndpoints = snapshot.chains.reduce((sum, c) => sum + c.totalEndpoints, 0)
    const deadEndpoints = snapshot.chains.reduce((sum, c) => sum + c.deadCount, 0)
    const healthPercentage = totalEndpoints > 0 ? ((totalEndpoints - deadEndpoints) / totalEndpoints) * 100 : 100

    const isHealthy = healthPercentage >= 75 && snapshot.chains.some((c) => c.activeEndpoint != null)

    return sendSuccess(reply, isHealthy ? 200 : 503, 'RPC health check', {
      healthy: isHealthy,
      healthPercentage: Math.round(healthPercentage),
      totalEndpoints,
      deadEndpoints,
      activeChains: snapshot.chains.filter((c) => c.activeEndpoint != null).length,
      totalChains: snapshot.chains.length,
      circuitBreakerEnabled: snapshot.circuitBreakerEnabled,
      timestamp: new Date().toISOString(),
    })
  })
}
