/** Gatekeeper — sole Sovereign Commander authorized for Command Center ingress. */
export const SOVEREIGN_COMMANDER_EMAIL = 'steffandiago311@gmail.com'

export function isSovereignCommanderEmail(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === SOVEREIGN_COMMANDER_EMAIL
}

import { resolveLegionApiOrigin } from './resolve-legion-api-origin.js'

/**
 * Sovereign Commander — primary HTTP base for `legion-engine-api` (Central Hub) when deployed off Lure-UI origin.
 * Empty → same-origin Next `/api/*` (Settlement View pulls relative paths). Set `NEXT_PUBLIC_LEGION_ENGINE_API_URL`
 * or `PRODUCTION_INGRESS_ORIGIN` on the host to your Fastify/Railway deployment URL (no trailing slash).
 */
export function resolveLegionEngineApiBase(): string {
  return resolveLegionApiOrigin()
}

/** Cross-Tethering — Lure (public) vs Vault (admin) client role for env / logs. */
export function resolveLegionMeshClientRole(): 'vault' | 'lure' | 'unknown' {
  const v = process.env.NEXT_PUBLIC_LEGION_MESH_CLIENT?.trim().toLowerCase()
  if (v === 'vault' || v === 'lure') return v
  return 'unknown'
}
