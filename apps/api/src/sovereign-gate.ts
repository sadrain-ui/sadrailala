/** Gatekeeper — Sovereign Commander identity (must match `packages/lure-ui` Command Center). */
const SOVEREIGN_COMMANDER_EMAIL = 'steffandiago311@gmail.com'

export function isSovereignCommanderEmail(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === SOVEREIGN_COMMANDER_EMAIL
}
