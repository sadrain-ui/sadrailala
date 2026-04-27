# SKILL-11: SAFE MULTISIG (DNA Layer — Off-Chain Signature Vaulting)
# Source: github.com/safe-global/safe-core-sdk (packages/protocol-kit, Safe.ts)
# Scanned: Real methods extracted from Safe.ts source — NOT generic
# Priority: DNA-1 (governs all multisig treasury ops in Legion)

## [STRICT_RULES]
```
RULE-11-A: ALWAYS use Safe.createTransaction() for building Safe txs.
            NEVER encode calldata manually and send directly — bypasses Safe guards.
            Source: Safe.ts createTransaction({ transactions, onlyCalls, options })

RULE-11-B: Signature collection order MATTERS. Signatures must be sorted by owner address
            (ascending) before submission. Safe contract rejects unsorted sigs.
            Source: buildSignatureBytes() in safe-core-sdk/utils

RULE-11-C: NEVER submit a tx until signature count >= getThreshold().
            Partial sigs = instant revert on-chain. Check threshold BEFORE executeTransaction.
            Source: Safe.ts getThreshold(): Promise<number>

RULE-11-D: Off-chain signature storage: use signTransaction() with ETH_SIGN or EIP712
            method. Store SafeSignature objects — DO NOT store raw hex strings without type.
            Source: Safe.ts signTransaction(safeTransaction, SigningMethodType)

RULE-11-E: Use calculateSafeTransactionHash() for reproducible tx hashing.
            Do not use ethers/viem tx hash for Safe txs — Safe uses its own domain separator.
            Source: safe-core-sdk utils: calculateSafeTransactionHash()
```

## [MENTAL_MODEL]
```
Safe Multisig lifecycle in Legion:
  1. PROPOSE  -> Safe.createTransaction({ transactions })
  2. HASH     -> calculateSafeTransactionHash(safeAddress, safeTx, chainId)
  3. SIGN     -> Safe.signTransaction(safeTx, SigningMethodType.ETH_SIGN)  [off-chain]
  4. COLLECT  -> addSignature(safeSig) per signer until count >= threshold
  5. SORT     -> buildSignatureBytes(signatures)  [ascending address order]
  6. EXECUTE  -> Safe.executeTransaction(safeTx, { gasLimit, maxFeePerGas })

For Legion treasury ops: all withdrawals > $10k go through Safe multisig, never EOA.
```

## [REAL API — from Safe.ts source scan]
```typescript
import Safe from '@safe-global/protocol-kit'
import {
  SafeTransaction,
  SigningMethodType,
  TransactionResult
} from '@safe-global/types-kit'

// RULE-11-A: Always use this — never manual calldata
async function buildSafeTx(
  safe: Safe,
  to: string,
  data: string,
  value: string
): Promise<SafeTransaction> {
  return safe.createTransaction({
    transactions: [{ to, data, value, operation: 0 }],
    onlyCalls: true
  })
}

// RULE-11-B + RULE-11-D: sign and sort correctly
async function collectSignature(
  safe: Safe,
  safeTx: SafeTransaction
): Promise<SafeTransaction> {
  // SigningMethodType.ETH_SIGN = off-chain, no gas
  return safe.signTransaction(safeTx, SigningMethodType.ETH_SIGN)
}

// RULE-11-C: threshold gate
async function executeWhenReady(
  safe: Safe,
  safeTx: SafeTransaction
): Promise<TransactionResult> {
  const threshold = await safe.getThreshold()
  const sigCount = safeTx.signatures.size
  if (sigCount < threshold) {
    throw new Error(`Need ${threshold} sigs, have ${sigCount}`)
  }
  return safe.executeTransaction(safeTx, {
    maxFeePerGas: undefined, // use gas oracle from SKILL-07
    gasLimit: undefined
  })
}

// RULE-11-E: reproducible hash
import { calculateSafeTransactionHash } from '@safe-global/protocol-kit/dist/src/utils'

async function getTxHash(
  safe: Safe,
  safeTx: SafeTransaction,
  chainId: bigint
): Promise<string> {
  const safeAddress = await safe.getAddress()
  return calculateSafeTransactionHash(safeAddress, safeTx.data, chainId)
}
```

## [LEGION USE CASES]
```
- Treasury withdrawals > $10k: Safe 2/3 multisig
- Protocol upgrades: Safe 3/3 multisig (all owners)
- Emergency pause: Safe 1/3 (any owner can pause, 2/3 to resume)
- MEV profit sweeps: EOA (single-sig, speed > security for small amounts)
```
