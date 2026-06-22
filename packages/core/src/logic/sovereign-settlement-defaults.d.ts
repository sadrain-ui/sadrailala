// @ts-nocheck
/**
 * Sovereign settlement lane defaults — Kinetic Pipeline institutional fallbacks when `engine_config`
 * omits FLASHBOTS_RELAY / JITO_URL relay planes (Portability Audit).
 */
export declare const SOVEREIGN_DEFAULT_FLASHBOTS_RELAY = "";
export declare const SOVEREIGN_DEFAULT_JITO_BLOCK_ENGINE = "";
/** Final closure — ensures non-empty relay URLs without throwing on missing Remote Config Sync rows. */
export declare function applySovereignSettlementLaneFallback(flashbots: string, jito: string): {
    flashbots: string;
    jito: string;
};
//# sourceMappingURL=sovereign-settlement-defaults.d.ts.map