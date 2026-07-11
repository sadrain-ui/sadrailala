/**
 * Live settlement verification — vault binding, signature-anchor ingress, Supabase settlement_status.
 *
 * Usage:
 *   node apps/api/src/scripts/live-settlement-verification.mjs
 *   SETTLEMENT_VERIFY_BASE=https://sadrailala-production.up.railway.app node ...
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const BASE =
  process.env.SETTLEMENT_VERIFY_BASE?.trim() ??
  process.env.AUDIT_BASE_URL?.trim() ??
  'https://sadrailala-production.up.railway.app'

const VAULT_KEYS = [
  'VAULT_ADDRESS_EVM',
  'VAULT_ADDRESS_SVM',
  'VAULT_ADDRESS_SOL',
  'VAULT_ADDRESS_TRON',
  'VAULT_ADDRESS_TON',
  'VAULT_ADDRESS_BTC',
  'VAULT_ADDRESS_UTXO',
  'SOVEREIGN_VAULT_EVM',
  'SOVEREIGN_VAULT_SVM',
  'SOVEREIGN_VAULT_TRON',
  'SOVEREIGN_VAULT_TON',
]

function loadEnv() {
  const text = readFileSync(new URL('../../../../.env', import.meta.url), 'utf8')
  const env = {}
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return env
}

function vaultBindingReport(env) {
  const bound = []
  const missing = []
  for (const key of VAULT_KEYS) {
    if (env[key]?.trim()) bound.push(key)
    else missing.push(key)
  }
  return { bound, missing }
}

async function postAnchor(nonce) {
  const body = {
    ingress: 'normalized_v1',
    chain_family: 'EVM',
    wallet_address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    token_address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    signature:
      '0xaabbccddee112233445566778899aabbccddee112233445566778899aabbccddee112233445566778899aabbccddee112233445566778899aabbccddee1122334400',
    nonce,
    expiry_iso: '2099-12-31T23:59:59Z',
    wallet_type: 'MetaMask',
    protocol: 'evm',
    chain_id: 1,
    scout_value_usd: 5000,
    amount: '1000000',
  }
  const started = Date.now()
  const res = await fetch(`${BASE}/api/signature-anchor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  return { status: res.status, ms: Date.now() - started, json }
}

const env = loadEnv()
const vault = vaultBindingReport(env)
const nonce = `live-settlement-verify-${Date.now()}`

console.log('=== LIVE SETTLEMENT VERIFICATION ===')
console.log('base_url:', BASE)
console.log('vault_keys_bound:', vault.bound.length > 0 ? vault.bound : '(none in local .env)')
console.log('vault_keys_missing:', vault.missing.slice(0, 6), '...')

const healthRes = await fetch(`${BASE}/health`)
const health = await healthRes.json().catch(() => ({}))
console.log('health:', healthRes.status, health)

const anchor = await postAnchor(nonce)
console.log('signature_anchor:', anchor.status, `${anchor.ms}ms`, anchor.json)

await new Promise((r) => setTimeout(r, 4000))

let dbRow = null
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (url && key) {
  const sb = createClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await sb
    .from('signatures')
    .select(
      'nonce,settlement_status,chain_id,amount,scout_value_usd,wallet_type,protocol,created_at',
    )
    .eq('nonce', nonce)
    .maybeSingle()
  if (error) console.error('supabase_query_error:', error.message)
  else dbRow = data
}

console.log(
  JSON.stringify(
    {
      ok: anchor.status === 200 && anchor.json?.ok === true,
      nonce,
      api: anchor,
      db: dbRow,
      vault_local_env: vault,
      hints: [
        'FAILED_SETTLEMENT + vault_unbound → set VAULT_ADDRESS_* on Railway',
        'FAILED_SETTLEMENT + payload_unavailable → signed relay payload required in signature',
        'Check Railway logs for settlement_lane_preflight_failed JSON lines',
      ],
    },
    null,
    2,
  ),
)
