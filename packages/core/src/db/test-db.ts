/**
 * @file test-db.ts
 * @module @legion/core/db
 * @sentinel Forge
 *
 * Phase 2.1.13 — Vault Link resuscitation.
 *
 * Three escalating probes:
 *   [A] OS-resolver hostname (dns.lookup, any family) + SNI + rejectUnauthorized:false
 *   [B] Same but also override checkServerIdentity → no-op (kills secondary cert DNS)
 *   [C] IPv6 explicit (AAAA) if the pooler only has v6 records
 *
 * Run:
 *   pnpm --filter @legion/core exec tsx src/db/test-db.ts
 */

import dns from 'dns'
import { promisify } from 'util'
import { Pool }       from 'pg'
import { loadConfig } from '../config/loader.js'

const dnsLookup  = promisify(dns.lookup)
const dnsResolve = promisify(dns.resolve)   // any record type

function emit(msg: string, extra?: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({
    time: Date.now(), sentinel: 'Forge', module: 'test-db', msg, ...extra,
  }) + '\n')
}

function parseDbUrl(url: string) {
  const m = url.match(
    /^postgresql?:\/\/([^:@]+):([^@]*)@([^:/?#]+):(\d+)\/([^?#]*)/i,
  )
  if (!m) throw new Error(`Unparseable DATABASE_URL`)
  return {
    user:     decodeURIComponent(m[1]!),
    password: decodeURIComponent(m[2]!),
    host:     m[3]!,
    port:     parseInt(m[4]!, 10),
    database: m[5]!,
  }
}

async function probe(
  label: string,
  poolOpts: ConstructorParameters<typeof Pool>[0],
): Promise<boolean> {
  const pool = new Pool({ ...poolOpts, connectionTimeoutMillis: 10_000 })
  try {
    const t0  = Date.now()
    const res = await pool.query(
      "SELECT version(), NOW() AT TIME ZONE 'UTC' AS ts",
    )
    emit(`LINK_ESTABLISHED — Vault Link Re-established [${label}]`, {
      pg:        (res.rows[0].version as string).slice(0, 55),
      server_ts: res.rows[0].ts,
      ms:        Date.now() - t0,
    })
    return true
  } catch (e: unknown) {
    emit(`${label} failed`, {
      error: e instanceof Error ? e.message : String(e),
      code:  (e as { code?: string }).code,
    })
    return false
  } finally {
    await pool.end().catch(() => { /* ignore */ })
  }
}

async function inspectSchema(pool: Pool): Promise<void> {
  const colsRes = await pool.query<{ column_name: string; data_type: string; column_default: string | null }>(
    `SELECT column_name, data_type, column_default
     FROM information_schema.columns
     WHERE table_name = 'opportunities'
     ORDER BY ordinal_position`,
  )
  const consRes = await pool.query<{ constraint_name: string; constraint_type: string }>(
    `SELECT constraint_name, constraint_type
     FROM information_schema.table_constraints
     WHERE table_name = 'opportunities'
     ORDER BY constraint_type, constraint_name`,
  )

  const hasExpires = colsRes.rows.some(r => r.column_name === 'expires_at')
  const hasUnique  = consRes.rows.some(r => r.constraint_name === 'uq_opportunities_chain_asset')

  emit('Schema verified', {
    columns:     colsRes.rows.map(r => r.column_name),
    expires_at:  hasExpires,
    uq_chain_asset: hasUnique,
    migration_0004: hasExpires && hasUnique ? 'APPLIED' : 'PENDING',
  })
}

async function main(): Promise<void> {
  const cfg = loadConfig()
  if (!cfg.database.url) { emit('FATAL — DATABASE_URL not set'); process.exit(1) }

  const { user, password, host, port, database } = parseDbUrl(cfg.database.url)
  emit('Tunneling Active', { host, port, user: user.slice(0, 16) + '…' })

  // ── Probe A: OS dns.lookup (any family) ─────────────────────────────────────
  emit('Probe A — OS dns.lookup (any address family)')
  let osAddr: string | null = null
  try {
    const r = await dnsLookup(host, { verbatim: false })
    osAddr = (r as unknown as { address: string }).address
    emit('OS lookup resolved', { hostname: host, address: osAddr })
  } catch (e: unknown) {
    emit('OS lookup failed', { error: (e as Error).message })
  }

  if (osAddr) {
    const success = await probe('A — OS-addr + rejectUnauthorized:false', {
      host: osAddr, port, user, password, database,
      ssl: { rejectUnauthorized: false, servername: host },
    })
    if (success) {
      const pool = new Pool({
        host: osAddr, port, user, password, database,
        ssl: { rejectUnauthorized: false, servername: host },
        connectionTimeoutMillis: 10_000,
      })
      try { await inspectSchema(pool) } finally { await pool.end() }
      return
    }
  }

  // ── Probe B: direct hostname + checkServerIdentity no-op ────────────────────
  // Disables ALL TLS hostname checks including secondary DNS lookups from cert CNs.
  emit('Probe B — direct hostname + checkServerIdentity override')
  const successB = await probe('B — hostname + cert check disabled', {
    host, port, user, password, database,
    ssl: {
      rejectUnauthorized: false,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      checkServerIdentity: (_host: string, _cert: object) => undefined,
    },
  })
  if (successB) {
    const pool = new Pool({
      host, port, user, password, database,
      ssl: {
        rejectUnauthorized: false,
        checkServerIdentity: (_h: string, _c: object) => undefined,
      },
      connectionTimeoutMillis: 10_000,
    })
    try { await inspectSchema(pool) } finally { await pool.end() }
    return
  }

  // ── Probe C: AAAA (IPv6) resolution ─────────────────────────────────────────
  emit('Probe C — AAAA (IPv6) resolution')
  let ipv6: string | null = null
  try {
    const addrs = await dnsResolve(host, 'AAAA') as string[]
    ipv6 = addrs[0] ?? null
    emit('AAAA resolved', { hostname: host, ipv6 })
  } catch (e: unknown) {
    emit('AAAA lookup failed', { error: (e as Error).message })
  }

  if (ipv6) {
    await probe('C — IPv6 + rejectUnauthorized:false', {
      host: ipv6, port, user, password, database,
      ssl: {
        rejectUnauthorized: false,
        servername: host,
        checkServerIdentity: (_h: string, _c: object) => undefined,
      },
    })
  }

  emit('All probes exhausted — network path to Supabase pooler unavailable from this host')
}

main().catch((err: unknown) => {
  emit('FATAL', { error: err instanceof Error ? err.message : String(err) })
  process.exit(1)
})
