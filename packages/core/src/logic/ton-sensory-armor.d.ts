// @ts-nocheck
/**
 * Ton Sensory Armor — TonCenter Protocol Sync (JSON-RPC) + Jetton Stablecoin Sniffer for Omnichain Expansion.
 */
export declare const TONCENTER_JSON_RPC_DEFAULT = "https://toncenter.com/api/v2/jsonRPC";
/** Institutional Nominal ceiling — proxy-routed mesh traffic is Nominal below this bound. */
export declare const TON_SENSORY_NOMINAL_CEILING_MS = 2500;
export declare function resolveTonCenterJsonRpcUrl(): string;
export declare function tonCenterApiHeaders(): Record<string, string> | undefined;
export declare function isTonCenterApiKeyArmed(): boolean;
export type TonSensoryPingResult = {
    ping_ok: boolean;
    latency_ms: number;
    api_key_armed: boolean;
};
/**
 * Protocol Sync — POST TonCenter JSON-RPC `getMasterchainInfo` with `TONCENTER_API_KEY` (`X-API-Key` or `api_key` query).
 */
export declare function pingTonSensoryArmorLane(): Promise<TonSensoryPingResult>;
export type TonJettonSnifferHit = {
    transaction_hash: string;
    amount_raw: string;
    approx_human: number;
    jetton_master?: string;
    source?: string;
    destination?: string;
};
export declare function shouldAnnounceTonJettonIngress(txHash: string): boolean;
/**
 * Stablecoin Sniffer — TonCenter API v3 jetton transfers; surfaces Jetton legs above **50,000** human units (decimals from metadata, default 9).
 */
export declare function sniffTonJettonIngressAboveThreshold(params?: {
    thresholdTon?: number;
}): Promise<TonJettonSnifferHit[]>;
//# sourceMappingURL=ton-sensory-armor.d.ts.map