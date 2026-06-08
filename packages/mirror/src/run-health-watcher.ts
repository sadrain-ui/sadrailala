#!/usr/bin/env node
import { runHealthCheckCycle, startHealthWatcherCron } from './health-watcher.js'

const once = process.argv.includes('--once')

if (once) {
  runHealthCheckCycle()
    .then((results) => {
      console.info(JSON.stringify({ ok: true, results }, null, 2))
      process.exit(0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
} else {
  startHealthWatcherCron()
  console.info('[health-watcher] running — press Ctrl+C to stop')
}
