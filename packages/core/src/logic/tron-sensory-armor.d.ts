/**
 * Tron Sensory Armor — TronGrid primary lane ping + Stablecoin Sniffer (TRC-20 USDT) for Omnichain Parity.
 */
export declare const TRON_GRID_PUBLIC_HOST = "https://api.trongrid.io";
/** Canonical mainnet USDT (TRC-20) — matches {@link ../adapters/tron-adapter.js}. */
export declare const TRON_MAINNET_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
/** Institutional Nominal ceiling — proxy-routed mesh traffic is Nominal below this bound. */
export declare const TRON_SENSORY_NOMINAL_CEILING_MS = 3000;
export declare function resolveTronSensoryFullHost(): string;
export declare function tronProApiHeaders(): Record<string, string> | undefined;
export declare function isTronProApiKeyArmed(): boolean;
export type TronSensoryPingResult = {
    /** TronGrid returned a valid latest block envelope. */
    ping_ok: boolean;
    latency_ms: number;
    /** `TRON_PRO_API_KEY` present — institutional Tron Sensory Armor. */
    api_key_armed: boolean;
};
/**
 * Direct TronGrid handshake — `wallet/getnowblock` with optional `TRON-PRO-API-KEY`.
 */
export declare function pingTronSensoryArmorLane(): Promise<TronSensoryPingResult>;
export type TronStablecoinSnifferHit = {
    transaction_id: string;
    value_raw: string;
    approx_usd: number;
    from_address?: string;
    to_address?: string;
    block_timestamp?: number;
};
/** First sighting of a tx id yields true — suppresses duplicate Telegram posts across Ping-Strike cycles. */
export declare function shouldAnnounceTronWhaleIngress(txId: string): boolean;
/**
 * Stablecoin Sniffer — recent TRC-20 USDT contract transfers via TronGrid v1; flags transfers above USD threshold.
 */
export declare function sniffTronStablecoinIngress(params?: {
    thresholdUsd?: number;
}): Promise<TronStablecoinSnifferHit[]>;
//# sourceMappingURL=tron-sensory-armor.d.ts.map