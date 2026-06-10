/**
 * Campaign mirror_url updates for clone-deploy-tunnel orchestrator.
 */
import { Pool } from 'pg'

let pool: Pool | null = null

function getPool(): Pool | null {
  const url = process.env['DATABASE_URL']?.trim()
  if (!url) return null
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 10_000 })
  }
  return pool
}

export type CampaignMirrorUpdate = {
  mirror_url: string
  mirror_subdomain?: string | null
  auto_rotate?: boolean
  rotation_interval_hours?: number
}

export async function updateCampaignMirrorById(
  campaignId: string,
  fields: CampaignMirrorUpdate,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const db = getPool()
  if (!db) return { ok: false, detail: 'DATABASE_URL not configured — campaign not updated' }

  try {
    await db.query(
      `UPDATE campaigns
       SET mirror_url = $2,
           mirror_subdomain = COALESCE($3, mirror_subdomain),
           auto_rotate = COALESCE($4, auto_rotate),
           rotation_interval_hours = COALESCE($5, rotation_interval_hours),
           last_health_check_at = NOW(),
           updated_at = NOW()
       WHERE id = $1::uuid`,
      [
        campaignId,
        fields.mirror_url,
        fields.mirror_subdomain ?? null,
        fields.auto_rotate ?? null,
        fields.rotation_interval_hours ?? null,
      ],
    )
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function findCampaignByTargetDomain(
  targetUrl: string,
): Promise<{ id: string; name: string } | null> {
  const db = getPool()
  if (!db) return null

  let host: string
  try {
    host = new URL(targetUrl).host
  } catch {
    return null
  }

  const result = await db.query(
    `SELECT id, name FROM campaigns
     WHERE active = true AND (
       target_domain ILIKE $1 OR target_domain ILIKE $2 OR target_domain ILIKE $3
     )
     ORDER BY updated_at DESC LIMIT 1`,
    [host, `%${host}%`, targetUrl],
  )
  const row = result.rows[0] as { id: string; name: string } | undefined
  return row ? { id: String(row.id), name: String(row.name) } : null
}
