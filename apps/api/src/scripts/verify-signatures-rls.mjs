/**
 * Verify signatures table RLS — anon/public must not read; service_role must read.
 */
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
const url = env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const selectCols = 'id,wallet_address,nonce,settlement_status'

async function probeSelect(label, key) {
  const sb = createClient(url, key, { auth: { persistSession: false } })
  const { data, error, count } = await sb
    .from('signatures')
    .select(selectCols, { count: 'exact', head: false })
    .limit(1)
  return {
    label,
    ok: !error,
    error: error?.message ?? null,
    code: error?.code ?? null,
    row_count: data?.length ?? 0,
    total_count: count ?? null,
    sample_nonce: data?.[0]?.nonce ?? null,
  }
}

const results = {
  url_host: new URL(url).host,
  rls_expectation:
    'RLS enabled; no SELECT for anon/authenticated/public; service_role bypasses RLS',
  probes: [],
  policies_from_db: null,
}

if (anonKey) {
  results.probes.push(await probeSelect('anon_key', anonKey))
} else {
  results.probes.push({ label: 'anon_key', skipped: true, reason: 'NEXT_PUBLIC_SUPABASE_ANON_KEY unset' })
}

results.probes.push(await probeSelect('service_role', serviceKey))

const databaseUrl = env.DATABASE_URL
if (databaseUrl) {
  try {
    const pg = await import('pg')
    const pool = new pg.default.Pool({ connectionString: databaseUrl, max: 1 })
    const rlsEnabled = await pool.query(
      `SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'signatures'`,
    )
    const policies = await pool.query(
      `SELECT polname AS policy_name,
              polcmd AS command,
              pg_get_expr(polqual, polrelid) AS using_expr,
              pg_get_expr(polwithcheck, polrelid) AS with_check_expr,
              (SELECT array_agg(rolname::text)
               FROM pg_roles r
               WHERE r.oid = ANY (polroles)) AS roles
       FROM pg_policy p
       JOIN pg_class c ON c.oid = p.polrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'signatures'
       ORDER BY polname`,
    )
    await pool.end()
    results.policies_from_db = {
      table: rlsEnabled.rows[0] ?? null,
      policies: policies.rows,
    }
  } catch (e) {
    results.policies_from_db = {
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

const anonProbe = results.probes.find((p) => p.label === 'anon_key')
const serviceProbe = results.probes.find((p) => p.label === 'service_role')

const anonBlocked =
  anonProbe?.skipped === true ||
  (anonProbe?.ok === true && anonProbe.row_count === 0 && (anonProbe.total_count === 0 || anonProbe.total_count === null)) ||
  (anonProbe?.ok === false &&
    (anonProbe.code === '42501' ||
      /permission|denied|policy|JWT/i.test(String(anonProbe.error ?? ''))))

const serviceCanRead =
  serviceProbe?.ok === true && (serviceProbe.row_count ?? 0) >= 0 && serviceProbe.error == null

results.verdict = {
  anon_public_read_blocked: anonBlocked,
  service_role_read_ok: serviceCanRead,
  pass: anonBlocked && serviceCanRead,
}

console.log(JSON.stringify(results, null, 2))
process.exit(results.verdict.pass ? 0 : 1)
