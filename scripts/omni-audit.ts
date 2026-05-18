/**
 * Omni diagnostic oracle — DB, Redis (IPv4-first), managed RPC lanes, Telegram.
 *
 * Run: npx tsx scripts/omni-audit.ts
 *
 * Settlement / vault log verification uses canonical Drizzle tables:
 *   • `signatures.settlement_status` — settlement lifecycle write on the probe row
 *   • `telemetry` with `event_type = 'vault_log'` — durable vault-style audit log row
 */

import IoRedis from 'ioredis'
import pg from 'pg'

import {
  createRedisFailSafeClient,
  type RedisFailSafeConstructor,
} from '../packages/core/src/redis-client.ts'

/** Stable probe identity — unique on (wallet_address, token_address). */
const AUDIT_WALLET = '0x00000000000000000000000000000000babebeef'
const AUDIT_TOKEN = '0x00000000000000000000000000000000cafebabe'
const LOCK_KEY = 'omni_audit:session_lock'
const DUMMY_SIG =
  '0x' + 'ab'.repeat(65) // 130 hex chars — dummy secp256k1-sized payload for CRUD only

type CheckResult = { name: string; ok: boolean; detail: string; skipped?: boolean }

const results: CheckResult[] = []

function note(name: string, ok: boolean, detail: string, skipped?: boolean): void {
  results.push({ name, ok, detail, skipped })
  const tag = skipped ? 'SKIP' : ok ? 'OK' : 'FAIL'
  console.info(`[${tag}] ${name}: ${detail}`)
}

function resolveSolanaRpcUrl(): string | null {
  const qn =
    process.env['QUICKNODE_SOLANA_URL']?.trim() ||
    process.env['QUICKNODE_SOLANA_RPC_URL']?.trim() ||
    ''
  if (qn) return qn
  const sol = process.env['SOLANA_RPC_URL']?.trim() || process.env['NEXT_PUBLIC_SOLANA_RPC_URL']?.trim() || ''
  if (sol) return sol
  const tpl = process.env['ALCHEMY_SOLANA_RPC_TEMPLATE']?.trim() ?? ''
  const key =
    process.env['EVM_ALCHEMY_KEY']?.trim() ||
    process.env['NEXT_PUBLIC_ALCHEMY_API_KEY']?.trim() ||
    ''
  if (tpl && key) return tpl.replaceAll('{KEY}', key).replaceAll('<KEY>', key)
  return null
}

function resolveAlchemyEthUrl(): string | null {
  const k =
    process.env['EVM_ALCHEMY_KEY']?.trim() ||
    process.env['NEXT_PUBLIC_ALCHEMY_API_KEY']?.trim() ||
    ''
  if (!k) return null
  const tpl = process.env['ALCHEMY_ETH_RPC_TEMPLATE']?.trim()
  if (tpl) return tpl.replaceAll('{KEY}', k).replaceAll('<KEY>', k)
  return `https://eth-mainnet.g.alchemy.com/v2/${k}`
}

function resolveBlockcypherChainUrl(): string {
  const base = (process.env['BLOCKCYPHER_BASE_URL']?.trim() || 'https://api.blockcypher.com/v1').replace(/\/+$/, '')
  const token = process.env['BLOCKCYPHER_API_TOKEN']?.trim()
  const path = `${base}/btc/main`
  return token ? `${path}?token=${encodeURIComponent(token)}` : path
}

function resolveTronHost(): string {
  const h = process.env['TRON_FULL_NODE_URL']?.trim() || 'https://api.trongrid.io'
  return h.replace(/\/+$/, '')
}

function resolveTonRpcUrl(): string {
  const u = process.env['TON_JSON_RPC_URL']?.trim() || 'https://toncenter.com/api/v2/jsonRPC'
  return u.replace(/\/+$/, '')
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{
  ok: boolean
  status: number
  json: unknown
}> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { ok: res.ok, status: res.status, json }
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<{
  ok: boolean
  status: number
  json: unknown
}> {
  const res = await fetch(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(15_000),
  })
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { ok: res.ok, status: res.status, json }
}

async function auditPostgres(): Promise<void> {
  const url = process.env['DATABASE_URL']?.trim()
  if (!url) {
    note('postgres', true, 'DATABASE_URL unset — postgres checks skipped', true)
    return
  }

  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 12_000 })
  let probeSigId: string | null = null
  let probeTelId: string | null = null
  let connected = false
  try {
    await client.connect()
    connected = true

    const ins = await client.query(
      `INSERT INTO signatures (
        wallet_address, token_address, signature_hex, nonce, expiry,
        wallet_type, protocol, settlement_status
      ) VALUES ($1, $2, $3, $4, NOW() + interval '1 hour', 'hot', 'omni_audit', 'PENDING')
      ON CONFLICT (wallet_address, token_address) DO UPDATE SET
        signature_hex = EXCLUDED.signature_hex,
        nonce = EXCLUDED.nonce,
        expiry = EXCLUDED.expiry,
        settlement_status = 'PENDING'
      RETURNING id`,
      [AUDIT_WALLET.toLowerCase(), AUDIT_TOKEN.toLowerCase(), DUMMY_SIG, '0'],
    )
    const id = ins.rows[0]?.['id'] as string | undefined
    if (!id) throw new Error('signatures insert returned no id')
    probeSigId = id

    const sel = await client.query(`SELECT id, settlement_status FROM signatures WHERE id = $1`, [id])
    if (sel.rowCount !== 1) throw new Error('signatures read failed')

    await client.query(`UPDATE signatures SET settlement_status = $2 WHERE id = $1`, [id, 'OMNI_AUDIT_OK'])
    const after = await client.query(`SELECT settlement_status FROM signatures WHERE id = $1`, [id])
    const st = after.rows[0]?.['settlement_status']
    if (st !== 'OMNI_AUDIT_OK') throw new Error('settlement_status write verification failed')

    const tel = await client.query(
      `INSERT INTO telemetry (wallet_address, event_type, payload)
       VALUES (NULL, 'vault_log', $1::jsonb)
       RETURNING id`,
      [JSON.stringify({ source: 'omni-audit', probe: id })],
    )
    const tid = tel.rows[0]?.['id'] as string | undefined
    if (!tid) throw new Error('telemetry (vault_log) insert failed')
    probeTelId = tid
    const tsel = await client.query(`SELECT event_type FROM telemetry WHERE id = $1`, [tid])
    if (tsel.rows[0]?.['event_type'] !== 'vault_log') throw new Error('telemetry read failed')
    await client.query(`DELETE FROM telemetry WHERE id = $1`, [tid])
    probeTelId = null

    await client.query(`DELETE FROM signatures WHERE id = $1`, [id])
    probeSigId = null

    note(
      'postgres',
      true,
      'signatures upsert/read/settlement_status/telemetry(vault_log)/delete OK',
      false,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    note('postgres', false, msg, false)
  } finally {
    if (connected) {
      try {
        if (probeTelId) await client.query(`DELETE FROM telemetry WHERE id = $1`, [probeTelId])
      } catch {
        /* best-effort */
      }
      try {
        if (probeSigId) await client.query(`DELETE FROM signatures WHERE id = $1`, [probeSigId])
        await client.query(
          `DELETE FROM signatures WHERE wallet_address = $1 AND token_address = $2`,
          [AUDIT_WALLET.toLowerCase(), AUDIT_TOKEN.toLowerCase()],
        )
      } catch {
        /* best-effort */
      }
    }
    await client.end().catch(() => null)
  }
}

type RedisProbe = {
  set: (key: string, val: string, ...args: (string | number)[]) => Promise<unknown>
  get: (k: string) => Promise<string | null>
  del: (...k: string[]) => Promise<unknown>
}

async function auditRedis(): Promise<void> {
  const raw = process.env['REDIS_URL']?.trim()
  if (!raw) {
    note('redis', true, 'REDIS_URL unset — redis checks skipped', true)
    return
  }

  type RClient = RedisProbe & { disconnect(): void; ping(): Promise<string> }
  const RedisCtor = IoRedis as unknown as RedisFailSafeConstructor<RClient>
  const redis = createRedisFailSafeClient(RedisCtor, raw, {
    connectTimeout: 5_000,
    maxRetriesPerRequest: 2,
    lazyConnect: true,
    retryStrategy: () => null,
  })

  try {
    const pong = await redis.ping()
    if (pong !== 'PONG') throw new Error(`unexpected PING reply: ${String(pong)}`)

    const token = `audit-${Date.now()}`
    const first = await redis.set(LOCK_KEY, token, 'EX', 30, 'NX')
    if (first !== 'OK') throw new Error('expected first SET NX to acquire session lock')
    const second = await redis.set(LOCK_KEY, 'stale', 'EX', 30, 'NX')
    if (second != null) throw new Error('expected second SET NX to fail while lock held')
    const got = await redis.get(LOCK_KEY)
    if (got !== token) throw new Error('GET session_lock mismatch')
    await redis.del(LOCK_KEY)
    const third = await redis.set(LOCK_KEY, token, 'EX', 30, 'NX')
    if (third !== 'OK') throw new Error('expected lock re-acquire after DEL')

    await redis.del(LOCK_KEY)

    note('redis', true, 'PING + TTL session-lock (SET NX EX / GET / DEL) OK; client family=4 (IPv4-first)', false)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    note('redis', false, msg, false)
  } finally {
    redis.disconnect()
  }
}

async function auditEvmAlchemy(): Promise<void> {
  const url = resolveAlchemyEthUrl()
  if (!url) {
    note('chain_evm_alchemy', true, 'EVM_ALCHEMY_KEY (or template+key) unset — skipped', true)
    return
  }
  const { ok, status, json } = await postJson(url, {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_blockNumber',
    params: [],
  })
  const j = json as { result?: string; error?: { message?: string } }
  if (!ok || typeof j.result !== 'string' || !j.result.startsWith('0x')) {
    note('chain_evm_alchemy', false, `blockNumber HTTP ${String(status)} ${j.error?.message ?? JSON.stringify(json)}`, false)
    return
  }
  const gas = await postJson(url, {
    jsonrpc: '2.0',
    id: 2,
    method: 'eth_gasPrice',
    params: [],
  })
  const gj = gas.json as { result?: string }
  if (!gas.ok || typeof gj.result !== 'string') {
    note('chain_evm_alchemy', false, 'eth_gasPrice failed', false)
    return
  }
  const block = BigInt(j.result).toString()
  note('chain_evm_alchemy', true, `latest_block=${block} gasPrice_wei=${BigInt(gj.result).toString()}`, false)
}

async function auditSolQuicknode(): Promise<void> {
  const url = resolveSolanaRpcUrl()
  if (!url) {
    note('chain_sol_quicknode', true, 'QUICKNODE_SOLANA_URL / SOLANA_RPC_URL / ALCHEMY_SOLANA unset — skipped', true)
    return
  }
  const slotRes = await postJson(url, {
    jsonrpc: '2.0',
    id: 1,
    method: 'getSlot',
    params: [{ commitment: 'finalized' }],
  })
  const sj = slotRes.json as { result?: number }
  if (!slotRes.ok || typeof sj.result !== 'number') {
    note('chain_sol_quicknode', false, `getSlot HTTP ${String(slotRes.status)}`, false)
    return
  }
  const feeRes = await postJson(url, {
    jsonrpc: '2.0',
    id: 2,
    method: 'getRecentPrioritizationFees',
    params: [[]],
  })
  const fj = feeRes.json as { result?: { prioritizationFee: number; slot: number }[] }
  let feeHint = 'prioritization_fees=n/a'
  if (feeRes.ok && Array.isArray(fj.result) && fj.result.length > 0) {
    const sorted = [...fj.result].sort((a, b) => a.prioritizationFee - b.prioritizationFee)
    const mid = sorted[Math.floor(sorted.length / 2)]
    if (mid) feeHint = `median_prioritization_microlamports≈${String(mid.prioritizationFee)}`
  }
  note('chain_sol_quicknode', true, `slot_finalized=${String(sj.result)} ${feeHint}`, false)
}

async function auditTronGrid(): Promise<void> {
  const host = resolveTronHost()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(process.env['TRON_PRO_API_KEY']?.trim()
      ? { 'TRON-PRO-API-KEY': process.env['TRON_PRO_API_KEY'].trim() }
      : {}),
  }
  const blockRes = await fetch(`${host}/wallet/getnowblock`, {
    method: 'POST',
    headers,
    body: '{}',
    signal: AbortSignal.timeout(15_000),
  })
  if (!blockRes.ok) {
    note('chain_tron_grid', false, `getnowblock HTTP ${String(blockRes.status)}`, false)
    return
  }
  const bj = (await blockRes.json()) as { block_header?: { raw_data?: { number?: number } } }
  const num = bj.block_header?.raw_data?.number
  if (typeof num !== 'number') {
    note('chain_tron_grid', false, 'unexpected getnowblock shape', false)
    return
  }

  let feeLine = 'tx_fee_sun=n/a'
  try {
    const feeRes = await fetch(`${host}/wallet/getchainparameters`, {
      method: 'POST',
      headers,
      body: '{}',
      signal: AbortSignal.timeout(12_000),
    })
    if (feeRes.ok) {
      const fj = (await feeRes.json()) as { chainParameter?: { key?: string; value?: number }[] }
      const params = fj.chainParameter ?? []
      const txFee = params.find((p) => p.key === 'getTransactionFee')
      if (txFee && typeof txFee.value === 'number') feeLine = `chain_tx_fee_param_sun=${String(txFee.value)}`
    }
  } catch {
    /* optional */
  }

  note('chain_tron_grid', true, `latest_block=${String(num)} ${feeLine}`, false)
}

async function auditTonCenter(): Promise<void> {
  const base = resolveTonRpcUrl()
  const key = process.env['TONCENTER_API_KEY']?.trim() ?? ''
  const url = key ? `${base}?api_key=${encodeURIComponent(key)}` : base
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key) headers['X-API-Key'] = key

  const mc = await postJson(
    url,
    { jsonrpc: '2.0', id: 1, method: 'getMasterchainInfo', params: {} },
    headers,
  )
  const mj = mc.json as { result?: { last?: { seqno?: number } }; error?: unknown }
  if (!mc.ok || mj.error != null || typeof mj.result?.last?.seqno !== 'number') {
    note('chain_ton_center', false, `getMasterchainInfo failed HTTP ${String(mc.status)}`, false)
    return
  }
  const seq = mj.result.last.seqno

  let feeLine = 'sample_tx_fee=n/a'
  try {
    const restBase = base.includes('/jsonRPC') ? base.replace(/\/jsonRPC\/?$/i, '') : 'https://toncenter.com/api/v2'
    const addr = encodeURIComponent('Ef8zMUVUVToDmmy_peJ911Th_HgNog9HfKpAIcP1stJFA-9N')
    const q = key ? `&api_key=${encodeURIComponent(key)}` : ''
    const txUrl = `${restBase.replace(/\/+$/, '')}/getTransactions?limit=1&address=${addr}${q}`
    const tj = await getJson(txUrl, key ? { 'X-API-Key': key } : {})
    const arr = tj.json as { result?: { fee?: string }[] }
    const fee = arr.result?.[0]?.['fee']
    if (typeof fee === 'string' && fee.length > 0) feeLine = `sample_tx_fee_nanoton=${fee}`
  } catch {
    /* optional */
  }

  note('chain_ton_center', true, `latest_mc_seqno=${String(seq)} ${feeLine}`, false)
}

async function auditBtcBlockcypher(): Promise<void> {
  const url = resolveBlockcypherChainUrl()
  const { ok, status, json } = await getJson(url)
  const j = json as {
    height?: number
    medium_fee_per_kb?: number
    low_fee_per_kb?: number
    error?: string
  }
  if (!ok || typeof j.height !== 'number') {
    note('chain_btc_blockcypher', false, `chain HTTP ${String(status)} ${j.error ?? ''}`, false)
    return
  }
  note(
    'chain_btc_blockcypher',
    true,
    `height=${String(j.height)} medium_fee_sat_per_kb=${String(j.medium_fee_per_kb ?? 'n/a')} low=${String(j.low_fee_per_kb ?? 'n/a')}`,
    false,
  )
}

async function sendTelegram(text: string): Promise<boolean> {
  const bot = process.env['TELEGRAM_BOT_TOKEN']?.trim()
  const chat = process.env['TELEGRAM_CHAT_ID']?.trim()
  if (!bot || !chat) {
    note('telegram', true, 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID unset — skipped', true)
    return true
  }
  const u = `https://api.telegram.org/bot${encodeURIComponent(bot)}/sendMessage`
  const res = await fetch(u, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(15_000),
  })
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string }
  if (!res.ok || j.ok !== true) {
    note('telegram', false, j.description ?? `HTTP ${String(res.status)}`, false)
    return false
  }
  note('telegram', true, 'sendMessage acknowledged', false)
  return true
}

function overallSuccess(): boolean {
  const relevant = results.filter((r) => !r.skipped)
  if (relevant.length === 0) return false
  return relevant.every((r) => r.ok)
}

async function main(): Promise<void> {
  console.info('')
  console.info('══ OMNI AUDIT ORACLE — PHASE 65.0 ══')
  console.info('')

  await auditPostgres()
  await auditRedis()
  await auditEvmAlchemy()
  await auditSolQuicknode()
  await auditTronGrid()
  await auditTonCenter()
  await auditBtcBlockcypher()

  const ok = overallSuccess()
  const telegramText = ok ? '🚨 SYSTEM_AUDIT: [OK]' : `🚨 SYSTEM_AUDIT: [FAIL] ${results.filter((r) => !r.ok && !r.skipped).map((r) => r.name).join(',')}`
  await sendTelegram(telegramText)

  console.info('')
  if (ok) console.info('OMNI_AUDIT: all executed checks passed (skipped items do not count).')
  else console.info('OMNI_AUDIT: one or more checks failed — see [FAIL] lines above.')
  console.info("ORACLE_WELDED: Just run 'npx tsx scripts/omni-audit.ts' to see the full truth.")
  console.info('')

  if (!ok) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
