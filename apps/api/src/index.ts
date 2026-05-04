import Fastify from 'fastify'

import { registerMultiOriginMeshIngress } from './cors-mesh.js'
import { registerHealthRoute } from './routes/health.js'
import { registerCommandCenterSignaturesRoute } from './routes/command-center-signatures.js'

const app = Fastify({
  logger: {
    level: process.env['LOG_LEVEL'] ?? 'info',
  },
})

const start = async () => {
  try {
    await registerMultiOriginMeshIngress(app)

    await registerHealthRoute(app)

    await registerCommandCenterSignaturesRoute(app)

    // TODO: Register route modules
    // app.register(import('./routes/auth.js'))
    // app.register(import('./routes/jobs.js'))
    // app.register(import('./routes/sentinels.js'))

    await app.listen({
      port: Number(process.env['PORT'] ?? 4000),
      host: '0.0.0.0',
    })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
