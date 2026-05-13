import dns from 'node:dns'

if (!process.env['VERCEL']) {
  dns.setDefaultResultOrder('ipv4first')
}

import 'dotenv/config'
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
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}

start()
