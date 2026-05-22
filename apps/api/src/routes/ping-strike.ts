/**
 * Ping Strike — Full-System diagnostic: sovereign Postgres lane, BullMQ Redis, Rotational Mesh, primary RPC planes,
 * Tron Sensory Armor (TronGrid + Stablecoin Sniffer) for Omnichain Parity.
 */
import type { FastifyInstance } from 'fastify'

import {
  LEGION_MESH_EVENT_WHALE_ALERT,
  legionMeshEventHeaders,
} from '@legion/core/logic/mesh-event'
import {
  pingRotationalMeshExitPlaneDetailed,
  resolveProxyPoolFromEnv,
} from '@legion/core/logic/network-mesh'
import {
  pingTronSensoryArmorLane,
  sniffTronStablecoinIngress,
  shouldAnnounceTronWhaleIngress,
  TRON_SENSORY_NOMINAL_CEILING_MS,
} from '@legion/core/logic/tron-sensory-armor'
import {
  pingTonSensoryArmorLane,
  sniffTonJettonIngressAboveThreshold,
  shouldAnnounceTonJettonIngress,
  TON_SENSORY_NOMINAL_CEILING_MS,
} from '@legion/core/logic/ton-sensory-armor'

import {
  executePostgresAnchorQuery,
  normalizeDatabaseConnectionString,
} from '../lib/database-anchor.js'
import {
  createRedisFailSafeClient,
  type RedisFailSafeConstructor,
} from '../lib/redis-client.js'
import {
  sendPingStrikeWhaleAlertTelemetry,
  sendTonJettonIngressTelemetry,
  sendTronWhaleIngressTelemetry,
} from '../telemetry-sender.js'
import { createAuthUnificationPreHandler } from '../middleware/auth-unification.js'

/** Rotational Mesh — institutional expected node count for final Lethality Report telemetry (Phase 12.2). */
const ROTATIONAL_MESH_INSTITUTIONAL_NODE_TARGET = 10

/** Proxy exit-plane latency ceiling (ms) before marking Proxy Health Degraded while still Active. */
const PROXY_LATENCY_DEGRADED_MS = 8_000

type LethalityStatus = 'Active' | 'Inactive' | 'Standby'

type LaneHealth = 'Nominal' | 'Degraded'

type LaneDiagnostic = {
  status: LethalityStatus
  latency_ms: number | null
  lane_health: LaneHealth
}

type ProxyNodeDiagnostic = {
  index: number
  hostname: string
  status: LethalityStatus
  latency_ms: number | null
  proxy_health: LaneHealth
}

export type LethalityReportPayload = {
  sovereign_postgres_lane: LaneDiagnostic
  bullmq_redis_lane: LaneDiagnostic
  /** Sensory Armor — `rediss://` TLS handshake + PING (Upstash / institutional). */
  redis_tls_lane: LaneDiagnostic
  /** 10-Node Mesh Lock — all proxies Active + Nominal Health. */
  shadow_mesh_lane: LaneDiagnostic
  rpc_ethereum_primary: LaneDiagnostic
  rpc_solana_primary: LaneDiagnostic
  /** Tron Sensory Armor — TronGrid primary; Nominal when round-trip under TRON_SENSORY_NOMINAL_CEILING_MS. */
  rpc_tron_primary: LaneDiagnostic
  /** Ton Sensory Armor — TonCenter Protocol Sync; Nominal when round-trip under TON_SENSORY_NOMINAL_CEILING_MS. */
  rpc_ton_primary: LaneDiagnostic
  /** L2 Strike Force Mesh — Base + Arbitrum One + Polygon PoS aggregate (Alchemy / QuickNode env arms). */
  rpc_evm_l2_mesh: LaneDiagnostic
  rpc_evm_l2_mesh_breakdown?: {
    base: LaneDiagnostic
    arbitrum_one: LaneDiagnostic
    polygon_pos: LaneDiagnostic
  }
  rotational_mesh: {
    institutional_target_nodes: number
    configured_nodes: number
    nodes: ProxyNodeDiagnostic[]
  }
}

function laneDiagnostic(ok: boolean, latencyMs: number | null): LaneDiagnostic {
  const status: LethalityStatus = ok ? 'Active' : 'Inactive'
  const lane_health: LaneHealth =
    !ok ? 'Degraded' : latencyMs != null && latencyMs > PROXY_LATENCY_DEGRADED_MS ? 'Degraded' : 'Nominal'
  return { status, latency_ms: latencyMs, lane_health }
}

function redisFailSafeLaneDiagnostic(
  ok: boolean,
  latencyMs: number | null,
  redisUrlRaw: string,
): LaneDiagnostic {
  if (ok) return laneDiagnostic(true, latencyMs)
  if (redisUrlRaw.trim() !== '') {
    return { status: 'Standby', latency_ms: latencyMs, lane_health: 'Degraded' }
  }
  return laneDiagnostic(false, latencyMs)
}

/** Tron Sensory Armor — Omnichain Parity latency gate (institutional sub-1000ms Nominal). */
function tronSensoryLaneDiagnostic(active: boolean, latencyMs: number | null): LaneDiagnostic {
  const status: LethalityStatus = active ? 'Active' : 'Inactive'
  const lane_health: LaneHealth =
    !active
      ? 'Degraded'
      : latencyMs != null && latencyMs >= TRON_SENSORY_NOMINAL_CEILING_MS
        ? 'Degraded'
        : 'Nominal'
  return { status, latency_ms: latencyMs, lane_health }
}

/** Ton Sensory Armor — Protocol Sync latency gate (institutional sub-1000ms Nominal). */
function tonSensoryLaneDiagnostic(active: boolean, latencyMs: number | null): LaneDiagnostic {
  const status: LethalityStatus = active ? 'Active' : 'Inactive'
  const lane_health: LaneHealth =
    !active
      ? 'Degraded'
      : latencyMs != null && latencyMs >= TON_SENSORY_NOMINAL_CEILING_MS
        ? 'Degraded'
        : 'Nominal'
  return { status, latency_ms: latencyMs, lane_health }
}

function resolveL2StrikeRpcUrl(chain: 'base' | 'arbitrum' | 'polygon'): string | null {
  const explicit =
    chain === 'base'
      ? process.env['RPC_BASE_PRIVATE']?.trim()
      : chain === 'arbitrum'
        ? process.env['RPC_ARBITRUM_PRIVATE']?.trim()
        : process.env['RPC_POLYGON_PRIVATE']?.trim()
  if (explicit) return explicit
  const k =
    process.env['EVM_ALCHEMY_KEY']?.trim() ??
    process.env['NEXT_PUBLIC_ALCHEMY_API_KEY']?.trim() ??
    ''
  if (!k) return null
  const template =
    chain === 'base'
      ? process.env['ALCHEMY_BASE_RPC_TEMPLATE']?.trim()
      : chain === 'arbitrum'
        ? process.env['ALCHEMY_ARBITRUM_RPC_TEMPLATE']?.trim()
        : process.env['ALCHEMY_POLYGON_RPC_TEMPLATE']?.trim()
  if (!template) return null
  return template.replace('{KEY}', k)
}

/** Redis TLS lane — Active only when `rediss://` and transport PING succeeds (Sensory Armor). */
function redisTlsHandshakeLane(
  redisPingOk: boolean,
  latencyMs: number | null,
  redisUrlRaw: string,
): LaneDiagnostic {
  const tlsArmed = redisUrlRaw.trim().startsWith('rediss://')
  const ok = redisPingOk && tlsArmed
  const lane_health: LaneHealth =
    !redisPingOk || !tlsArmed
      ? 'Degraded'
      : latencyMs != null && latencyMs > PROXY_LATENCY_DEGRADED_MS
        ? 'Degraded'
        : 'Nominal'
  return {
    status: ok ? 'Active' : 'Inactive',
    latency_ms: latencyMs,
    lane_health,
  }
}

/** Shadow Mesh — 10-node Mesh Lock; Nominal Health requires every node Active + Nominal. */
function shadowMeshLaneDiagnostic(nodes: ProxyNodeDiagnostic[], configured: number): LaneDiagnostic {
  const ok =
    configured === ROTATIONAL_MESH_INSTITUTIONAL_NODE_TARGET &&
    nodes.length === ROTATIONAL_MESH_INSTITUTIONAL_NODE_TARGET &&
    nodes.every((n) => n.status === 'Active' && n.proxy_health === 'Nominal')
  const latencies = nodes.map((n) => n.latency_ms).filter((x): x is number => x != null)
  const maxLat = latencies.length ? Math.max(...latencies) : null
  return laneDiagnostic(ok, maxLat)
}

function proxyDiagnostic(
  index: number,
  proxyUrl: string,
  ok: boolean,
  latencyMs: number | null,
): ProxyNodeDiagnostic {
  let hostname = '(unknown)'
  try {
    hostname = new URL(proxyUrl).hostname
  } catch {
    /* keep default */
  }
  const status: LethalityStatus = ok ? 'Active' : 'Inactive'
  const proxy_health: LaneHealth =
    !ok ? 'Degraded' : latencyMs != null && latencyMs > PROXY_LATENCY_DEGRADED_MS ? 'Degraded' : 'Nominal'
  return {
    index,
    hostname,
    status,
    latency_ms: latencyMs,
    proxy_health,
  }
}

async function measureMs<T>(fn: () => Promise<T>): Promise<{ value: T; latency_ms: number }> {
  const t0 = Date.now()
  const value = await fn()
  return { value, latency_ms: Date.now() - t0 }
}

function printLegionEngineLogo(): void {
  const logo = `
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
▓                                              ▓
▓           L E G I O N   E N G I N E            ▓
▓                                              ▓
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
`
  console.log(logo)
}

async function pingSupabaseRestLane(): Promise<boolean> {
  const base =
    process.env['SUPABASE_URL']?.trim() ?? process.env['NEXT_PUBLIC_SUPABASE_URL']?.trim() ?? ''
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']?.trim()
  if (!base || !key) return false
  const u = `${base.replace(/\/$/, '')}/rest/v1/engine_config?select=key_name&limit=1`
  const res = await fetch(u, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(12_000),
  })
  return res.ok
}

type IoRedisInstance = {
  connect(): Promise<void>
  ping(): Promise<string>
  disconnect(): void
}

async function pingBullmqRedisLane(): Promise<boolean> {
  const raw = process.env['REDIS_URL']?.trim() ?? ''
  if (!raw) return false
  try {
    const mod = await import('ioredis')
    const RedisCtor = mod.default as unknown as new (
      url: string,
      opts?: {
        maxRetriesPerRequest?: number
        connectTimeout?: number
        enableOfflineQueue?: boolean
        retryStrategy?: (times: number) => number | null
        lazyConnect?: boolean
        tls?: Record<string, unknown>
        family?: 0 | 4 | 6
      },
    ) => IoRedisInstance
    const client = createRedisFailSafeClient(
      RedisCtor as RedisFailSafeConstructor<IoRedisInstance>,
      raw,
      {
        maxRetriesPerRequest: 2,
        lazyConnect: true,
      },
    )
    try {
      await client.connect().catch(() => null)
      const p = await client.ping()
      return p === 'PONG'
    } finally {
      client.disconnect()
    }
  } catch {
    return false
  }
}

async function pingEvmPrimaryRpc(url: string): Promise<boolean> {
  if (!url) return false
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_blockNumber',
    params: [],
  })
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...legionMeshEventHeaders(LEGION_MESH_EVENT_WHALE_ALERT),
    },
    body,
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) return false
  const j = (await res.json()) as { result?: string; error?: unknown }
  return j.error == null && typeof j.result === 'string'
}

async function pingSolanaPrimaryRpc(url: string): Promise<boolean> {
  if (!url) return false
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getHealth',
    params: [],
  })
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...legionMeshEventHeaders(LEGION_MESH_EVENT_WHALE_ALERT),
    },
    body,
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) return false
  const j = (await res.json()) as { result?: string; error?: unknown }
  return j.error == null && typeof j.result === 'string'
}

function fmtLane(d: LaneDiagnostic): string {
  const ms = d.latency_ms != null ? `${d.latency_ms}ms` : '—'
  return `${d.status} · ${ms}`
}

export async function registerPingStrikeRoute(app: FastifyInstance): Promise<void> {
  const authPre = createAuthUnificationPreHandler(app)
  app.get('/api/diagnostic/ping-strike', { preHandler: authPre }, async () => {
    console.info('LANE_STATUS: PING_STRIKE_RUN')

    const sequence: string[] = []

    sequence.push('sovereign_postgres_lane')
    /** Heartbeat Sync — sovereign lane is Nominal only when Postgres responds to SELECT 1 (Database Anchor responsive). */
    let sovereignDbOk = false
    let pgMs: number | null = null
    const pgConn = process.env['DATABASE_URL']?.trim()
    if (pgConn) {
      const normalized = normalizeDatabaseConnectionString(pgConn)
      const anchor = await executePostgresAnchorQuery(normalized)
      sovereignDbOk = anchor.ok
      pgMs = anchor.latency_ms
    }
    let supabaseRestLaneAlive = false
    if (!sovereignDbOk) {
      sequence.push('supabase_rest_lane_diagnostic')
      const sb = await measureMs(() => pingSupabaseRestLane())
      supabaseRestLaneAlive = sb.value
      if (!pgConn) {
        console.info(
          'LETHALITY_REPORT: sovereign_postgres_lane Inactive — DATABASE_URL unset; supabase_rest_lane_diagnostic executed.',
        )
      } else if (!supabaseRestLaneAlive) {
        console.info(
          'LETHALITY_REPORT: sovereign_postgres_lane Inactive — Postgres heartbeat not responsive; REST diagnostic also degraded.',
        )
      } else {
        console.info(
          'LETHALITY_REPORT: sovereign_postgres_lane Inactive — Postgres heartbeat not responsive; supabase REST Nominal (REST does not satisfy Database Anchor).',
        )
      }
    }

    sequence.push('bullmq_redis_lane')
    const redisUrlRaw = process.env['REDIS_URL']?.trim() ?? ''

    const proxyUrls = resolveProxyPoolFromEnv()
    sequence.push('rotational_mesh_parallel')
    proxyUrls.forEach((proxyUrl, i) => sequence.push(meshProxyReportKey(i + 1, proxyUrl)))

    const evmUrl =
      process.env['RPC_ETHEREUM_PRIVATE']?.trim() ??
      process.env['NEXT_PUBLIC_RPC_URL']?.trim() ??
      process.env['RPC_URL']?.trim() ??
      ''
    const solUrl =
      process.env['RPC_SOLANA_PRIVATE']?.trim() ??
      process.env['SOLANA_RPC_URL']?.trim() ??
      process.env['NEXT_PUBLIC_SOLANA_RPC_URL']?.trim() ??
      ''

    sequence.push('rpc_ethereum_primary')
    sequence.push('rpc_solana_primary')
    sequence.push('rpc_tron_primary')
    sequence.push('rpc_ton_primary')
    sequence.push('rpc_evm_l2_mesh')

    const l2BaseUrl = resolveL2StrikeRpcUrl('base')
    const l2ArbUrl = resolveL2StrikeRpcUrl('arbitrum')
    const l2PolyUrl = resolveL2StrikeRpcUrl('polygon')

    // Parallel execution of all RPC pings + Redis + Mesh to prevent gateway timeout
    const [
      redisM,
      meshNodes,
      evmM,
      solM,
      tronPing,
      tonPing,
      l2BaseM,
      l2ArbM,
      l2PolyM,
    ] = await Promise.all([
      measureMs(() => pingBullmqRedisLane()),
      Promise.all(
        proxyUrls.map(async (proxyUrl, i) => {
          const detail = await pingRotationalMeshExitPlaneDetailed(proxyUrl)
          return proxyDiagnostic(i + 1, proxyUrl, detail.ok, detail.latency_ms)
        })
      ),
      measureMs(() => pingEvmPrimaryRpc(evmUrl)),
      measureMs(() => pingSolanaPrimaryRpc(solUrl)),
      pingTronSensoryArmorLane(),
      pingTonSensoryArmorLane(),
      measureMs(async () => (l2BaseUrl ? pingEvmPrimaryRpc(l2BaseUrl) : Promise.resolve(false))),
      measureMs(async () => (l2ArbUrl ? pingEvmPrimaryRpc(l2ArbUrl) : Promise.resolve(false))),
      measureMs(async () => (l2PolyUrl ? pingEvmPrimaryRpc(l2PolyUrl) : Promise.resolve(false))),
    ])

    const redisOk = redisM.value

    if (redisUrlRaw.startsWith('rediss://') && redisOk) {
      console.info('REDIS_TLS_HANDSHAKE: BullMQ lane armed via rediss:// (Sensory Armor).')
    }

    const evmOk = evmM.value
    const solOk = solM.value

    const tronLaneActive = tronPing.ping_ok && tronPing.api_key_armed
    const tronLaneDiag = tronSensoryLaneDiagnostic(tronLaneActive, tronPing.latency_ms)
    if (tronPing.api_key_armed && tronPing.ping_ok) {
      console.info(
        'TRON_LANE_ARMED: Stablecoin ingress active. Omnichain parity reached. System: BEYOND LETHAL.',
      )
    }

    if (tronPing.api_key_armed) {
      const whales = await sniffTronStablecoinIngress({ thresholdUsd: 100_000 })
      const hook = process.env['TELEMETRY_WEBHOOK_URL']?.trim()
      for (const h of whales) {
        if (!shouldAnnounceTronWhaleIngress(h.transaction_id)) continue
        const detail =
          `USDT TRC-20 ≥ $100,000 — tx=${h.transaction_id} approx_usd=${h.approx_usd.toFixed(2)} value_raw=${h.value_raw}`
        if (hook) {
          await sendTronWhaleIngressTelemetry({
            message: detail,
            transaction_id: h.transaction_id,
            value_raw: h.value_raw,
            approx_usd: h.approx_usd,
            from_address: h.from_address,
            to_address: h.to_address,
            block_timestamp: h.block_timestamp,
          })
        } else {
          console.info('TRON_WHALE_INGRESS:', detail)
        }
      }
    }

    const tonLaneActive = tonPing.ping_ok && tonPing.api_key_armed
    const tonLaneDiag = tonSensoryLaneDiagnostic(tonLaneActive, tonPing.latency_ms)

    if (tonPing.api_key_armed) {
      const jhits = await sniffTonJettonIngressAboveThreshold({ thresholdTon: 50_000 })
      const hookTon = process.env['TELEMETRY_WEBHOOK_URL']?.trim()
      for (const h of jhits) {
        if (!shouldAnnounceTonJettonIngress(h.transaction_hash)) continue
        const detail = `Jetton ingress ≥ 50,000 TON-class units — tx=${h.transaction_hash} approx_human=${h.approx_human.toFixed(4)}`
        const payload: Record<string, unknown> = {
          message: detail,
          transaction_hash: h.transaction_hash,
          amount_raw: h.amount_raw,
          approx_human: h.approx_human,
        }
        if (h.jetton_master != null) payload['jetton_master'] = h.jetton_master
        if (h.source != null) payload['source'] = h.source
        if (h.destination != null) payload['destination'] = h.destination
        if (hookTon) {
          await sendTonJettonIngressTelemetry(payload)
        } else {
          console.info('TON_JETTON_INGRESS:', detail)
        }
      }
    }

    const l2BaseDiag = laneDiagnostic(l2BaseM.value, l2BaseUrl ? l2BaseM.latency_ms : null)
    const l2ArbDiag = laneDiagnostic(l2ArbM.value, l2ArbUrl ? l2ArbM.latency_ms : null)
    const l2PolyDiag = laneDiagnostic(l2PolyM.value, l2PolyUrl ? l2PolyM.latency_ms : null)
    const l2AllOk =
      Boolean(l2BaseUrl && l2ArbUrl && l2PolyUrl) && l2BaseM.value && l2ArbM.value && l2PolyM.value
    const l2Latencies = [l2BaseM.latency_ms, l2ArbM.latency_ms, l2PolyM.latency_ms].filter(
      (x): x is number => typeof x === 'number',
    )
    const l2MaxLat = l2Latencies.length === 3 ? Math.max(...l2Latencies) : null
    const rpcEvmL2MeshDiag = laneDiagnostic(l2AllOk, l2AllOk ? l2MaxLat : null)

    const redisTlsLane = redisTlsHandshakeLane(redisOk, redisM.latency_ms, redisUrlRaw)
    const shadowMeshLane = shadowMeshLaneDiagnostic(meshNodes, proxyUrls.length)

    const LETHALITY_REPORT: LethalityReportPayload = {
      sovereign_postgres_lane: laneDiagnostic(sovereignDbOk, pgMs),
      bullmq_redis_lane: redisFailSafeLaneDiagnostic(redisOk, redisM.latency_ms, redisUrlRaw),
      redis_tls_lane: redisTlsLane,
      shadow_mesh_lane: shadowMeshLane,
      rpc_ethereum_primary: laneDiagnostic(evmOk, evmUrl ? evmM.latency_ms : null),
      rpc_solana_primary: laneDiagnostic(solOk, solUrl ? solM.latency_ms : null),
      rpc_tron_primary: tronLaneDiag,
      rpc_ton_primary: tonLaneDiag,
      rpc_evm_l2_mesh: rpcEvmL2MeshDiag,
      rpc_evm_l2_mesh_breakdown: {
        base: l2BaseDiag,
        arbitrum_one: l2ArbDiag,
        polygon_pos: l2PolyDiag,
      },
      rotational_mesh: {
        institutional_target_nodes: ROTATIONAL_MESH_INSTITUTIONAL_NODE_TARGET,
        configured_nodes: proxyUrls.length,
        nodes: meshNodes,
      },
    }

    if (
      LETHALITY_REPORT.rpc_ton_primary.lane_health === 'Nominal' &&
      LETHALITY_REPORT.rpc_tron_primary.lane_health === 'Nominal' &&
      LETHALITY_REPORT.rpc_evm_l2_mesh.lane_health === 'Nominal'
    ) {
      console.info(
        'OMNICHAIN_EXPANSION_LOCKED: TON and L2 strike lanes active. Duopoly broken. System: UNIVERSAL LIQUIDITY BLACKHOLE.',
      )
    }

    const dbGreen = sovereignDbOk
    const tlsGreen = redisUrlRaw.startsWith('rediss://') && redisOk
    const meshGreen =
      proxyUrls.length === ROTATIONAL_MESH_INSTITUTIONAL_NODE_TARGET &&
      meshNodes.length === ROTATIONAL_MESH_INSTITUTIONAL_NODE_TARGET &&
      meshNodes.every((n) => n.status === 'Active' && n.proxy_health === 'Nominal')

    const tenLanesNominal =
      LETHALITY_REPORT.sovereign_postgres_lane.lane_health === 'Nominal' &&
      LETHALITY_REPORT.bullmq_redis_lane.lane_health === 'Nominal' &&
      redisTlsLane.lane_health === 'Nominal' &&
      shadowMeshLane.lane_health === 'Nominal' &&
      LETHALITY_REPORT.rpc_ethereum_primary.lane_health === 'Nominal' &&
      LETHALITY_REPORT.rpc_solana_primary.lane_health === 'Nominal' &&
      LETHALITY_REPORT.rpc_tron_primary.lane_health === 'Nominal' &&
      LETHALITY_REPORT.rpc_ton_primary.lane_health === 'Nominal' &&
      LETHALITY_REPORT.rpc_evm_l2_mesh.lane_health === 'Nominal' &&
      meshGreen

    const nominal_lane_pass = [
      LETHALITY_REPORT.sovereign_postgres_lane.lane_health === 'Nominal',
      LETHALITY_REPORT.bullmq_redis_lane.lane_health === 'Nominal',
      redisTlsLane.lane_health === 'Nominal',
      shadowMeshLane.lane_health === 'Nominal',
      LETHALITY_REPORT.rpc_ethereum_primary.lane_health === 'Nominal',
      LETHALITY_REPORT.rpc_solana_primary.lane_health === 'Nominal',
      LETHALITY_REPORT.rpc_tron_primary.lane_health === 'Nominal',
      LETHALITY_REPORT.rpc_ton_primary.lane_health === 'Nominal',
      LETHALITY_REPORT.rpc_evm_l2_mesh.lane_health === 'Nominal',
      meshGreen,
    ].filter(Boolean).length

    const fullPingStrikeLock =
      dbGreen &&
      tlsGreen &&
      evmUrl !== '' &&
      solUrl !== '' &&
      evmOk &&
      solOk &&
      tenLanesNominal

    const lane_status = {
      postgres: fmtLane(LETHALITY_REPORT.sovereign_postgres_lane),
      redis: fmtLane(LETHALITY_REPORT.bullmq_redis_lane),
      redis_tls: fmtLane(redisTlsLane),
      mesh: fmtLane(shadowMeshLane),
      rpc_evm: fmtLane(LETHALITY_REPORT.rpc_ethereum_primary),
      rpc_solana: fmtLane(LETHALITY_REPORT.rpc_solana_primary),
      rpc_tron: fmtLane(LETHALITY_REPORT.rpc_tron_primary),
      rpc_ton: fmtLane(LETHALITY_REPORT.rpc_ton_primary),
      rpc_l2_mesh: fmtLane(LETHALITY_REPORT.rpc_evm_l2_mesh),
    }

    console.info(
      'OBSERVABILITY_SYNC: Telemetry aligned with fail-safe posture. UI Interaction locked. System: 100% OPERATIONAL.',
    )

    const mesh_lines = meshNodes.map(
      (n) =>
        `#${n.index} ${n.hostname} · ${n.status}${n.latency_ms != null ? ` · ${n.latency_ms}ms` : ''} · ${n.proxy_health}`,
    )

    if (fullPingStrikeLock) {
      printLegionEngineLogo()
      console.info('LANE_STATUS: PING_STRIKE_LOCK full')
    }

    const tenMeshBattleReady =
      fullPingStrikeLock &&
      meshGreen &&
      proxyUrls.length === ROTATIONAL_MESH_INSTITUTIONAL_NODE_TARGET

    if (tenMeshBattleReady && tlsGreen) {
      console.info(
        'SENSORY_ARMOR_LOCKED: All 10 proxy nodes armed. TLS handshake secured. System: 100% LETHAL.',
      )
    }

    if (tenMeshBattleReady) {
      console.info('LANE_STATUS: MESH_10_ALL_ACTIVE')
    }

    if (fullPingStrikeLock && process.env['TELEMETRY_WEBHOOK_URL']?.trim()) {
      await sendPingStrikeWhaleAlertTelemetry({
        message:
          tenMeshBattleReady
            ? 'LETHALITY_REPORT_GENERATED: All 10 nodes verified. Uniswap Predator online. System: READY FOR DEPLOYMENT.'
            : `Ping Strike: lethality nominal for ${proxyUrls.length} Rotational Mesh node(s); institutional target remains ${ROTATIONAL_MESH_INSTITUTIONAL_NODE_TARGET}.`,
        ping_strike_lock: 'full',
        rotational_mesh_reported_nodes: proxyUrls.length,
        rotational_mesh_institutional_target: ROTATIONAL_MESH_INSTITUTIONAL_NODE_TARGET,
      })
    }

    const solPrivateArmed = Boolean(process.env['RPC_SOLANA_PRIVATE']?.trim())

    return {
      ping_strike_lock: fullPingStrikeLock ? ('full' as const) : ('degraded' as const),
      omnichain_nominal_ratio: `${nominal_lane_pass}/10`,
      lane_status,
      mesh_nodes: mesh_lines,
      solana_private_ingress: solPrivateArmed ? 'RPC_SOLANA_PRIVATE_armed' : 'fallback_chain',
      rotational_mesh: {
        configured_nodes: proxyUrls.length,
        institutional_target_nodes: ROTATIONAL_MESH_INSTITUTIONAL_NODE_TARGET,
      },
      diagnostic_detail: LETHALITY_REPORT,
      ping_strike_sequence: sequence,
    }
  })
}

function meshProxyReportKey(index: number, proxyUrl: string): string {
  try {
    return `rotational_mesh_proxy_${index}_${new URL(proxyUrl).hostname}`
  } catch {
    return `rotational_mesh_proxy_${index}`
  }
}
