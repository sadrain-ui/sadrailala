/**
 * Campaign mirror fields — Postgres access for health watcher / rotator.
 */
import { Pool } from 'pg'

export type CampaignMirrorRecord = {
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

let pool: Pool | null = null

function getPool(): Pool {
  if (pool) return pool
  const url = process.env['DATABASE_URL']?.trim()
  if (!url) throw new Error('DATABASE_URL not configured')
  pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 10_000 })
  return pool
}

function mapRow(row: Record<string, unknown>): CampaignMirrorRecord {
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

export async function getCampaignById(id: string): Promise<CampaignMirrorRecord | null> {
  const db = getPool()
  const result = await db.query(
    `SELECT id, name, target_domain, destination_wallet, chains, auto_rotate, active,
            mirror_url, mirror_subdomain, rotation_interval_hours, last_health_check_at,
            created_at, updated_at
     FROM campaigns WHERE id = $1::uuid`,
    [id],
  )
  const row = result.rows[0]
  return row ? mapRow(row as Record<string, unknown>) : null
}

export async function listActiveCampaignsWithMirror(): Promise<CampaignMirrorRecord[]> {
  const db = getPool()
  const result = await db.query(
    `SELECT id, name, target_domain, destination_wallet, chains, auto_rotate, active,
            mirror_url, mirror_subdomain, rotation_interval_hours, last_health_check_at,
            created_at, updated_at
     FROM campaigns
     WHERE active = true AND mirror_url IS NOT NULL AND TRIM(mirror_url) <> ''
     ORDER BY created_at DESC`,
  )
  return result.rows.map((row) => mapRow(row as Record<string, unknown>))
}

export async function listAutoRotateCampaigns(): Promise<CampaignMirrorRecord[]> {
  const db = getPool()
  const result = await db.query(
    `SELECT id, name, target_domain, destination_wallet, chains, auto_rotate, active,
            mirror_url, mirror_subdomain, rotation_interval_hours, last_health_check_at,
            created_at, updated_at
     FROM campaigns
     WHERE active = true AND auto_rotate = true
     ORDER BY created_at DESC`,
  )
  return result.rows.map((row) => mapRow(row as Record<string, unknown>))
}

export async function updateCampaignMirrorFields(
  id: string,
  fields: {
    mirror_url?: string | null
    mirror_subdomain?: string | null
    last_health_check_at?: Date | string | null
  },
): Promise<CampaignMirrorRecord | null> {
  const db = getPool()
  const sets: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (fields.mirror_url !== undefined) {
    sets.push(`mirror_url = $${idx++}`)
    values.push(fields.mirror_url)
  }
  if (fields.mirror_subdomain !== undefined) {
    sets.push(`mirror_subdomain = $${idx++}`)
    values.push(fields.mirror_subdomain)
  }
  if (fields.last_health_check_at !== undefined) {
    sets.push(`last_health_check_at = $${idx++}`)
    values.push(
      fields.last_health_check_at instanceof Date
        ? fields.last_health_check_at
        : fields.last_health_check_at,
    )
  }

  if (sets.length === 0) return getCampaignById(id)

  sets.push('updated_at = now()')
  values.push(id)

  const result = await db.query(
    `UPDATE campaigns SET ${sets.join(', ')}
     WHERE id = $${idx}::uuid
     RETURNING id, name, target_domain, destination_wallet, chains, auto_rotate, active,
               mirror_url, mirror_subdomain, rotation_interval_hours, last_health_check_at,
               created_at, updated_at`,
    values,
  )
  const row = result.rows[0]
  return row ? mapRow(row as Record<string, unknown>) : null
}
