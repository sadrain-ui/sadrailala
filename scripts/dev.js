/**
 * Cross-platform dev bootstrap — build @legion/core (dist exports) then start API watch mode.
 * Usage: node scripts/dev.js   (from repo root)
 */
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const isWin = process.platform === 'win32'

function runSync(label, args, cwd = root) {
  console.info(`[dev] ${label}…`)
  const result = spawnSync('pnpm', args, {
    cwd,
    stdio: 'inherit',
    shell: isWin,
    env: process.env,
  })
  if (result.status !== 0) {
    console.error(`[dev] ${label} failed (exit ${result.status ?? 1})`)
    process.exit(result.status ?? 1)
  }
}

function runWatch(label, args, cwd = root) {
  console.info(`[dev] ${label}…`)
  const child = spawn('pnpm', args, {
    cwd,
    stdio: 'inherit',
    shell: isWin,
    env: process.env,
  })
  child.on('exit', (code, signal) => {
    if (signal) {
      console.info(`[dev] ${label} stopped (${signal})`)
      process.exit(0)
    }
    process.exit(code ?? 0)
  })
  process.on('SIGINT', () => child.kill('SIGINT'))
  process.on('SIGTERM', () => child.kill('SIGTERM'))
}

runSync('Building @legion/core', ['--filter', '@legion/core', 'build'])

runWatch('Starting @legion/api dev (tsx watch)', ['--filter', '@legion/api', 'dev'])
