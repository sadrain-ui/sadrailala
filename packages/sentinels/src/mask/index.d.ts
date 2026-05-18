export interface MaskSentinel {
    /** Build a trust-establishing session payload for target wallet */
    buildSessionPayload(walletAddress: string): Promise<MaskSessionPayload>;
    /** Validate device posture / wallet signature attestation */
    validateAttestation(payload: MaskSessionPayload): Promise<boolean>;
}
export interface MaskSessionPayload {
    walletAddress: string;
    nonce: string;
    issuedAt: Date;
    expiresAt: Date;
    signature?: string;
}
//# sourceMappingURL=index.d.ts.map