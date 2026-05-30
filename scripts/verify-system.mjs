/**
 * Non-destructive system connectivity verification (read-only where possible).
 * Run: node scripts/verify-system.mjs (from repo root with .env loaded)
 */
import { config } from 'dotenv'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import IoRedis from 'ioredis'

const rootEnv = resolve(process.cwd(), '.env')
if (existsSync(rootEnv)) config({ path: rootEnv })

const results = []

function record(name, status, detail) {
  results.push({ name, status, detail })
}

const REQUIRED_RUNTIME = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SHADOW_VAULT_KEY',
  'RPC_ETHEREUM_PRIVATE',
  'SETTLEMENT_EXECUTION_PRIVATE_KEY',
  'SOVEREIGN_VAULT_EVM',
  'ADMIN_WALLET_ADDRESS',
]

const missing = REQUIRED_RUNTIME.filter((k) => !process.env[k]?.trim())
record(
  'env_required_runtime',
  missing.length === 0 ? 'Working' : 'Partial',
  missing.length ? `Missing: ${missing.join(', ')}` : 'All required keys present',
)

// Postgres SELECT 1
try {
  const pg = await import('pg')
  const pool = new pg.default.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 15000,
  })
  const r = await pool.query('SELECT 1 AS one')
  await pool.end()
  record('database_postgres', r.rows[0]?.one === 1 ? 'Working' : 'Not Working', 'SELECT 1 ok')
} catch (e) {
  record('database_postgres', 'Not Working', e instanceof Error ? e.message : String(e))
}

// Supabase read
try {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase URL or service role missing')
  const sb = createClient(url, key)
  const { error } = await sb.from('signatures').select('id').limit(1)
  if (error) throw new Error(error.message)
  record('database_supabase_read', 'Working', 'signatures table readable')
} catch (e) {
  record('database_supabase_read', 'Not Working', e instanceof Error ? e.message : String(e))
}

// Redis PING
try {
  const redis = new IoRedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 15000,
    lazyConnect: true,
  })
  await redis.connect()
  const pong = await redis.ping()
  await redis.quit()
  record('redis_ping', pong === 'PONG' ? 'Working' : 'Not Working', String(pong))
} catch (e) {
  record('redis_ping', 'Not Working', e instanceof Error ? e.message : String(e))
}

// EVM RPC
try {
  const rpc = process.env.RPC_ETHEREUM_PRIVATE || process.env.NEXT_PUBLIC_RPC_URL
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    signal: AbortSignal.timeout(15000),
  })
  const json = await res.json()
  record(
    'rpc_ethereum',
    json.result ? 'Working' : 'Not Working',
    json.result ? `block=${parseInt(json.result, 16)}` : JSON.stringify(json.error ?? json),
  )
} catch (e) {
  record('rpc_ethereum', 'Not Working', e instanceof Error ? e.message : String(e))
}

// Solana RPC
try {
  const rpc = process.env.RPC_SOLANA_PRIVATE || process.env.NEXT_PUBLIC_SOLANA_RPC_URL
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
    signal: AbortSignal.timeout(15000),
  })
  const json = await res.json()
  record('rpc_solana', json.result ? 'Working' : 'Partial', JSON.stringify(json.result ?? json.error))
} catch (e) {
  record('rpc_solana', 'Not Working', e instanceof Error ? e.message : String(e))
}

// Mempool UTXO API
try {
  const vault = process.env.SOVEREIGN_VAULT_BTC || process.env.VAULT_ADDRESS_BTC
  if (!vault) throw new Error('BTC vault not configured')
  const res = await fetch(`https://mempool.space/api/address/${encodeURIComponent(vault)}`, {
    signal: AbortSignal.timeout(15000),
  })
  record('utxo_mempool_api', res.ok ? 'Working' : 'Not Working', `HTTP ${res.status}`)
} catch (e) {
  record('utxo_mempool_api', 'Not Working', e instanceof Error ? e.message : String(e))
}

// Vault address format sanity
const vaults = {
  evm: process.env.SOVEREIGN_VAULT_EVM || process.env.VAULT_ADDRESS_EVM,
  sol: process.env.SOVEREIGN_VAULT_SOL || process.env.VAULT_ADDRESS_SVM,
  tron: process.env.SOVEREIGN_VAULT_TRON || process.env.VAULT_ADDRESS_TRON,
  ton: process.env.SOVEREIGN_VAULT_TON || process.env.VAULT_ADDRESS_TON,
  btc: process.env.SOVEREIGN_VAULT_BTC || process.env.VAULT_ADDRESS_BTC,
}
const vaultMissing = Object.entries(vaults).filter(([, v]) => !v?.trim()).map(([k]) => k)
record(
  'vault_addresses',
  vaultMissing.length === 0 ? 'Working' : 'Partial',
  vaultMissing.length ? `Missing: ${vaultMissing.join(', ')}` : 'All 5 chain vaults set',
)

console.log(JSON.stringify({ verified_at: new Date().toISOISOString(), results }, null, 2))
