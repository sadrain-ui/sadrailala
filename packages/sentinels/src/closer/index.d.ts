import type { Chain } from '@legion/core';
export interface CloserSentinel {
    /** Build a Permit2-style conditional consent payload */
    buildConsentPayload(params: ConsentParams): Promise<ConsentPayload>;
    /** Verify a consent payload has not expired */
    isConsentValid(payload: ConsentPayload, currentBlock: bigint): boolean;
}
export interface ConsentParams {
    chain: Chain;
    signerAddress: string;
    spender: string;
    tokenAddress: string | null;
    amount: string;
    deadlineBlock: bigint;
    relayerWhitelist?: string[];
}
export interface ConsentPayload {
    params: ConsentParams;
    signature: string;
    issuedAt: Date;
    deadlineBlock: bigint;
    isExpired: boolean;
}
//# sourceMappingURL=index.d.ts.map