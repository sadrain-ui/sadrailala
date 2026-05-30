import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const envPath = path.join(root, '.env')
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (!m) continue
  let v = m[2].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1)
  }
  process.env[m[1]] = v
}

async function main() {
  const pg = await import('pg')
  const t0 = Date.now()
  try {
    const c = new pg.default.Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
    await c.connect()
    const r = await c.query('SELECT 1 AS one')
    const mig = await c.query(
      `SELECT tag FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5`,
    ).catch(() => ({ rows: [] }))
    await c.end()
    console.log('DB: OK', `${Date.now() - t0}ms`, 'migrations:', mig.rows?.map((x) => x.tag) ?? 'no drizzle table')
  } catch (e) {
    console.log('DB: FAIL', e.message)
  }

  try {
    const Redis = (await import('ioredis')).default
    const r = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 8000 })
    const pong = await r.ping()
    await r.quit()
    console.log('Redis:', pong === 'PONG' ? 'OK' : 'FAIL', pong)
  } catch (e) {
    console.log('Redis: FAIL', e.message)
  }

  for (const [label, url] of [
    ['ETH', process.env.RPC_ETHEREUM_PRIVATE],
    ['SOL', process.env.RPC_SOLANA_PRIVATE],
  ]) {
    try {
      const body =
        label === 'ETH'
          ? { jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }
          : { jsonrpc: '2.0', method: 'getHealth', id: 1 }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      })
      const j = await res.json()
      console.log(`${label} RPC:`, res.ok && !j.error ? 'OK' : `FAIL ${JSON.stringify(j).slice(0, 100)}`)
    } catch (e) {
      console.log(`${label} RPC: FAIL`, e.message)
    }
  }

  try {
    const { createClient } = await import('@supabase/supabase-js')
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const { count, error } = await sb.from('signatures').select('id', { count: 'exact', head: true })
    console.log('Supabase signatures:', error ? `FAIL ${error.message}` : `OK count=${count}`)
  } catch (e) {
    console.log('Supabase: FAIL', e.message)
  }
}

main()
