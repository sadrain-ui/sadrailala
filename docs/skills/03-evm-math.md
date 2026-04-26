# SKILL-03: EVM ASSEMBLY & MATH
# Source Repos: solady (gas-optimized Solidity), revm (Rust EVM patterns)
# Priority: 7 (applied after safety/stealth/MEV/token rules)

## [STRICT_RULES]
```
RULE-03-A: ALL wei/bigint arithmetic MUST use BigInt — ZERO floating point.
           0.1 ETH is NOT 0.1 * 1e18. It is parseEther('0.1') → 100000000000000000n.
           Floating point in financial math = silent precision loss = wrong amounts.

RULE-03-B: Gas estimation MUST use simulation result + 20% buffer.
           NEVER use eth_estimateGas alone — it can under-estimate complex txs.
           Formula: gasLimit = (simulatedGasUsed * 120n) / 100n

RULE-03-C: Batch operations MUST use multicall3 pattern when reading on-chain data.
           Never make N sequential eth_call — use one multicall3 call for N reads.
           Reduces RPC calls by ~90% in multi-token scanning.

RULE-03-D: solady FixedPointMath patterns for percentage calculations:
           Use WAD (1e18) arithmetic. Never divide before multiply.
           Wrong: (amount / total) * 100  → precision loss
           Right: (amount * 100n * WAD) / (total * WAD)  → exact

RULE-03-E: Tenderly OR Viem publicClient.call() simulation is MANDATORY
           before any state-changing transaction. No exceptions.
```

---

## 1. Safe BigInt Math (solady-style)

```typescript
export const WAD = 10n ** 18n  // 1e18 — base unit for percentage math
export const RAY = 10n ** 27n  // Aave's ray unit

// Percentage: what % of total is amount? Returns WAD-scaled result
export function wadDiv(amount: bigint, total: bigint): bigint {
  if (total === 0n) throw new LegionError({ code: 'DIVISION_BY_ZERO' })
  return (amount * WAD) / total
}

// Apply slippage: amount * (1 - slippageBps/10000)
export function applySlippageBps(amount: bigint, slippageBps: bigint): bigint {
  return (amount * (10_000n - slippageBps)) / 10_000n
}

// Gas buffer: simulation result + 20%
export function withGasBuffer(simGas: bigint, bufferPct = 20n): bigint {
  return (simGas * (100n + bufferPct)) / 100n
}

// Token amount: human readable → wei
export function toTokenUnits(amount: string, decimals: number): bigint {
  const [whole, frac = ''] = amount.split('.')
  const fracPadded = frac.padEnd(decimals, '0').slice(0, decimals)
  return BigInt(whole + fracPadded)
}
```

## 2. Multicall3 Batch Reading

```typescript
import { getContract } from 'viem'

const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'

// Batch read N token balances in ONE RPC call
async function batchGetBalances(
  publicClient: PublicClient,
  tokens: Address[],
  owner: Address
): Promise<bigint[]> {
  const calls = tokens.map(token => ({
    target: token,
    allowFailure: true,
    callData: encodeFunctionData({
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [owner]
    })
  }))

  const results = await publicClient.readContract({
    address: MULTICALL3_ADDRESS,
    abi: multicall3Abi,
    functionName: 'aggregate3',
    args: [calls]
  })

  return results.map((r, i) => {
    if (!r.success) return 0n  // failed call = 0 balance
    return decodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', data: r.returnData })
  })
}
```

## 3. Gas Estimation with Buffer

```typescript
async function estimateGasSafe(
  publicClient: PublicClient,
  tx: { from: Address; to: Address; data: Hex; value?: bigint }
): Promise<bigint> {
  // Step 1: Tenderly simulation (preferred)
  try {
    const simResult = await tenderlySimulate(tx)
    if (!simResult.success) throw new LegionError({ code: 'SIMULATION_REVERT' })
    return withGasBuffer(BigInt(simResult.gasUsed))
  } catch {
    // Step 2: Fallback to eth_estimateGas + larger buffer
    const estimated = await publicClient.estimateGas(tx)
    return withGasBuffer(estimated, 30n)  // 30% buffer when using estimateGas
  }
}
```

## 4. EIP-1559 Gas Pricing

```typescript
async function getOptimalGasPrice(
  publicClient: PublicClient,
  urgency: 'normal' | 'fast' | 'instant'
): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const feeHistory = await publicClient.getFeeHistory({
    blockCount: 4,
    rewardPercentiles: [25, 50, 75]
  })

  const baseFee = feeHistory.baseFeePerGas.at(-1)!  // next block base fee
  
  const priorityMultiplier = { normal: 100n, fast: 150n, instant: 200n }[urgency]
  const medianPriority = feeHistory.reward!.map(r => r[1]).sort()[2]  // 50th pct
  const maxPriority = (medianPriority * priorityMultiplier) / 100n
  
  return {
    maxFeePerGas: baseFee * 2n + maxPriority,  // 2x base fee headroom
    maxPriorityFeePerGas: maxPriority
  }
}
```

## 5. Simulation Before Broadcast (Mandatory Gate)

```typescript
// This function is the ONLY path to broadcasting a transaction in Legion
export async function simulateThenBroadcast(
  tx: PreparedTx,
  clients: { public: PublicClient; wallet: WalletClient },
  laneId: string
): Promise<Hex> {
  // GATE 1: Shadow simulation
  const sim = await shadowSimulate(tx, tx.chainId)
  if (!sim.success) {
    throw createLegionError({
      code: LegionErrorCode.SIMULATION_REVERT,
      sentinel: 'Shadow',
      laneId,
      cause: sim.revertReason,
      recoverable: false
    })
  }

  // GATE 2: Gas with buffer
  const gasLimit = withGasBuffer(BigInt(sim.gasUsed))

  // GATE 3: Broadcast
  const txHash = await clients.wallet.sendTransaction({
    ...tx,
    gas: gasLimit
  })

  return txHash
}
```
