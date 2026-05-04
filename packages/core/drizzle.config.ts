import { defineConfig } from 'drizzle-kit'
import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'

function hydrateEnvFromNearestDotEnv(): void {
  let dir = resolve(process.cwd())

  while (true) {
    const candidate = join(dir, '.env')
    if (existsSync(candidate)) {
      const raw = readFileSync(candidate, 'utf8')
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue

        const equalsIdx = trimmed.indexOf('=')
        if (equalsIdx <= 0) continue

        const key = trimmed.slice(0, equalsIdx).trim()
        const value = trimmed.slice(equalsIdx + 1).trim()
        if (process.env[key] == null || process.env[key] === '') {
          process.env[key] = value
        }
      }
      return
    }

    const parent = dirname(dir)
    if (parent === dir) return
    dir = parent
  }
}

hydrateEnvFromNearestDotEnv()

function normalizeDatabaseUrl(url: string | undefined): string | undefined {
  if (!url || !url.startsWith('postgres')) return url

  const protocolSep = url.indexOf('://')
  const lastAt = url.lastIndexOf('@')
  if (protocolSep < 0 || lastAt < 0) return url

  const protocol = url.slice(0, protocolSep + 3)
  const auth = url.slice(protocolSep + 3, lastAt)
  const hostAndPath = url.slice(lastAt + 1)
  const passwordSep = auth.indexOf(':')
  if (passwordSep < 0) return url

  const user = auth.slice(0, passwordSep)
  const password = auth.slice(passwordSep + 1)
  let decodedPassword = password
  try {
    decodedPassword = decodeURIComponent(password)
  } catch {
    decodedPassword = password
  }
  if (decodedPassword.startsWith('[') && decodedPassword.endsWith(']') && decodedPassword.length > 2) {
    decodedPassword = decodedPassword.slice(1, -1)
  }

  return `${protocol}${user}:${encodeURIComponent(decodedPassword)}@${hostAndPath}`
}

const databaseUrl = normalizeDatabaseUrl(process.env['DATABASE_URL'])

if (!databaseUrl) {
  throw new Error('[drizzle] DATABASE_URL is not set. Check root .env.')
}

export default defineConfig({
  // Schema source — Forge owns this file (docs/research/drizzle.md §Migration Model)
  schema: './src/db/schema.ts',

  // Migration output — forward-only SQL files, never edited after apply
  // Naming: drizzle-kit generates lexically ordered files (0000_, 0001_, …)
  out: './src/db/migrations',

  dialect: 'postgresql',

  dbCredentials: {
    // Loaded from environment — never hardcoded (CLAUDE.md rule 4)
    url: databaseUrl,
  },

  // Verbose output for Forge audit trail
  verbose: true,
  strict: true,
})
