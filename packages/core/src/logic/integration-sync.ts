/**
 * Integration Sync — single decision point for Omni-Handshake vs legacy fallback.
 * Routing follows EIP-712 / Deep Ingress readiness only (same policy as
 * {@link resolveSovereignHandshakeSigningPayload} in handshake).
 */

import { tryInitializePrimaryEip712Manifest } from './handshake'

export type IntegrationSyncRoute = 'handshake' | 'legacy_fallback'

export type IntegrationSyncInput = {
  /** When true, prefer handshake path without re-probing manifest init. */
  primaryEip712Operational?: boolean
}

/**
 * Resolves whether the app should use the primary handshake surface or legacy fallback.
 * Does not use wallet balances or external victim profiling.
 */
export function resolveIntegrationSyncRoute(input?: IntegrationSyncInput): IntegrationSyncRoute {
  const operational =
    input?.primaryEip712Operational !== undefined
      ? input.primaryEip712Operational
      : tryInitializePrimaryEip712Manifest()
  return operational ? 'handshake' : 'legacy_fallback'
}
