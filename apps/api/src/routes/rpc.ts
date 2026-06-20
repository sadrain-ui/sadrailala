/**
 * RPC mesh health — circuit-breaker status per chain.
 */
import type { FastifyInstance } from 'fastify'
import { getRpcMesh } from '@legion/core/lib/rpc-mesh'

import { sendSuccess } from '../lib/api-response.js'

export async function registerRpcRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/rpc/status', async (_request, reply) => {
    const mesh = getRpcMesh()
    mesh.refreshAllChains()
    const snapshot = mesh.getStatusSnapshot()
    return sendSuccess(reply, 200, 'RPC mesh status', snapshot)
  })
}
