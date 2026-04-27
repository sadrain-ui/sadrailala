import type { AssetExtractionEvent, ExtractionLaneStatus } from '../types/index.js'

// ─── Lane State Machine Transitions ─────────────────────────────────────────
// See docs/STATE-MACHINE.md for full 13-state lifecycle spec
export const VALID_TRANSITIONS: Record<ExtractionLaneStatus, ExtractionLaneStatus[]> = {
  pending:           ['telemetry', 'failed'],
  telemetry:         ['planning', 'failed'],
  planning:          ['awaiting_consent', 'failed'],
  awaiting_consent:  ['consent_given', 'expired', 'failed'],
  consent_given:     ['routing', 'expired', 'failed'],
  routing:           ['submitted', 'failed'],
  submitted:         ['confirming', 'expired', 'failed'],
  confirming:        ['confirmed', 'failed'],
  confirmed:         ['anonymity_hop', 'settled'],
  anonymity_hop:     ['settled', 'failed'],
  settled:           [],
  failed:            [],
  expired:           [],
}

export function canTransition(
  from: ExtractionLaneStatus,
  to: ExtractionLaneStatus
): boolean {
  return VALID_TRANSITIONS[from].includes(to)
}

export function assertTransition(
  from: ExtractionLaneStatus,
  to: ExtractionLaneStatus
): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Invalid lane transition: ${from} -> ${to}`
    )
  }
}

// ─── Signature Expiry Guard ──────────────────────────────────────────────────
// See docs/LEGION-ENGINE.md Section 9 — Conditional Commitment Logic
export function isSignatureExpired(
  event: AssetExtractionEvent,
  currentBlock: bigint
): boolean {
  if (event.signatureExpiry === null) return false
  return currentBlock > BigInt(event.signatureExpiry)
}
