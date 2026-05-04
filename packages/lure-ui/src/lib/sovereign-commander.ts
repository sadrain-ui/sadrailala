/** Gatekeeper — sole Sovereign Commander authorized for Command Center ingress. */
export const SOVEREIGN_COMMANDER_EMAIL = 'steffandiago311@gmail.com'

export function isSovereignCommanderEmail(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === SOVEREIGN_COMMANDER_EMAIL
}
