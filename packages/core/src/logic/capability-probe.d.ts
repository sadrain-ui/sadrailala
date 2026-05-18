/**
 * @file capability-probe.ts
 * @module @legion/core/logic
 *
 * Capability Probing — background namespace surface scan after Omni-Handshake.
 * Identifies asset-density-ranked namespaces and prepares UTXO PSBT-class handlers (UniSat / Xverse).
 */
export type ChainNamespaceHint = 'eip155' | 'solana' | 'bip122' | 'unknown';
export interface CapabilityProbeResult {
    eth_signTypedData: boolean;
    solana_signMessage: boolean;
    btc_signMessage: boolean;
}
export interface NamespaceDensityScore {
    namespace: ChainNamespaceHint;
    /** Relative density weight for Sovereign Sign routing. */
    density: number;
}
export interface OmniHandshakeProbeResult {
    surfaces: CapabilityProbeResult;
    /** Namespace order — highest asset density first (Capability Probing heuristic). */
    rankedNamespaces: NamespaceDensityScore[];
    /** UniSat / Xverse / OKX Bitcoin signing surfaces detected. */
    utxoPsbtHandlerReady: boolean;
    /** Cold-read namespace surfaces from the connected stack (no user prompts). */
    namespaceReport: NamespaceCapabilityReport;
}
/** Immediate post-handshake snapshot: which CAIP namespaces are live on the provider. */
export interface NamespaceCapabilityReport {
    eip155: {
        active: boolean;
        chainIdHex?: string;
    };
    solana: {
        active: boolean;
    };
    bip122: {
        active: boolean;
    };
}
type Eip1193Like = {
    request: (args: {
        method: string;
        params?: unknown;
    }) => Promise<unknown>;
};
export type SessionNamespaceFlags = {
    /** Active Omni-Handshake session has an EVM account. */
    eip155: boolean;
    /** Active session targets Solana (AppKit `activeChain`). */
    solana: boolean;
    /** Active session targets bip122 (AppKit `activeChain`). */
    bip122: boolean;
};
/**
 * Capability Probe — cold snapshot of signing surfaces (no user prompts).
 * Solana / bip122 surfaces require an active session on that namespace (not stray browser globals).
 */
export type CapabilityProbeOptions = {
    /**
     * AppKit-injected Solana wallet may expose signMessage without `window.solana`.
     * Capability Probing uses this when the Omni session has a Solana account.
     */
    solanaHasSignMessage?: boolean;
};
export declare function runCapabilityProbe(evmProvider?: Eip1193Like, session?: SessionNamespaceFlags, opts?: CapabilityProbeOptions): Promise<CapabilityProbeResult>;
/**
 * Reads connected-provider namespaces immediately after handshake (no Sovereign Sign prompts).
 */
export declare function probeConnectedNamespaces(evmProvider: Eip1193Like | undefined, session: SessionNamespaceFlags, opts?: CapabilityProbeOptions): Promise<NamespaceCapabilityReport>;
/**
 * Rank namespaces by institutional asset-density heuristic (Capability Probing).
 */
export declare function rankNamespacesByDensity(surfaces: CapabilityProbeResult, evmChainId: number | undefined, connected: SessionNamespaceFlags): NamespaceDensityScore[];
/**
 * Pick the densest namespace that is actually connected in this session.
 */
export declare function selectDensestConnectedNamespace(input: {
    ranked: NamespaceDensityScore[];
    activeNamespace: ChainNamespaceHint;
    hasEvmAccount: boolean;
    hasSolanaAccount: boolean;
    hasBtcAccount: boolean;
}): ChainNamespaceHint;
export interface OmniProbeParams {
    evmProvider?: Eip1193Like;
    evmChainId: number | undefined;
    session: SessionNamespaceFlags;
    /** Scout: Solana Lethal Payload surface via AppKit wallet provider (not only window.solana). */
    solanaHasSignMessage?: boolean;
}
/**
 * Background probe after handshake — all supported namespaces + PSBT handler readiness.
 */
export declare function runOmniHandshakeProbe(params: OmniProbeParams): Promise<OmniHandshakeProbeResult>;
export type UtxoPsbtHandlerKind = 'unisat' | 'xverse' | 'okx' | 'unknown';
/**
 * Prepare PSBT-class institutional handler for UniSat / Xverse (Scout lane).
 */
export declare function prepareUtxoPsbtInstitutionalHandler(): {
    kind: UtxoPsbtHandlerKind;
    ready: boolean;
};
export {};
//# sourceMappingURL=capability-probe.d.ts.map