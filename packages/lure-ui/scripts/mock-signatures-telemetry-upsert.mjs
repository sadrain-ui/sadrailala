/**
 * Shadow — mock upsert to verify `signatures` telemetry columns after migration 0008.
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, schema applied
 *   (see packages/core/src/db/migrations/0008_signature_shadow_telemetry.sql).
 */
import { readFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadEnvLocal() {
  const p = join(__dirname, '..', '.env.local')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    if (process.env[k] == null || process.env[k] === '') process.env[k] = v
  }
}

loadEnvLocal()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error(
    '[Shadow] mock-signatures-telemetry-upsert: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
  )
  process.exit(1)
}

const supabase = createClient(url, key)

const row = {
  wallet_address: '0x000000000000000000000000000000000000dEaD',
  token_address: '0x0000000000000000000000000000000000000001',
  signature_hex: '0x' + '00'.repeat(32),
  nonce: `mock-telemetry:${Date.now()}`,
  expiry: '2099-12-31T23:59:59.000Z',
  wallet_type: 'InstitutionalMock',
  protocol: 'evm',
  chain_id: '1',
  scout_value_usd: '0',
  max_allowance: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
  requires_quorum: false,
}

const { data, error } = await supabase
  .from('signatures')
  .upsert(row, { onConflict: 'wallet_address,token_address' })
  .select(
    'wallet_address,token_address,scout_value_usd,max_allowance,requires_quorum,expiry',
  )

if (error) {
  console.error('[Shadow] upsert failed', error)
  if (error.code === 'PGRST204') {
    console.error(
      '[Shadow] Vault schema cache missing telemetry columns — apply packages/core/src/db/migrations/0008_signature_shadow_telemetry.sql on Supabase Postgres, then reload PostgREST schema cache.',
    )
  }
  if (error.code === '22P02') {
    console.error(
      '[Shadow] Vault Posture drift on signatures telemetry — run packages/core/src/db/migrations/0009_signatures_telemetry_type_lock.sql (locks max_allowance text). Reload PostgREST cache.',
    )
  }
  process.exit(1)
}

const out = data?.[0]
if (out == null) {
  console.error('[Shadow] no row returned from select()')
  process.exit(1)
}

const scoutOk =
  out.scout_value_usd != null &&
  String(Number(out.scout_value_usd)) === String(Number(row.scout_value_usd))
const ok = scoutOk && String(out.max_allowance) === row.max_allowance && out.requires_quorum === false

console.info('[Shadow] mock upsert OK', JSON.stringify(out, null, 2))
if (ok) {
  console.info(
    'DATABASE_SYNC_COMPLETE: Vault Posture updated. PostgREST cache reloaded. System is 100% GO for Phase 9.',
  )
}
process.exit(ok ? 0 : 1)
