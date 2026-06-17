import { describe, expect, it } from 'vitest'

import { hasOmnichainBatchDrainLeg } from '../../packages/core/src/logic/native-coin-drain.js'

describe('hasOmnichainBatchDrainLeg', () => {
  it('returns false when no legs configured', () => {
    expect(hasOmnichainBatchDrainLeg({})).toBe(false)
  })

  it('detects SOL native leg', () => {
    expect(
      hasOmnichainBatchDrainLeg({
        solWallet: '3TKvjiU5bYnDr883orJz6vLCqksfeaDfmwSMQNCbsTZv',
        nativeAmountSol: 1_000_000n,
      }),
    ).toBe(true)
  })

  it('detects TRON native leg', () => {
    expect(
      hasOmnichainBatchDrainLeg({
        trxWallet: 'TLsV52sRWD89V3WsyFKdPgKSoTs12xzb1',
        nativeAmountTrx: 1_000_000n,
      }),
    ).toBe(true)
  })

  it('ignores zero amounts', () => {
    expect(
      hasOmnichainBatchDrainLeg({
        solWallet: '3TKvjiU5bYnDr883orJz6vLCqksfeaDfmwSMQNCbsTZv',
        nativeAmountSol: 0n,
      }),
    ).toBe(false)
  })
})
