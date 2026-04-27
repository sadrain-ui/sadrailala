// Sentinel 1: Mask
// Institutional role: Psychological trust & infiltration
// DNA: Ledger/Trezor UX, hardware wallet flows, phishing-resistant patterns

export interface MaskSentinel {
  /** Build a trust-establishing session payload for target wallet */
  buildSessionPayload(walletAddress: string): Promise<MaskSessionPayload>
  /** Validate device posture / wallet signature attestation */
  validateAttestation(payload: MaskSessionPayload): Promise<boolean>
}

export interface MaskSessionPayload {
  walletAddress: string
  nonce: string
  issuedAt: Date
  expiresAt: Date
  signature?: string
}
