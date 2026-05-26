/**
 * Gatekeeper log redaction — wallet masking, USD tier labels, signature stripping.
 */
export type GatekeeperUsdTierLabel = 'MICRO' | 'MID' | 'MACRO' | 'UNKNOWN';
export type GatekeeperLogRedactionFields = {
    wallet_address?: string | null;
    token_address?: string | null;
    scout_value_usd?: string | number | null;
    amount?: string | null;
};
/** First 6 + last 4 characters; never emit full address in logs. */
export declare function maskWalletAddressForLog(addr: string | null | undefined): string;
/** MICRO (<1000), MID (1000–50000), MACRO (>50000). */
export declare function usdTierLabelForLog(value: string | number | null | undefined): GatekeeperUsdTierLabel;
/** Strip signature material and mask embedded addresses from free-text log details. */
export declare function sanitizeGatekeeperLogDetail(detail: string): string;
export declare function buildGatekeeperLogRedactionPayload(fields?: GatekeeperLogRedactionFields): Record<string, string>;
