// @ts-nocheck
/**
 * @module @legion/core/logic/network-mesh
 *
 * Network Egress Cloaking — institutional outbound mesh for RPC and Remote Config Sync.
 * When `PROXY_URL` is armed, JSON-RPC traffic routes through an HTTP(S) proxy (undici)
 * and carries egress-cloak headers for observability.
 */
/** Resolve HTTP(S) proxy URL fallback for Network Mesh egress. */
export declare function resolveProxyUrlFromEnv(): string | undefined;
/** Resolve Rotational Mesh proxy pool from `PROXY_POOL` (comma-separated). */
export declare function resolveProxyPoolFromEnv(): string[];
/**
 * Institutional headers merged onto every egress request — includes proxy host binding when `PROXY_URL` is set.
 */
export declare function resolveNetworkMeshHeaders(activeProxyUrl?: string): Record<string, string>;
export declare function getNextProxy(): string | undefined;
/** Singleton fetch — proxy dispatcher + Network Mesh headers (Privacy RPC / Remote Config Sync). */
export declare function createEgressCloakingFetchFn(): (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
/** viem `http()` transport options — routes through `PROXY_URL` when configured. */
export declare function getInstitutionalHttpTransportOptions(): {
    fetchFn: ReturnType<typeof createEgressCloakingFetchFn>;
};
/** Ping Strike — probes one Rotational Mesh node; returns exit-plane ok + round-trip latency (Lethality Diagnostic). */
export declare function pingRotationalMeshExitPlaneDetailed(proxyUrl: string): Promise<{
    ok: boolean;
    latency_ms: number | null;
}>;
/** Ping Strike — boolean facade for isolated mesh probes (no Round-Robin Scheduler side effects). */
export declare function pingRotationalMeshExitPlane(proxyUrl: string): Promise<boolean>;
/**
 * Egress Cloaking validation — GET via `PROXY_URL` to an IP-checker plane; confirms proxy transport masks origin egress.
 */
export declare function verifyEgressCloaking(): Promise<void>;
//# sourceMappingURL=network-mesh.d.ts.map