import Fastify from 'fastify'

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
})

// Health check
app.get('/health', async () => ({
  status: 'ok',
  service: 'legion-engine-api',
  timestamp: new Date().toISOString(),
}))

// TODO: Register route modules
// app.register(import('./routes/auth.js'))
// app.register(import('./routes/jobs.js'))
// app.register(import('./routes/sentinels.js'))

const start = async () => {
  try {
    await app.listen({
      port: Number(process.env.PORT ?? 4000),
      host: '0.0.0.0',
    })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
