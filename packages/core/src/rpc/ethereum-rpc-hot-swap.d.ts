/**
 * Scout — RPC Hot-swapping: primary endpoint measured; backup engaged when latency exceeds threshold.
 */
/** RPC Hot-swapping — latency ceiling (ms) before evaluating backup endpoints. */
export declare const RPC_HOT_SWAP_LATENCY_THRESHOLD_MS = 500;
/**
 * Resolves Ethereum JSON-RPC URL for Gatekeeper reads — RPC Hot-swapping when primary exceeds threshold.
 */
export declare function resolveGatekeeperEthereumRpcUrl(params: {
    primaryUrl: string | undefined;
    backupUrl?: string;
}): Promise<string>;
//# sourceMappingURL=ethereum-rpc-hot-swap.d.ts.map