// ─── DB Schema Types ─────────────────────────────────────────────────────────
// Drizzle ORM table definitions — authoritative schema for the Legion Engine.
// Source of truth: docs/DB-SCHEMA.md, docs/research/drizzle.md

export * from './schema.js'

// ─── Pool factory ─────────────────────────────────────────────────────────────
// Database Anchor owns explicit host / port / user / password parsing so pg
// never sees a raw URL it can reinterpret or mis-split on special characters.

import type { Pool, PoolConfig } from 'pg'

import { createDatabaseAnchorPool } from '../logic/database-anchor.js'

/**
 * Creates a `pg.Pool` through the Database Anchor parser.
 */
export async function createDbPool(
  url:   string,
  extra?: Omit<PoolConfig, 'connectionString'>,
): Promise<Pool> {
  return createDatabaseAnchorPool(url, extra)
}

// ─── Legacy interface stubs (pre-Drizzle) ────────────────────────────────────
// These mirror docs/DB-SCHEMA.md table definitions.
// TODO(Forge): replace with Drizzle-inferred types as each table is migrated.

export interface DbUser {
  id: string
  email: string | null
  walletAddress: string
  role: 'operator' | 'viewer' | 'admin'
  createdAt: Date
  updatedAt: Date
}

export interface DbMaskedAccount {
  id: string
  userId: string
  chain: string
  address: string
  label: string | null
  lethalityTier: 'high' | 'mid' | 'dust'
  lastScoutedAt: Date | null
  createdAt: Date
}

export interface DbExtractionLane {
  id: string
  maskedAccountId: string
  status: string
  chain: string
  assetAddress: string | null
  assetSymbol: string
  amountRaw: string
  amountUsd: number
  signatureExpiry: number | null
  relayer: string | null
  ghostLane: string | null
  retryCount: number
  createdAt: Date
  updatedAt: Date
}

export interface DbSentinelRun {
  id: string
  laneId: string
  sentinel: string
  action: string
  status: 'started' | 'completed' | 'failed'
  durationMs: number | null
  error: string | null
  createdAt: Date
}

export interface DbPolicy {
  id: string
  name: string
  scope: 'global' | 'chain' | 'wallet'
  scopeValue: string | null
  rule: Record<string, unknown>
  active: boolean
  createdAt: Date
  updatedAt: Date
}
