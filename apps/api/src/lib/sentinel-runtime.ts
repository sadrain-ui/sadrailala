/**
 * Production sentinel runtime — RPC, Redis, BullMQ depth, vault gas checks.
 */
import cron from 'node-cron'

import { fetchVaultGasBalances, isPrivacyMixerEnabled } from '@legion/core'
import {
  createResilientRedisClient,
  resolveEffectiveRedisUrl,
  type RedisPingClient,
} from '@legion/core/lib/redis-wrapper'
import IoRedis from 'ioredis'
import { Queue } from 'bullmq'

import { isTelegramConfigured, sendTelegramMessage } from './telegram.js'
import { runVaultGasWarningCheck } from '../cron/gas-warning.js'

const QUEUE_NAMES = ['extraction', 'privacy-mixing', 'allowance-reuse', 'vault-sweep'] as const
const DEFAULT_INTERVAL_MS = 300_000
const DEPTH_ALERT = 100

let cronTask: cron.ScheduledTask | null = null

export function isSentinelRuntimeEnabled(): boolean {
  const v = process.env['SENTINEL_RUNTIME_ENABLED']?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

function resolveIntervalMs(): number {
  const raw = Number(process.env['SENTINEL_RUNTIME_INTERVAL_MS']?.trim())
  return Number.isFinite(raw) && raw >= 60_000 ? raw : DEFAULT_INTERVAL_MS
}

type RedisCtor = new (url: string, options?: Record<string, unknown>) => RedisPingClient

const RedisClient = IoRedis as unknown as RedisCtor

async function probeRedis(): Promise<boolean> {
  const url = resolveEffectiveRedisUrl()
  if (!url) return false
  try {
    const redis = new RedisClient(url, { maxRetriesPerRequest: 1, connectTimeout: 5_000 })
    const pong = await redis.ping()
    await redis.quit()
    return pong === 'PONG'
  } catch {
    return false
  }
}

async function fetchQueueDepth(name: string): Promise<number> {
  const url = resolveEffectiveRedisUrl()
  if (!url) return 0
  try {
    const queue = new Queue(name, {
      connection: createResilientRedisClient(RedisClient, url, true) as never,
    })
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed')
    await queue.close()
    return (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0)
  } catch {
    return -1
  }
}

async function probeRpc(url: string | undefined): Promise<boolean> {
  if (!url?.trim()) return false
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: AbortSignal.timeout(8_000),
    })
    return res.ok
  } catch {
    return false
  }
}

async function probeTronRpc(url: string | undefined): Promise<boolean> {
  const base = (url ?? process.env['TRON_FULL_NODE_URL']?.trim() ?? 'https://api.trongrid.io')
    .replace(/\/+$/, '')
  try {
    const res = await fetch(`${base}/wallet/getnowblock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(8_000),
    })
    return res.ok
  } catch {
    return false
  }
}

async function probeTonRpc(url: string | undefined): Promise<boolean> {
  const base = (url ?? process.env['TON_JSON_RPC_URL']?.trim() ?? 'https://toncenter.com/api/v2/jsonRPC')
    .replace(/\/+$/, '')
  const apiKey = process.env['TONCENTER_API_KEY']?.trim()
  try {
    const res = await fetch(base, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getMasterchainInfo', params: [] }),
      signal: AbortSignal.timeout(8_000),
    })
    return res.ok
  } catch {
    return false
  }
}

async function probeBtcRpc(): Promise<boolean> {
  // Try configured UTXO endpoints, fallback to mempool.space
  const endpoints =
    process.env['UTXO_BROADCAST_ENDPOINTS']?.trim().split(',').map((s) => s.trim()).filter(Boolean) ??
    []
  const probe = endpoints[0] ?? 'https://mempool.space/api'
  try {
    const res = await fetch(`${probe.replace(/\/+$/, '')}/blocks/tip/height`, {
      signal: AbortSignal.timeout(8_000),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function runSentinelRuntimeCheck(): Promise<void> {
  const issues: string[] = []

  const redisOk = await probeRedis()
  if (!redisOk) issues.push('Redis unreachable')

  const ethRpc =
    process.env['RPC_ETHEREUM_PRIVATE']?.trim() ||
    process.env['NEXT_PUBLIC_RPC_URL']?.trim()
  const solRpc =
    process.env['RPC_SOLANA_PRIVATE']?.trim() ||
    process.env['SOLANA_RPC_URL']?.trim()

  if (!(await probeRpc(ethRpc))) issues.push('EVM RPC probe failed')

  if (solRpc) {
    try {
      const res = await fetch(solRpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
        signal: AbortSignal.timeout(8_000),
      })
      if (!res.ok) issues.push('Solana RPC probe failed')
    } catch {
      issues.push('Solana RPC probe failed')
    }
  }

  if (!(await probeTronRpc(undefined))) issues.push('TRON RPC probe failed')
  if (!(await probeTonRpc(undefined))) issues.push('TON RPC probe failed')
  if (!(await probeBtcRpc())) issues.push('BTC/mempool RPC probe failed')

  for (const name of QUEUE_NAMES) {
    const depth = await fetchQueueDepth(name)
    if (depth < 0) issues.push(`Queue ${name}: cannot read depth`)
    else if (depth > DEPTH_ALERT) issues.push(`Queue ${name}: depth ${depth} > ${DEPTH_ALERT}`)
  }

  const gasRows = await fetchVaultGasBalances()
  const minNative = Number.parseFloat(process.env['GAS_VAULT_MIN_NATIVE'] ?? '0.01')
  for (const row of gasRows) {
    if (!row.error && row.native_amount < minNative) {
      issues.push(`${row.chain} vault gas low: ${row.native_display}`)
    }
  }

  if (issues.length === 0) {
    console.info('[SENTINEL_RUNTIME] All probes OK')
    return
  }

  console.warn('[SENTINEL_RUNTIME] Issues:', issues.join('; '))

  if (!isTelegramConfigured()) return

  await sendTelegramMessage(
    [
      '🚨 <b>SENTINEL RUNTIME ALERT</b>',
      '━━━━━━━━━━━━━━━━',
      ...issues.map((i) => `• ${i}`),
      '',
      `🕐 ${new Date().toISOString()}`,
      isPrivacyMixerEnabled() ? 'ℹ️ Privacy mixer: enabled' : '',
    ]
      .filter(Boolean)
      .join('\n'),
  )

  void runVaultGasWarningCheck().catch(() => {})
}

export function startSentinelRuntimeCron(): void {
  if (!isSentinelRuntimeEnabled()) {
    console.info('[SENTINEL_RUNTIME] Disabled (SENTINEL_RUNTIME_ENABLED=false)')
    return
  }
  if (cronTask) return

  const ms = resolveIntervalMs()
  const minutes = Math.max(1, Math.round(ms / 60_000))
  const expression = `*/${minutes} * * * *`

  cronTask = cron.schedule(
    expression,
    () => {
      void runSentinelRuntimeCheck().catch((err) => {
        console.warn(
          '[SENTINEL_RUNTIME] Check failed:',
          err instanceof Error ? err.message : String(err),
        )
      })
    },
    { timezone: 'UTC' },
  )

  console.info(`[SENTINEL_RUNTIME] Scheduled every ${minutes} min (UTC)`)
  void runSentinelRuntimeCheck().catch(() => {})
}

export function stopSentinelRuntimeCron(): void {
  if (cronTask) {
    cronTask.stop()
    cronTask = null
  }
}
