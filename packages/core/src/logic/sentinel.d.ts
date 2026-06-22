// @ts-nocheck
/**
 * @module @legion/core/logic/sentinel
 * Autonomous Sentinel — Watchdog Circuit + Sovereign Telemetry emission hooks.
 */
/** Watchdog Circuit — JSON-RPC latency ceiling before failover rotation (ms). */
export declare const WATCHDOG_CIRCUIT_LATENCY_THRESHOLD_MS = 500;
/** Sovereign Telemetry — capture-value webhook threshold (USD). */
export declare const SOVEREIGN_TELEMETRY_CAPTURE_THRESHOLD_USD = 500;
/** Sovereign Telemetry — quota pressure threshold (percent). */
export declare const SOVEREIGN_TELEMETRY_QUOTA_ALERT_PCT = 80;
export type SentinelOperationalLed = 'nominal' | 'alert' | 'critical';
export type WatchdogCircuitResult = {
    ok: boolean;
    status: number;
    urlUsed: string;
    /** Watchdog Circuit engaged backup RPC after 429 / 5xx. */
    rotatedFrom429Or5xx: boolean;
    /** Watchdog Circuit rotated after latency exceeded {@link WATCHDOG_CIRCUIT_LATENCY_THRESHOLD_MS}. */
    rotatedFromLatency: boolean;
    /** Sentinel Healing — successful recovery after Watchdog rotation. */
    sentinelHealing: boolean;
    response?: Response;
};
export declare function recordSentinelHealingEvent(): void;
export declare function recordWatchdogCircuitRotation(): void;
export declare function recordWatchdogCircuitFailure(): void;
/**
 * Watchdog Circuit — auto-rotate JSON-RPC endpoints on HTTP 429 / 5xx or latency above threshold.
 */
export declare function watchdogCircuitRpcPost(rpcUrls: readonly string[], body: string, init?: RequestInit): Promise<WatchdogCircuitResult>;
export type SovereignTelemetryEmitReason = 'capture_value_threshold' | 'quota_pressure' | 'sentinel_healing';
export declare function evaluateSovereignTelemetryEmit(params: {
    capture_value_usd?: number;
    quota_percent?: number;
    sentinel_healing?: boolean;
}): {
    emit: boolean;
    reasons: SovereignTelemetryEmitReason[];
};
export declare function pushSovereignTelemetryWebhook(webhookUrl: string, payload: Record<string, unknown>): Promise<boolean>;
export declare function resolveSentinelOperationalLed(nowMs?: number): SentinelOperationalLed;
//# sourceMappingURL=sentinel.d.ts.map