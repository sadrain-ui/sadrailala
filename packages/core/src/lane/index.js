import { canTransition } from '../state/index';
// ─── Lane Transition Guard ───────────────────────────────────────────────────
// Throws on invalid transitions so callers don't need to check manually.
// See docs/STATE-MACHINE.md for the full 13-state lifecycle spec.
// VALID_TRANSITIONS and canTransition live in state/index.ts (single source of truth).
export function assertTransition(from, to) {
    if (!canTransition(from, to)) {
        throw new Error(`Invalid lane transition: ${from} -> ${to}`);
    }
}
// ─── Signature Expiry Guard ──────────────────────────────────────────────────
// See docs/LEGION-ENGINE.md §9 — Conditional Commitment Logic.
// signatureExpiry maps to block_deadline in DB-SCHEMA.md — the block number
// after which the Closer payload auto-expires (replay protection).
export function isSignatureExpired(event, currentBlock) {
    if (event.signatureExpiry === null)
        return false;
    return currentBlock > BigInt(event.signatureExpiry);
}
//# sourceMappingURL=index.js.map