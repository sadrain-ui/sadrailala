import { defineConfig } from 'drizzle-kit'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { dirname, join, resolve } from 'path'

import { resolveDatabaseAnchorConnectionString } from './src/logic/database-anchor'

function hydrateEnvFromRootDotEnv(): void {
  const workspaceRoot = findWorkspaceRoot(process.cwd())
  purgeDuplicateDotEnvFiles(workspaceRoot)
  const rootEnv = join(workspaceRoot, '.env')
  if (!existsSync(rootEnv)) return

  const rootMap = readDotEnvMap(rootEnv)
  for (const key of rootMap.keys()) {
    delete process.env[key]
  }
  for (const [key, value] of rootMap) {
    process.env[key] = value
  }
}

function findWorkspaceRoot(startDir: string): string {
  let dir = resolve(startDir)

  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir

    const parent = dirname(dir)
    if (parent === dir) return resolve(startDir)
    dir = parent
  }
}

function readDotEnvMap(envPath: string): Map<string, string> {
  const raw = readFileSync(envPath, 'utf8')
  const out = new Map<string, string>()
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const equalsIdx = trimmed.indexOf('=')
    if (equalsIdx <= 0) continue

    const key = trimmed.slice(0, equalsIdx).trim()
    const value = trimmed.slice(equalsIdx + 1).trim()
    out.set(key, unquoteEnvValue(value))
  }
  return out
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function purgeDuplicateDotEnvFiles(workspaceRoot: string): void {
  for (const duplicatePath of [
    join(workspaceRoot, 'apps', 'api', '.env'),
    join(workspaceRoot, 'packages', 'core', '.env'),
  ]) {
    if (!existsSync(duplicatePath)) continue
    for (const key of readDotEnvMap(duplicatePath).keys()) {
      delete process.env[key]
    }
    unlinkSync(duplicatePath)
  }
}

hydrateEnvFromRootDotEnv()

function normalizeDatabaseUrl(url: string | undefined): string | undefined {
  if (!url || !url.startsWith('postgres')) return url
  return resolveDatabaseAnchorConnectionString(url)
}

/**
 * Prefer DATABASE_MIGRATE_URL / DIRECT_DATABASE_URL for drizzle-kit — Supabase transaction pooler
 * (:6543) often rejects migration sessions with “tenant/user … not found”. Use the Database
 * Settings “Direct connection” or “Session pooler” URI from the Supabase dashboard for DDL.
 */
const rawDbUrl =
  process.env['DATABASE_MIGRATE_URL']?.trim() ||
  process.env['DIRECT_DATABASE_URL']?.trim() ||
  process.env['DATABASE_URL']?.trim()

const databaseUrl = normalizeDatabaseUrl(rawDbUrl)

if (!databaseUrl) {
  throw new Error(
    '[drizzle] No database URL: set DATABASE_URL or DATABASE_MIGRATE_URL (direct/session URI). Check root .env.',
  )
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
