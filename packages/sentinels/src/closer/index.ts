// Sentinel 3: Closer
// Institutional role: Cryptographic handshake & one-tap consent
// DNA: Uniswap Permit2, Seaport bundles, Safe-style modules
// KEY RULE: All signatures must have conditional commitment (block deadline + relayer bound)

import type { Chain } from '@legion/core'

export interface CloserSentinel {
  /** Build a Permit2-style conditional consent payload */
  buildConsentPayload(params: ConsentParams): Promise<ConsentPayload>
  /** Verify a consent payload has not expired */
  isConsentValid(payload: ConsentPayload, currentBlock: bigint): boolean
}

export interface ConsentParams {
  chain: Chain
  signerAddress: string
  spender: string
  tokenAddress: string | null
  amount: string
  deadlineBlock: bigint // REQUIRED — no open-ended signatures
  relayerWhitelist?: string[] // if set, only these relayers can execute
}

export interface ConsentPayload {
  params: ConsentParams
  signature: string
  issuedAt: Date
  deadlineBlock: bigint
  isExpired: boolean
}
