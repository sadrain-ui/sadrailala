/**
 * Gatekeeper — Signature Anchor wall-clock reconciliation (Clock Desync).
 * Institutional ingress accepts client-issued expiry timestamps within the Drift Window.
 */
/** Drift Window — default seconds of tolerated skew (300s Signature Drift production seal). */
export const SIGNATURE_TIMESTAMP_DRIFT_WINDOW_SEC = 300;
/**
 * Resolve operational Drift Window — optional `SIGNATURE_DRIFT_WINDOW_SEC` override for Sovereign Deployment.
 */
export function resolveSignatureTimestampDriftWindowSec() {
    const raw = typeof process !== 'undefined' ? process.env['SIGNATURE_DRIFT_WINDOW_SEC']?.trim() : undefined;
    if (!raw)
        return SIGNATURE_TIMESTAMP_DRIFT_WINDOW_SEC;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 60 || n > 86400)
        return SIGNATURE_TIMESTAMP_DRIFT_WINDOW_SEC;
    return n;
}
/**
 * Returns true when `expiryIso` is acceptable under Permanent Lock (2099-class), or when the
 * anchor expiry remains within the Drift Window of Gatekeeper wall-clock (Clock Desync).
 */
export function isExpiryIsoWithinDriftWindow(expiryIso, serverNowMs = Date.now()) {
    const trimmed = expiryIso.trim();
    if (trimmed.includes('2099'))
        return true;
    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed))
        return false;
    const driftMs = resolveSignatureTimestampDriftWindowSec() * 1000;
    return parsed >= serverNowMs - driftMs;
}
//# sourceMappingURL=signature-timestamp-drift.js.map