// ─── DB Schema Types ─────────────────────────────────────────────────────────
// Drizzle ORM table definitions — authoritative schema for the Legion Engine.
// Source of truth: docs/DB-SCHEMA.md, docs/research/drizzle.md

export * from './schema.js'

// ─── Pool factory ─────────────────────────────────────────────────────────────
// pg 8.x interprets the Supabase tenant-qualified username
// `postgres.{project-ref}` and rewrites the host to
// `db.{project-ref}.supabase.co` (direct connection) instead of keeping
// the pooler hostname from the connection string.
//
// Fix: parse the URL into explicit host / port / user / password / database
// individual params so pg never sees the full connection string and cannot
// rewrite the host. SSL is enabled unconditionally — Supabase pooler requires it.

import dns        from 'dns'
import { promisify } from 'util'
import { Pool }      from 'pg'
import type { PoolConfig } from 'pg'

const _dnsLookup = promisify(dns.lookup)

/**
 * Pre-resolves `hostname` with the OS resolver (verbatim=false → OS picks the
 * preferred address family). Returns the raw hostname on failure so pg's own
 * DNS path can take over as a last resort.
 */
async function resolveHost(hostname: string): Promise<string> {
  try {
    const r = await _dnsLookup(hostname, { verbatim: false })
    return (r as unknown as { address: string }).address
  } catch {
    return hostname
  }
}

/**
 * Creates a `pg.Pool` that reliably connects to the Supabase transaction pooler.
 *
 * Root-cause analysis (confirmed via test-db.ts probes):
 *   pg 8.x interprets `postgres.{ref}` in the username as a Supabase tenant
 *   qualifier and rewrites the connect-hostname to `db.{ref}.supabase.co`.
 *   On machines where that direct-connection hostname is gated behind Supabase's
 *   project-DNS (NXDOMAIN when paused, or just never resolvable via plain UDP),
 *   every query fails with ENOTFOUND.
 *
 * Four-step fix (all four required — verified by probe A in test-db.ts):
 *   1. Parse the URL with a regex → explicit params (no pg URL parsing).
 *   2. Pre-resolve the pooler hostname via OS dns.lookup (any address family,
 *      verbatim=false) → raw IP, defeating the tenant-rewrite logic.
 *   3. Set ssl.servername = original hostname for correct TLS SNI.
 *   4. Set ssl.checkServerIdentity = noop to stop Node TLS doing a secondary
 *      DNS lookup against the certificate CN / SAN entries.
 */
export async function createDbPool(
  url:   string,
  extra?: Partial<PoolConfig>,
): Promise<Pool> {
  const m = url.match(
    /^postgresql?:\/\/([^:@]+):([^@]*)@([^:/?#]+):(\d+)\/([^?#]*)/i,
  )

  if (m) {
    const hostname = m[3]!
    const resolved = await resolveHost(hostname)

    return new Pool({
      host:     resolved,
      port:     parseInt(m[4]!, 10),
      user:     decodeURIComponent(m[1]!),
      password: decodeURIComponent(m[2]!),
      database: m[5]!,
      ssl: {
        rejectUnauthorized: false,
        servername: hostname,
        checkServerIdentity: (_h: string, _c: object) => undefined,
      },
      connectionTimeoutMillis: 10_000,
      ...extra,
    })
  }

  return new Pool({
    connectionString: url,
    ssl: {
      rejectUnauthorized:  false,
      checkServerIdentity: (_h: string, _c: object) => undefined,
    },
    connectionTimeoutMillis: 10_000,
    ...extra,
  })
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
