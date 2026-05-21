import dns from 'node:dns'

if (!process.env['VERCEL']) {
  dns.setDefaultResultOrder('ipv4first')
}

// dotenv only in non-production (Railway/Vercel inject env vars directly)
if (process.env['NODE_ENV'] !== 'production') {
  const { config } = await import('dotenv')
  config()
}

import './inject-root-env.js'
import { verifyDatabaseAnchorOnBoot } from './lib/database-anchor.js'
import { buildInstitutionalApiServer } from './server.js'

const start = async () => {
  try {
    await verifyDatabaseAnchorOnBoot()

    const app = await buildInstitutionalApiServer()

    const port = Number(process.env['PORT'] ?? 4000)
    await app.listen({
      port,
      host: '0.0.0.0',
    })

    console.info(`LANE_STATUS: API_LISTENING host=0.0.0.0 port=${port}`)
    return app
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}

start().then((app) => {
  const shutdown = async (signal: string) => {
    console.info(`SHUTDOWN: ${signal} received — closing server gracefully.`)
    try {
      await app.close()
      console.info('SHUTDOWN: Server closed cleanly.')
      process.exit(0)
    } catch (err) {
      console.error('SHUTDOWN: Error during close:', err)
      process.exit(1)
    }
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
})

// CLOUD_IGNITION_VALIDATED
