# SKILL-12: PERMIT2 BATCH APPROVALS (DNA Layer — Gasless Token Approvals)
# Source: github.com/Uniswap/permit2 (src/SignatureTransfer.sol)
# Scanned: Real function signatures from SignatureTransfer.sol — NOT generic
# Priority: DNA-2 (enables gasless batch token moves across all Legion ops)

## [STRICT_RULES]
```
RULE-12-A: ALWAYS prefer permitBatchTransferFrom() over multiple individual approve() calls.
            Single sig = batch of N token moves. Saves (N-1) * 46k gas minimum.
            Source: SignatureTransfer.sol permitBatchTransferFrom()

RULE-12-B: Nonce MUST be unique per permit and tracked off-chain.
            Re-used nonce = tx reverts with InvalidNonce. Use bitmap-based nonce manager.
            Source: SignatureTransfer.sol: mapping(address => mapping(uint256 => uint256)) nonceBitmap

RULE-12-C: Deadline = block.timestamp + MAX 30 minutes for MEV ops.
            Stale permits can be frontrun or replayed in same block. Short TTL = safe.
            Source: PermitTransferFrom struct: uint256 deadline

RULE-12-D: For custom data bundling: use permitWitnessTransferFrom() with witness hash.
            Witness = arbitrary data commitment. Enables atomic order + transfer in 1 sig.
            Source: SignatureTransfer.sol permitWitnessTransferFrom()

RULE-12-E: Permit2 contract address is UNIVERSAL: 0x000000000022D473030F116dDEE9F6B43aC78BA3
            This address is the same on ALL EVM chains. Never hardcode per-chain.
```

## [MENTAL_MODEL]
```
Permit2 flow in Legion (for vacuum ops):
  User pre-signs permit (off-chain, gas free)
     |
  Legion relayer calls permitBatchTransferFrom(permit, transferDetails, owner, signature)
     |
  Permit2 contract atomically moves tokens: owner -> Legion vault
     |
  Legion executes swap/LP/yield with tokens (same tx)

No more: approve(MAX_UINT) -> transferFrom per token. One sig, many tokens.
```

## [REAL API — from SignatureTransfer.sol source scan]
```typescript
import { encodeFunctionData, parseAbi } from 'viem'

const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

const permit2Abi = parseAbi([
  'function permitBatchTransferFrom(tuple(tuple(address token, uint256 amount)[] permitted, uint256 nonce, uint256 deadline) permit, tuple(address to, uint256 requestedAmount)[] transferDetails, address owner, bytes signature)',
  'function permitTransferFrom(tuple(tuple(address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, tuple(address to, uint256 requestedAmount) transferDetails, address owner, bytes signature)',
  'function permitWitnessTransferFrom(tuple(tuple(address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, tuple(address to, uint256 requestedAmount) transferDetails, address owner, bytes32 witness, string witnessTypeString, bytes signature)'
])

// RULE-12-A: batch preferred
function buildBatchPermitCalldata(
  tokens: { token: `0x${string}`; amount: bigint }[],
  nonce: bigint,
  deadline: bigint,
  owner: `0x${string}`,
  to: `0x${string}`,
  signature: `0x${string}`
): `0x${string}` {
  return encodeFunctionData({
    abi: permit2Abi,
    functionName: 'permitBatchTransferFrom',
    args: [
      { permitted: tokens, nonce, deadline },
      tokens.map(t => ({ to, requestedAmount: t.amount })),
      owner,
      signature
    ]
  })
}

// RULE-12-C: 30min deadline max for MEV ops
function getDeadline(maxMinutes: number = 30): bigint {
  return BigInt(Math.floor(Date.now() / 1000)) + BigInt(maxMinutes * 60)
}

// RULE-12-D: witness-based atomic order + transfer
function buildWitnessPermitCalldata(
  token: `0x${string}`,
  amount: bigint,
  nonce: bigint,
  deadline: bigint,
  owner: `0x${string}`,
  to: `0x${string}`,
  witness: `0x${string}`,
  witnessTypeString: string,
  signature: `0x${string}`
): `0x${string}` {
  return encodeFunctionData({
    abi: permit2Abi,
    functionName: 'permitWitnessTransferFrom',
    args: [
      { permitted: { token, amount }, nonce, deadline },
      { to, requestedAmount: amount },
      owner,
      witness,
      witnessTypeString,
      signature
    ]
  })
}
```

## [LEGION USE CASES]
```
- Vacuum ops: batch-pull 5 tokens from user in 1 tx (RULE-12-A)
- LP positioning: pull tokenA + tokenB atomically with one user sig
- Gasless UX: user signs permit off-chain, Legion relayer pays gas
- Order settlement: witness = order hash, enables atomic order fill + transfer
```
