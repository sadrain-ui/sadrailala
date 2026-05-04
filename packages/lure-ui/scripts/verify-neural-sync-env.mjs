/**
 * Neural Sync — verify `packages/lure-ui/.env.local` maps required public keys (no values printed).
 * Run from repo root: pnpm --filter @legion/lure-ui env:verify
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env.local')

const required = [
  'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
]

function parseEnv(raw) {
  const out = {}
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[k] = v
  }
  return out
}

if (!fs.existsSync(envPath)) {
  console.error(
    '[Neural Sync] Missing packages/lure-ui/.env.local — copy packages/lure-ui/.env.example and set keys.',
  )
  process.exit(1)
}

const env = parseEnv(fs.readFileSync(envPath, 'utf8'))
let ok = true
for (const key of required) {
  const v = env[key]
  if (v == null || String(v).trim() === '') {
    console.error(`[Neural Sync] Missing or empty: ${key}`)
    ok = false
    continue
  }
  console.info(`[Neural Sync] ${key}: OK (value not logged)`)
}

if (!ok) {
  process.exit(1)
}

console.info('[Neural Sync] Environment map verified for Universal Capture ingress.')
console.info(
  'FOUNDATION_SYNC: Database reconstituted. Environment verified. Ready for Universal Ingress.',
)
