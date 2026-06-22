/**
 * Sentinel infrastructure probes — live Postgres, Redis, and JSON-RPC checks for `/api/sentinels/status`.
 */
import { getRpcUrlForChainWithFallback, isRpcConfigured, resolveSolanaRpcUrl } from '@legion/core/lib/chain-rpc'
import { LEGION_MESH_EVENT_WHALE_ALERT, legionMeshEventHeaders } from '@legion/core/logic'

import {
  classifyDatabaseAnchorFailure,
  executePostgresAnchorQuery,
  normalizeDatabaseConnectionString,
} from './database-anchor.js'
import {
  createRedisFailSafeClient,
  type RedisFailSafeConstructor,
} from './redis-client.js'

export type SentinelProbeStatus = 'online' | 'degraded' | 'offline'

export type SentinelProbeResult = {
  ok: boolean
  status: SentinelProbeStatus
  latency_ms: number
  configured: boolean
  detail?: string
}

export type SentinelInfrastructureProbes = {
  postgres: SentinelProbeResult
  redis: SentinelProbeResult
  rpc_evm: SentinelProbeResult
  rpc_solana: SentinelProbeResult
}

type IoRedisInstance = {
  connect(): Promise<void>
  ping(): Promise<string>
  disconnect(): void
}

function probeStatus(ok: boolean, configured: boolean): SentinelProbeStatus {
  if (!configured) return 'degraded'
  return ok ? 'online' : 'offline'
}

async function probePostgres(): Promise<SentinelProbeResult> {
  const t0 = performance.now()
  const raw = process.env['DATABASE_URL']?.trim() ?? ''
  if (!raw) {
    return {
      ok: false,
      status: 'offline',
      latency_ms: Math.round(performance.now() - t0),
      configured: false,
      detail: 'DATABASE_URL unset',
    }
  }
  try {
    const result = await executePostgresAnchorQuery(normalizeDatabaseConnectionString(raw))
    const latency_ms = Math.round(performance.now() - t0)
    if (result.ok) {
      return {
        ok: true,
        status: 'online',
        latency_ms,
        configured: true,
        detail: `SELECT 1 ok (port ${result.port ?? 'default'})`,
      }
    }
    const detail =
      result.error != null
        ? classifyDatabaseAnchorFailure(result.error)
        : 'SELECT 1 did not return expected row'
    return {
      ok: false,
      status: 'offline',
      latency_ms,
      configured: true,
      detail,
    }
  } catch (err) {
    return {
      ok: false,
      status: 'offline',
      latency_ms: Math.round(performance.now() - t0),
      configured: true,
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

async function probeRedis(): Promise<SentinelProbeResult> {
  const t0 = performance.now()
  const raw = process.env['REDIS_URL']?.trim() ?? ''
  if (!raw) {
    return {
      ok: false,
      status: 'offline',
      latency_ms: Math.round(performance.now() - t0),
      configured: false,
      detail: 'REDIS_URL unset',
    }
  }
  try {
    const mod = await import('ioredis')
    const RedisCtor = mod.default as unknown as new (
      url: string,
      opts?: {
        maxRetriesPerRequest?: number
        connectTimeout?: number
        enableOfflineQueue?: boolean
        lazyConnect?: boolean
      },
    ) => IoRedisInstance
    const client = createRedisFailSafeClient(
      RedisCtor as RedisFailSafeConstructor<IoRedisInstance>,
      raw,
      { maxRetriesPerRequest: 2, lazyConnect: true },
    )
    try {
      await client.connect().catch(() => null)
      const pong = await client.ping()
      const ok = pong === 'PONG'
      return {
        ok,
        status: probeStatus(ok, true),
        latency_ms: Math.round(performance.now() - t0),
        configured: true,
        detail: ok ? 'PING PONG' : `unexpected ping response: ${pong}`,
      }
    } finally {
      client.disconnect()
    }
  } catch (err) {
    return {
      ok: false,
      status: 'offline',
      latency_ms: Math.round(performance.now() - t0),
      configured: true,
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

async function pingJsonRpc(
  url: string,
  method: string,
  validate: (json: { result?: unknown; error?: unknown }) => boolean,
): Promise<boolean> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...legionMeshEventHeaders(LEGION_MESH_EVENT_WHALE_ALERT),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
    signal: AbortSignal.timeout(12_000), // TIMEOUTS.JSONRPC_FETCH_TIMEOUT_MS
  })
  if (!res.ok) return false
  const json = (await res.json()) as { result?: unknown; error?: unknown }
  return validate(json)
}

async function probeEvmRpc(): Promise<SentinelProbeResult> {
  const t0 = performance.now()
  const chainId = 1 // BLOCKCHAIN_CONFIG.ETHEREUM_CHAIN_ID
  if (!isRpcConfigured(chainId) && process.env['NODE_ENV'] !== 'development') {
    return {
      ok: false,
      status: 'offline',
      latency_ms: Math.round(performance.now() - t0),
      configured: false,
      detail: 'RPC_ETHEREUM_PRIVATE / NEXT_PUBLIC_RPC_URL unset',
    }
  }
  let url: string
  try {
    url = getRpcUrlForChainWithFallback(chainId)
  } catch (err) {
    return {
      ok: false,
      status: 'offline',
      latency_ms: Math.round(performance.now() - t0),
      configured: false,
      detail: err instanceof Error ? err.message : String(err),
    }
  }
  try {
    const ok = await pingJsonRpc(url, 'eth_blockNumber', (j) => j.error == null && typeof j.result === 'string')
    return {
      ok,
      status: probeStatus(ok, true),
      latency_ms: Math.round(performance.now() - t0),
      configured: true,
      detail: ok ? 'eth_blockNumber ok' : 'eth_blockNumber failed',
    }
  } catch (err) {
    return {
      ok: false,
      status: 'offline',
      latency_ms: Math.round(performance.now() - t0),
      configured: true,
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

async function probeSolanaRpc(): Promise<SentinelProbeResult> {
  const t0 = performance.now()
  const url = resolveSolanaRpcUrl()
  if (!url) {
    return {
      ok: false,
      status: 'offline',
      latency_ms: Math.round(performance.now() - t0),
      configured: false,
      detail: 'Solana RPC URL unset',
    }
  }
  try {
    const ok = await pingJsonRpc(url, 'getHealth', (j) => j.error == null && j.result != null)
    return {
      ok,
      status: probeStatus(ok, true),
      latency_ms: Math.round(performance.now() - t0),
      configured: true,
      detail: ok ? 'getHealth ok' : 'getHealth failed',
    }
  } catch (err) {
    return {
      ok: false,
      status: 'offline',
      latency_ms: Math.round(performance.now() - t0),
      configured: true,
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function runSentinelInfrastructureProbes(): Promise<SentinelInfrastructureProbes> {
  const [postgres, redis, rpc_evm, rpc_solana] = await Promise.all([
    probePostgres(),
    probeRedis(),
    probeEvmRpc(),
    probeSolanaRpc(),
  ])
  return { postgres, redis, rpc_evm, rpc_solana }
}

export function aggregateSentinelPulse(
  probes: SentinelInfrastructureProbes,
): 'online' | 'degraded' | 'offline' {
  const critical = [probes.postgres, probes.redis, probes.rpc_evm]
  if (critical.every((p) => p.ok)) {
    return probes.rpc_solana.ok ? 'online' : 'degraded'
  }
  if (critical.some((p) => p.ok)) {
    return 'degraded'
  }
  return 'offline'
}
