// Extraction Lane state machine
// Maps the 13-state lifecycle from docs/STATE-MACHINE.md
// Valid transitions map — from: [to, to, ...]
export const VALID_TRANSITIONS = {
    pending: ['planned', 'cancelled'],
    planned: ['consented', 'cancelled', 'aborted'],
    consented: ['routed', 'expired', 'aborted'],
    routed: ['submitted', 'failed', 'aborted'],
    submitted: ['confirming', 'failed', 'expired'],
    confirming: ['confirmed', 'failed', 'replayed'],
    confirmed: ['settled'],
    settled: [],
    failed: ['pending'], // allow retry
    expired: ['pending'], // allow retry
    cancelled: [],
    replayed: ['aborted'],
    aborted: [],
};
export function canTransition(from, to) {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
export function transition(event, to) {
    if (!canTransition(event.status, to)) {
        throw new Error(`Invalid transition: ${event.status} → ${to}`);
    }
    return { ...event, status: to, updatedAt: new Date() };
}
//# sourceMappingURL=index.js.map