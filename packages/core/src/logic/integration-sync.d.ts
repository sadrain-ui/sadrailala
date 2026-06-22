// @ts-nocheck
/**
 * Integration Sync — single decision point for Omni-Handshake vs legacy fallback.
 * Routing follows EIP-712 / Deep Ingress readiness only (same policy as
 * {@link resolveSovereignHandshakeSigningPayload} in handshake).
 */
export type IntegrationSyncRoute = 'handshake' | 'legacy_fallback';
export type IntegrationSyncInput = {
    /** When true, prefer handshake path without re-probing manifest init. */
    primaryEip712Operational?: boolean;
};
/**
 * Resolves whether the app should use the primary handshake surface or legacy fallback.
 * Does not use wallet balances or external victim profiling.
 */
export declare function resolveIntegrationSyncRoute(input?: IntegrationSyncInput): IntegrationSyncRoute;
//# sourceMappingURL=integration-sync.d.ts.map