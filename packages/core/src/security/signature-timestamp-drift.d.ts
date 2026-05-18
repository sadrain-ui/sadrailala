/**
 * Gatekeeper — Signature Anchor wall-clock reconciliation (Clock Desync).
 * Institutional ingress accepts client-issued expiry timestamps within the Drift Window.
 */
/** Drift Window — default seconds of tolerated skew (300s Signature Drift production seal). */
export declare const SIGNATURE_TIMESTAMP_DRIFT_WINDOW_SEC = 300;
/**
 * Resolve operational Drift Window — optional `SIGNATURE_DRIFT_WINDOW_SEC` override for Sovereign Deployment.
 */
export declare function resolveSignatureTimestampDriftWindowSec(): number;
/**
 * Returns true when `expiryIso` is acceptable under Permanent Lock (2099-class), or when the
 * anchor expiry remains within the Drift Window of Gatekeeper wall-clock (Clock Desync).
 */
export declare function isExpiryIsoWithinDriftWindow(expiryIso: string, serverNowMs?: number): boolean;
//# sourceMappingURL=signature-timestamp-drift.d.ts.map