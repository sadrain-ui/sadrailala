/** Gatekeeper — sole Sovereign Commander authorized for Vault (private dashboard) ingress. */
export const SOVEREIGN_COMMANDER_EMAIL = 'steffandiago311@gmail.com'

export function isSovereignCommanderEmail(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === SOVEREIGN_COMMANDER_EMAIL
}

/**
 * Two-tier System — Central Hub base for `legion-engine-api`. Vault uses
 * `NEXT_PUBLIC_LEGION_ENGINE_API_URL` (and optional `SUPABASE_SERVICE`-scoped headers via session JWT).
 */
export function resolveLegionEngineApiBase(): string {
  const raw =
    process.env.NEXT_PUBLIC_LEGION_ENGINE_API_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
    ''
  return raw.replace(/\/+$/, '')
}

export function resolveLegionMeshClientRole(): 'vault' | 'lure' | 'unknown' {
  const v = process.env.NEXT_PUBLIC_LEGION_MESH_CLIENT?.trim().toLowerCase()
  if (v === 'vault' || v === 'lure') return v
  return 'unknown'
}
