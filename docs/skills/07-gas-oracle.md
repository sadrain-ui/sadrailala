# SKILL-07: GAS ORACLE (Execution Cost Intelligence)
# Source: flashbots/mev-boost, eth-gas-reporter, blocknative gas API
# Priority: 7 (applied during bundle construction and tx submission)

## [STRICT_RULES]
```
RULE-07-A: NEVER use eth_gasPrice. Always use eth_feeHistory with 4-block window.
            Legacy gasPrice is unreliable post-EIP-1559. Fee history gives real percentile data.

RULE-07-B: maxPriorityFeePerGas floor = 0.1 gwei on mainnet, 0.001 gwei on L2s.
            Below floor = tx likely dropped by mempools. Sentinel: 'GasOracle'.

RULE-07-C: maxFeePerGas = baseFee * 1.25 + priorityFee.
            The 1.25 buffer absorbs 2 consecutive max-increase blocks (12.5% each).

RULE-07-D: For time-sensitive ops (MEV, liquidations): use 95th percentile priority fee.
            For normal transfers: use 50th percentile. Never overpay for non-competitive ops.

RULE-07-E: Re-estimate gas every block if tx is pending > 2 blocks.
            Stale gas = missed opportunity or overpay on congested chains.
```

## [MENTAL_MODEL]
```
EIP-1559 fee structure:
  baseFee     = protocol-set, burned, adjusts ±12.5% per block based on fullness
  priorityFee = tip to validator, competitive in high-demand slots
  maxFee      = hard cap: baseFee + priorityFee must not exceed this

For Legion: always bid to WIN, not to save. Missing a vacuum window costs more than overpaying gas.
```

## [IMPLEMENTATION]

```typescript
import { createPublicClient, http, parseGwei } from 'viem'
import { mainnet } from 'viem/chains'
import { createLegionError, LegionErrorCode } from '../errors'

const BLOCKS_BACK = 4
const BASE_FEE_BUFFER = 1.25
const MAINNET_MIN_PRIORITY = parseGwei('0.1')
const L2_MIN_PRIORITY = parseGwei('0.001')

export interface GasEstimate {
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  baseFee: bigint
  confidence: 'low' | 'medium' | 'high'
}

export type GasMode = 'competitive' | 'standard' | 'economy'

const client = createPublicClient({ chain: mainnet, transport: http() })

export async function estimateGas(
  mode: GasMode = 'standard',
  chainId: number = 1
): Promise<GasEstimate> {
  // RULE-07-A: use eth_feeHistory, never eth_gasPrice
  const feeHistory = await client.getFeeHistory({
    blockCount: BLOCKS_BACK,
    rewardPercentiles: [10, 50, 95]
  })

  const baseFees = feeHistory.baseFeePerGas.filter(Boolean) as bigint[]
  if (!baseFees.length) {
    throw createLegionError({ code: LegionErrorCode.GAS_ESTIMATION_FAILED, sentinel: 'GasOracle' })
  }

  const latestBase = baseFees[baseFees.length - 1]
  const rewards = feeHistory.reward ?? []

  // Pick percentile based on mode
  const percentileIndex = mode === 'competitive' ? 2 : mode === 'standard' ? 1 : 0
  const prioritySamples = rewards.map(r => r[percentileIndex]).filter(Boolean) as bigint[]

  const avgPriority = prioritySamples.length
    ? prioritySamples.reduce((a, b) => a + b, 0n) / BigInt(prioritySamples.length)
    : MAINNET_MIN_PRIORITY

  // RULE-07-B: enforce floor
  const minPriority = chainId === 1 ? MAINNET_MIN_PRIORITY : L2_MIN_PRIORITY
  const maxPriorityFeePerGas = avgPriority < minPriority ? minPriority : avgPriority

  // RULE-07-C: buffer baseFee
  const bufferedBase = (latestBase * BigInt(Math.floor(BASE_FEE_BUFFER * 100))) / 100n
  const maxFeePerGas = bufferedBase + maxPriorityFeePerGas

  const confidence: GasEstimate['confidence'] =
    mode === 'competitive' ? 'high' : mode === 'standard' ? 'medium' : 'low'

  return {
    maxFeePerGas,
    maxPriorityFeePerGas,
    baseFee: latestBase,
    confidence
  }
}

export async function shouldReplaceTransaction(
  pendingNonce: number,
  pendingMaxFee: bigint,
  currentBlock: number,
  submittedBlock: number
): Promise<boolean> {
  // RULE-07-E: re-estimate if pending > 2 blocks
  if (currentBlock - submittedBlock <= 2) return false

  const fresh = await estimateGas('competitive')
  // Replace if current market fee is >10% higher than our pending tx
  const threshold = (pendingMaxFee * 110n) / 100n
  return fresh.maxFeePerGas > threshold
}

// ============================================================
// SECTION: GAS COST ESTIMATOR (for profitability checks)
// ============================================================

export async function estimateGasCost(
  gasLimit: bigint,
  mode: GasMode = 'standard',
  chainId: number = 1
): Promise<bigint> {
  const { maxFeePerGas } = await estimateGas(mode, chainId)
  return gasLimit * maxFeePerGas
}

export async function isGasProfitable(
  estimatedProfit: bigint,
  gasLimit: bigint,
  mode: GasMode = 'competitive',
  chainId: number = 1
): Promise<boolean> {
  const gasCost = await estimateGasCost(gasLimit, mode, chainId)
  // Must net positive after gas
  return estimatedProfit > gasCost
}
