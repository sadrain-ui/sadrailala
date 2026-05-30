/**
 * Production readiness health check — non-destructive connectivity + config validation.
 *
 * Run from repo root:
 *   pnpm run health
 *
 * Env is loaded via `node --env-file=.env` (see root package.json "health" script).
 */
import { isValidEvmExecutionPrivateKey } from '@legion/core'
import IoRedis from 'ioredis'
import pg from 'pg'

type CheckStatus = 'pass' | 'warn' | 'fail'

type CheckResult = {
  label: string
  status: CheckStatus
  detail: string
  latencyMs?: number
}

const results: CheckResult[] = []

function readEnv(key: string): string {
  return process.env[key]?.trim() ?? ''
}

async function withLatency<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = Date.now()
  const value = await fn()
  return { value, ms: Date.now() - t0 }
}

function record(result: CheckResult): void {
  results.push(result)
  const icon = result.status === 'pass' ? '✅' : result.status === 'warn' ? '⚠️' : '❌'
  const timing = result.latencyMs != null ? ` (${result.latencyMs}ms)` : ''
  console.log(`${icon} ${result.label}: ${result.detail}${timing}`)
}

function isEvmAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value)
}

function isBtcAddress(value: string): boolean {
  return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(value)
}

async function jsonRpcBlockNumber(rpcUrl: string): Promise<number> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as { result?: string; error?: { message?: string } }
  if (!json.result) throw new Error(json.error?.message ?? 'No block result')
  return parseInt(json.result, 16)
}

async function checkDatabaseSupabase(): Promise<void> {
  const url = readEnv('NEXT_PUBLIC_SUPABASE_URL') || readEnv('SUPABASE_URL')
  const serviceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY')
  const databaseUrl = readEnv('DATABASE_URL')

  if (!url && !databaseUrl) {
    record({ label: 'Database', status: 'fail', detail: 'DATABASE_URL and Supabase URL unset' })
    return
  }

  if (databaseUrl) {
    try {
      const { value: row, ms } = await withLatency(async () => {
        const pool = new pg.Pool({
          connectionString: databaseUrl,
          max: 1,
          connectionTimeoutMillis: 15_000,
        })
        try {
          const r = await pool.query('SELECT 1 AS one')
          return r.rows[0]?.one
        } finally {
          await pool.end()
        }
      })
      if (row === 1) {
        record({ label: 'Database', status: 'pass', detail: 'Connected', latencyMs: ms })
        return
      }
      record({ label: 'Database', status: 'fail', detail: 'Postgres SELECT 1 unexpected result' })
      return
    } catch (e) {
      record({
        label: 'Database',
        status: 'fail',
        detail: e instanceof Error ? e.message : String(e),
      })
      return
    }
  }

  if (!url || !serviceKey) {
    record({ label: 'Database', status: 'fail', detail: 'Supabase URL or SUPABASE_SERVICE_ROLE_KEY missing' })
    return
  }

  try {
    const { ms } = await withLatency(async () => {
      const res = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/signatures?select=id&limit=1`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) throw new Error(`Supabase REST HTTP ${res.status}`)
    })
    record({ label: 'Database', status: 'pass', detail: 'Connected', latencyMs: ms })
  } catch (e) {
    record({
      label: 'Database',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e),
    })
  }
}

async function checkRedis(): Promise<void> {
  const redisUrl = readEnv('REDIS_URL')
  if (!redisUrl) {
    record({ label: 'Redis', status: 'fail', detail: 'REDIS_URL unset' })
    return
  }

  const redis = new IoRedis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 15_000,
    lazyConnect: true,
    enableOfflineQueue: false,
  })

  try {
    const { value: pong, ms } = await withLatency(async () => {
      await redis.connect()
      return redis.ping()
    })
    await redis.quit()
    if (pong === 'PONG') {
      record({ label: 'Redis', status: 'pass', detail: 'Connected', latencyMs: ms })
    } else {
      record({ label: 'Redis', status: 'warn', detail: `Unexpected PING: ${pong}`, latencyMs: ms })
    }
  } catch (e) {
    try {
      redis.disconnect()
    } catch {
      /* ignore */
    }
    const msg = e instanceof Error ? e.message : String(e)
    record({
      label: 'Redis',
      status: 'fail',
      detail: msg.includes('ECONNREFUSED') ? 'Connection refused' : msg,
    })
  }
}

async function checkRpc(label: string, rpcUrl: string, usingFallback: boolean): Promise<void> {
  if (!rpcUrl) {
    record({ label, status: 'fail', detail: 'RPC URL not configured' })
    return
  }
  try {
    const { value: block, ms } = await withLatency(() => jsonRpcBlockNumber(rpcUrl))
    record({
      label,
      status: usingFallback ? 'warn' : 'pass',
      detail: usingFallback ? 'Working (public fallback)' : 'Working',
      latencyMs: ms,
    })
  } catch (e) {
    record({
      label,
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e),
    })
  }
}

function resolveEthereumRpc(): { url: string; fallback: boolean } {
  const configured =
    readEnv('RPC_ETHEREUM_PRIVATE') || readEnv('RPC_URL') || readEnv('NEXT_PUBLIC_RPC_URL')
  if (configured) return { url: configured, fallback: false }
  if (process.env['NODE_ENV'] === 'development' || !process.env['NODE_ENV']) {
    return { url: 'https://eth.llamarpc.com', fallback: true }
  }
  return { url: '', fallback: false }
}

function resolveBscRpc(): { url: string; fallback: boolean } {
  const configured = readEnv('RPC_BSC_PRIVATE')
  if (configured) return { url: configured, fallback: false }
  if (process.env['NODE_ENV'] === 'development' || !process.env['NODE_ENV']) {
    return { url: 'https://bsc-dataseed.binance.org', fallback: true }
  }
  return { url: '', fallback: false }
}

function checkVaultAddresses(): void {
  const evm =
    readEnv('SOVEREIGN_VAULT_EVM') ||
    readEnv('VAULT_ADDRESS_EVM') ||
    readEnv('SOVEREIGN_VAULT_ADDRESS')
  const btc = readEnv('SOVEREIGN_VAULT_BTC') || readEnv('VAULT_ADDRESS_BTC')
  const sol = readEnv('SOVEREIGN_VAULT_SOL') || readEnv('VAULT_ADDRESS_SVM')
  const tron = readEnv('SOVEREIGN_VAULT_TRON') || readEnv('VAULT_ADDRESS_TRON')
  const ton = readEnv('SOVEREIGN_VAULT_TON') || readEnv('VAULT_ADDRESS_TON')

  const issues: string[] = []
  if (!evm) issues.push('EVM vault missing')
  else if (!isEvmAddress(evm)) issues.push('EVM vault invalid format')

  if (btc && !isBtcAddress(btc)) issues.push('BTC vault invalid format')
  if (!btc) issues.push('BTC vault missing')

  const optionalMissing = [
    !sol ? 'SOL' : null,
    !tron ? 'TRON' : null,
    !ton ? 'TON' : null,
  ].filter(Boolean)

  if (issues.length > 0) {
    record({ label: 'Vault addresses', status: 'fail', detail: issues.join('; ') })
    return
  }

  if (optionalMissing.length > 0) {
    record({
      label: 'Vault addresses',
      status: 'warn',
      detail: `EVM/BTC OK; optional missing: ${optionalMissing.join(', ')}`,
    })
    return
  }

  record({ label: 'Vault addresses', status: 'pass', detail: 'EVM, BTC, SOL, TRON, TON configured' })
}

function checkRequiredKeys(): void {
  const shadow = readEnv('SHADOW_VAULT_KEY')
  const settlement = readEnv('SETTLEMENT_EXECUTION_PRIVATE_KEY')
  const missing: string[] = []
  const invalid: string[] = []

  if (!shadow) missing.push('SHADOW_VAULT_KEY')
  else if (!/^(0x)?[0-9a-fA-F]{64}$/.test(shadow)) invalid.push('SHADOW_VAULT_KEY (expected 64 hex)')

  if (!settlement) missing.push('SETTLEMENT_EXECUTION_PRIVATE_KEY')
  else if (!isValidEvmExecutionPrivateKey(settlement)) {
    invalid.push('SETTLEMENT_EXECUTION_PRIVATE_KEY (expected 48–64 hex, optional 0x prefix)')
  }

  if (missing.length > 0) {
    record({ label: 'Required keys', status: 'fail', detail: `Missing: ${missing.join(', ')}` })
    return
  }
  if (invalid.length > 0) {
    record({ label: 'Required keys', status: 'fail', detail: invalid.join('; ') })
    return
  }

  record({ label: 'Required keys', status: 'pass', detail: 'SHADOW_VAULT_KEY + SETTLEMENT_EXECUTION_PRIVATE_KEY present' })
}

async function main(): Promise<void> {
  console.log('')
  console.log('Legion Engine — Production Readiness Health Check')
  console.log(`Environment: ${process.env['NODE_ENV'] ?? 'development'}`)
  console.log('')

  await checkDatabaseSupabase()
  await checkRedis()

  const eth = resolveEthereumRpc()
  await checkRpc('RPC Ethereum', eth.url, eth.fallback)

  const bsc = resolveBscRpc()
  await checkRpc('RPC BSC', bsc.url, bsc.fallback)

  checkVaultAddresses()
  checkRequiredKeys()

  const passed = results.filter((r) => r.status === 'pass').length
  const warnings = results.filter((r) => r.status === 'warn').length
  const failed = results.filter((r) => r.status === 'fail').length

  console.log('')
  console.log(`Summary: ${passed} passed, ${warnings} warnings, ${failed} failed`)
  console.log(`Status: ${failed === 0 ? 'READY' : 'NOT READY'}`)
  console.log('')

  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('Health check crashed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
