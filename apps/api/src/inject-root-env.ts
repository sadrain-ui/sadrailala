/**
 * Absolute Injection Lock — Path Discovery for repo-root `.env` from `apps/api` (Sensory Recovery vs localhost defaults).
 * Production: env vars are injected by Railway/Docker — dotenv only runs in non-production.
 */
import { config } from 'dotenv'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Path Discovery — ordered candidates: module anchor, cwd-relative, then upward walk from `process.cwd()`. */
function discoverRootEnvPath(): string {
  const ordered: string[] = [
    resolve(__dirname, '../../.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(process.cwd(), '../.env'),
    resolve(process.cwd(), '.env'),
  ]
  let dir = process.cwd()
  for (let i = 0; i < 16; i++) {
    ordered.push(resolve(dir, '.env'))
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  const seen = new Set<string>()
  for (const p of ordered) {
    if (seen.has(p)) continue
    seen.add(p)
    if (existsSync(p)) return p
  }

  return resolve(process.cwd(), '../../.env')
}

// Only load .env file in non-production environments.
// In production (Railway/Docker), env vars are injected directly — no file needed.
if (process.env['NODE_ENV'] !== 'production') {
  const rootEnvPath = discoverRootEnvPath()
  config({ path: rootEnvPath })
}

function assertRequiredOmniEnv(): void {
  const required = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET'] as const
  const missing = required.filter((key) => !process.env[key]?.trim())
  if (missing.length > 0) {
    throw new Error(
      `FATAL_ENV_VALIDATION: Missing required env key(s): ${missing.join(', ')}`,
    )
  }
}

assertRequiredOmniEnv()

if (!process.env['REDIS_URL']?.trim()) {
  console.error('CRITICAL: REDIS_URL NOT FOUND IN ENV. CHECK CONFIGURATION.')
}
