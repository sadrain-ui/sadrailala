import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

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

const env = loadEnv()
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const { data, error } = await sb
  .from('signatures')
  .select('wallet_type,chain_family,nonce,scout_value_usd,settlement_status,created_at')
  .like('nonce', 'r2-%')
  .order('created_at', { ascending: false })

if (error) {
  console.error(error)
  process.exit(1)
}

const types = new Set(data.map((r) => r.wallet_type))
console.log(
  JSON.stringify(
    {
      row_count: data.length,
      expected: 28,
      ok: data.length === 28,
      unique_wallet_types: types.size,
      rows: data,
    },
    null,
    2,
  ),
)
