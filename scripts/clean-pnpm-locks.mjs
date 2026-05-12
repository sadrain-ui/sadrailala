import { rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const pnpmDir = join(root, 'node_modules', '.pnpm')

const targets = [
  join(root, 'node_modules', '.modules.yaml.tmp'),
  join(root, 'node_modules', '.pnpm-debug.log'),
  join(pnpmDir, 'lock.yaml'),
  join(pnpmDir, 'tmp'),
  join(pnpmDir, '.tmp'),
  join(pnpmDir, 'node_modules', '.tmp'),
]

const win32Retry = process.platform === 'win32'
const maxRetries = win32Retry ? 6 : 2

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function removeTarget(path) {
  if (!(await exists(path))) return

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 })
      process.stdout.write(`[build-gate] removed ${path}\n`)
      return
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
      if (!win32Retry || (code !== 'EBUSY' && code !== 'EPERM') || attempt === maxRetries) {
        process.stderr.write(`[build-gate] cleanup skipped ${path}: ${error instanceof Error ? error.message : String(error)}\n`)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 500))
    }
  }
}

if (!(await exists(pnpmDir))) {
  process.stdout.write('[build-gate] pnpm store absent; cleanup skipped\n')
  process.exit(0)
}

for (const target of targets) {
  await removeTarget(target)
}

process.stdout.write('[build-gate] pnpm lock cleanup complete\n')
