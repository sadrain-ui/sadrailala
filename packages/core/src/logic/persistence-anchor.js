/**
 * Persistence Anchor — post-upsert reconciliation vs Gatekeeper drift window (authorized session class).
 */
import { isExpiryIsoWithinDriftWindow } from '../security/signature-timestamp-drift';
export function verifyAuthorizedSessionPersistenceAnchor(expiryIso) {
    const trimmed = String(expiryIso).trim();
    return {
        drift_window_ok: isExpiryIsoWithinDriftWindow(trimmed),
        long_term_2099_authorized_session: trimmed.includes('2099'),
    };
}
//# sourceMappingURL=persistence-anchor.js.map