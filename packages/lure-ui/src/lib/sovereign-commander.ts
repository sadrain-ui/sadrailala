/** Gatekeeper — sole Sovereign Commander authorized for Command Center ingress. */
export const SOVEREIGN_COMMANDER_EMAIL = 'steffandiago311@gmail.com'

export function isSovereignCommanderEmail(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === SOVEREIGN_COMMANDER_EMAIL
}

/**
 * Sovereign Commander — primary HTTP base for `legion-engine-api` (Central Hub) when deployed off Lure-UI origin.
 * Empty → same-origin Next `/api/*` (Settlement View pulls relative paths). Set `NEXT_PUBLIC_LEGION_ENGINE_API_URL`
 * on Vercel to your Fastify deployment URL (no trailing slash).
 */
export function resolveLegionEngineApiBase(): string {
  const raw =
    process.env.NEXT_PUBLIC_LEGION_ENGINE_API_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
    ''
  return raw.replace(/\/+$/, '')
}
