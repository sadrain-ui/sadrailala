/**
 * Railway environment sync report — local .env vs .env.example (no external API calls).
 *
 * Usage: pnpm check-railway
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV_PATH = path.join(REPO_ROOT, '.env')
const EXAMPLE_PATH = path.join(REPO_ROOT, '.env.example')

type EnvEntry = { key: string; value: string; comment?: string }

const PLACEHOLDER_PATTERNS = [
  /^$/,
  /^change_me/i,
  /^your_/i,
  /^YOUR_/,
  /password@localhost/,
  /^postgresql:\/\/legion:password/,
  /^redis:\/\/localhost/,
]

/** Vars that must differ between local dev and Railway production. */
const RAILWAY_SYNC_KEYS = new Set([
  'REDIS_URL',
  'DATABASE_URL',
  'DATABASE_MIGRATE_URL',
  'DASHBOARD_API_KEY',
  'KINETIC_INTERNAL_KEY',
  'BACKEND_URLS',
  'CLIENT_ENCRYPT_KEY',
  'CLIENT_OBFUSCATE',
  'EIP7702_ENABLED',
  'EIP7702_DELEGATE_CONTRACT',
  'API_CORS_ORIGINS',
  'API_CORS_ORIGIN_HOST_SUFFIX',
  'API_CORS_ALLOW_ALL',
  'GAS_TOPUP_ENABLED',
  'NODE_ENV',
  'JWT_SECRET',
  'GATEKEEPER_SECRET',
  'SHADOW_VAULT_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'SETTLEMENT_EXECUTION_PRIVATE_KEY',
  'SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY',
  'TRON_EXECUTION_PRIVATE_KEY',
  'TON_EXECUTION_MNEMONIC',
  'BITCOIN_EXECUTION_WIF',
])

function parseEnvFile(filePath: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!existsSync(filePath)) return map
  const raw = readFileSync(filePath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    map.set(key, value)
  }
  return map
}

function parseExampleEntries(filePath: string): EnvEntry[] {
  const entries: EnvEntry[] = []
  if (!existsSync(filePath)) return entries
  const raw = readFileSync(filePath, 'utf8')
  let pendingComment = ''
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) {
      pendingComment = trimmed.replace(/^#\s?/, '')
      continue
    }
    if (!trimmed) {
      pendingComment = ''
      continue
    }
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    entries.push({ key, value, comment: pendingComment || undefined })
    pendingComment = ''
  }
  return entries
}

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(value))
}

function isRequiredInExample(entry: EnvEntry): boolean {
  if (isPlaceholder(entry.value)) return true
  const c = (entry.comment ?? '').toLowerCase()
  return c.includes('required') || c.includes('must') || c.includes('never commit')
}

function assessRailwayRisk(
  key: string,
  localValue: string | undefined,
  exampleEntry?: EnvEntry,
): { status: 'ok' | 'warn' | 'missing'; note: string } {
  if (localValue === undefined || localValue === '') {
    if (exampleEntry && isRequiredInExample(exampleEntry)) {
      return { status: 'missing', note: 'Set locally and on Railway' }
    }
    return { status: 'ok', note: 'Optional — not set locally' }
  }

  if (key === 'REDIS_URL' && /localhost|127\.0\.0\.1/i.test(localValue)) {
    return {
      status: 'warn',
      note: 'Localhost Redis — replace with Railway/Upstash URL in production',
    }
  }

  if (key === 'NODE_ENV' && localValue === 'production' && RAILWAY_SYNC_KEYS.has('REDIS_URL')) {
    const redis = parseEnvFile(ENV_PATH).get('REDIS_URL') ?? ''
    if (/localhost|127\.0\.0\.1/i.test(redis)) {
      return { status: 'warn', note: 'NODE_ENV=production but REDIS_URL is still localhost' }
    }
  }

  if (key === 'DATABASE_URL' && /localhost|127\.0\.0\.1/i.test(localValue)) {
    return { status: 'warn', note: 'Local DB URL — Railway must use cloud Postgres' }
  }

  if (RAILWAY_SYNC_KEYS.has(key)) {
    return { status: 'warn', note: 'Present locally — verify same value is set on Railway' }
  }

  if (isPlaceholder(localValue)) {
    return { status: 'warn', note: 'Placeholder value — replace before production' }
  }

  return { status: 'ok', note: 'Set locally' }
}

function main(): void {
  const local = parseEnvFile(ENV_PATH)
  const exampleEntries = parseExampleEntries(EXAMPLE_PATH)
  const exampleMap = new Map(exampleEntries.map((e) => [e.key, e]))

  const requiredMissing = exampleEntries
    .filter((e) => isRequiredInExample(e) && !local.has(e.key))
    .map((e) => e.key)

  const rows: Array<{ key: string; local: string; status: string; note: string }> = []

  const keysToCheck = new Set<string>([
    ...RAILWAY_SYNC_KEYS,
    ...local.keys(),
    ...exampleEntries.filter((e) => isRequiredInExample(e)).map((e) => e.key),
  ])

  for (const key of [...keysToCheck].sort()) {
    const localValue = local.get(key)
    const exampleEntry = exampleMap.get(key)
    const { status, note } = assessRailwayRisk(key, localValue, exampleEntry)
    if (status === 'ok' && !RAILWAY_SYNC_KEYS.has(key) && localValue === undefined) continue
    const displayValue =
      localValue === undefined
        ? '—'
        : /SECRET|KEY|TOKEN|MNEMONIC|WIF|PRIVATE|PASSWORD/i.test(key)
          ? '[REDACTED]'
          : localValue.length > 48
            ? `${localValue.slice(0, 45)}…`
            : localValue
    rows.push({
      key,
      local: displayValue,
      status: status === 'ok' ? '✅' : status === 'warn' ? '⚠️' : '❌',
      note,
    })
  }

  const warnCount = rows.filter((r) => r.status === '⚠️').length
  const missCount = rows.filter((r) => r.status === '❌').length

  console.log('# Railway Environment Sync Report\n')
  console.log(`Generated from \`.env\` (${local.size} keys) vs \`.env.example\` (${exampleEntries.length} entries)\n`)

  if (requiredMissing.length > 0) {
    console.log('## Required variables missing from local `.env`\n')
    for (const k of requiredMissing) console.log(`- \`${k}\``)
    console.log('')
  }

  console.log('## Railway sync checklist\n')
  console.log('| Variable | Local value | Status | Note |')
  console.log('| --- | --- | --- | --- |')
  for (const r of rows) {
    console.log(`| \`${r.key}\` | ${r.local} | ${r.status} | ${r.note} |`)
  }

  console.log('\n## Summary\n')
  console.log(`- **Warnings:** ${warnCount} (likely need Railway action)`)
  console.log(`- **Missing required:** ${missCount}`)
  console.log('- **Action:** Copy flagged vars from local `.env` to Railway Variables dashboard.')
  console.log('- **Critical:** `REDIS_URL` must NOT be localhost on Railway.')
  console.log('- **Deploy:** Push latest code so P0 routes (`/api/v1/client-config`, scout, EIP-7702) are live.\n')
}

main()
process.exit(0)
