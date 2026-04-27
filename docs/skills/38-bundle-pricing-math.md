# 38 — Bundle Pricing Math

## STRICT_RULES

- NEVER send a bundle without simulating first via `flashbotsProvider.simulate()` — live bundles on failed sims burn nonces
- NEVER hardcode `maxFeePerGas`; always compute from `getBaseFeeInNextBlock()` + tip buffer
- NEVER assume top-of-block placement in PoS — ordering by effective gas price is NOT guaranteed
- NEVER skip `revertingTxHashes` for known-revertible txs; an unguarded revert drops the entire bundle
- NEVER compute effective gas price without including `ethSentToCoinbase` in the numerator
- ALWAYS call `sendBundle()` once per target block; bundles are single-block scoped
- ALWAYS re-sign with updated nonce when retargeting to next block
- ALWAYS set `replacementUuid` when replacing a pending bundle to avoid double-inclusion race
- ALWAYS use `BigNumber` for all fee math — floating point precision loss corrupts tip calculations
- ALWAYS verify `coinbaseDiff > 0` from simulation before submitting; negative diff = paying more than you earn

## MENTAL_MODEL

Flashbots bundle pricing operates on a single core equation:

```
mevGasPrice = (ethSentToCoinbase + sum(gasUsed[i] * priorityFee[i])) / totalGasUsed
```

The block builder ranks bundles by this score. In PoW this guaranteed top-of-block; in PoS it influences inclusion probability but not position. Your bundle must out-score the tail transactions of the target block to displace them.

Base fee is deterministic from the previous block:
- If `gasUsed > gasLimit/2` → base fee increases up to 12.5% per block
- If `gasUsed < gasLimit/2` → base fee decreases
- `BASE_FEE_MAX_CHANGE_DENOMINATOR = 8` (12.5% max swing)

For future blocks use `getMaxBaseFeeInFutureBlock(baseFee, N)` which compounds the 12.5% ceiling over N blocks — this gives a safe upper bound for `maxFeePerGas` so your tx cannot be priced out by a fee spike.

Coinbase payment strategy:
- Direct ETH transfer to `block.coinbase` costs ~21k extra gas but allows zero-gas-price swap txs
- Higher `priorityFeePerGas` on swap txs is simpler but each wei of priority fee costs 1 gas unit of overhead
- Optimal: use priority fees on high-gasUsed txs, coinbase payment only when swap gas is fixed cost

## REAL_API

### FlashbotsBundleProvider (ethers-provider-flashbots-bundle)

```typescript
import { FlashbotsBundleProvider, FlashbotsGasPricing } from '@flashbots/ethers-provider-bundle'

// Create provider
const flashbotsProvider = await FlashbotsBundleProvider.create(
  provider,          // ethers JsonRpcProvider
  authSigner,        // wallet for request signing (not gas-paying)
  'https://relay.flashbots.net',
  'mainnet'
)

// Compute next-block base fee
const nextBaseFee: BigNumber = FlashbotsBundleProvider.getBaseFeeInNextBlock(
  currentBlock.baseFeePerGas!,  // BigNumber
  currentBlock.gasUsed,          // BigNumber
  currentBlock.gasLimit          // BigNumber
)

// Compute safe maxFeePerGas for N blocks ahead (worst-case compounding)
const maxBaseFee: BigNumber = FlashbotsBundleProvider.getMaxBaseFeeInFutureBlock(
  currentBlock.baseFeePerGas!,
  3  // blocks in future
)

// Simulate bundle before sending
const sim = await flashbotsProvider.simulate(
  signedTxs,         // Array<string> — pre-signed raw txs
  targetBlockNumber,
  'latest'           // stateBlockTag
)
if ('error' in sim) throw new Error(sim.error.message)
const pricing: FlashbotsGasPricing = sim.bundleGasPricing
// pricing.effectiveGasPriceToSearcher — what you pay per gas
// pricing.ethSentToCoinbase           — direct coinbase payment
// pricing.coinbaseDiff                — total validator revenue from bundle
// pricing.gasUsed                     — total gas consumed
// pricing.gasFeesPaidBySearcher       — EIP-1559 fees paid
// pricing.priorityFeesReceivedByMiner — priority fee component

// Send bundle targeting a specific block
const bundleResponse = await flashbotsProvider.sendBundle(
  [
    { transaction: unsignedTx, signer: wallet },  // or { signedTransaction: rawTx }
  ],
  targetBlockNumber,
  {
    minTimestamp: 0,
    maxTimestamp: 0,
    revertingTxHashes: [],     // tx hashes allowed to revert without dropping bundle
    replacementUuid: uuid,     // set to replace a pending bundle
  }
)

// Wait for inclusion or block pass
const resolution = await bundleResponse.wait()
// FlashbotsBundleResolution.BundleIncluded
// FlashbotsBundleResolution.BlockPassedWithoutInclusion
// FlashbotsBundleResolution.AccountNonceTooHigh

// Get bundle stats post-submission
const stats = await flashbotsProvider.getBundleStatsV2(bundleHash, targetBlockNumber)
```

### FlashbotsGasPricing interface

```typescript
export interface FlashbotsGasPricing {
  txCount: number
  gasUsed: number
  gasFeesPaidBySearcher: BigNumber
  priorityFeesReceivedByMiner: BigNumber
  ethSentToCoinbase: BigNumber
  effectiveGasPriceToSearcher: BigNumber
  effectivePriorityFeeToMiner: BigNumber
}
```

### Effective gas price formula (manual)

```typescript
// mevGasPrice = (coinbaseDiff) / totalGasUsed
// coinbaseDiff = ethSentToCoinbase + sum(gasUsed[i] * priorityFee[i])
function calcEffectiveGasPrice(
  ethSentToCoinbase: BigNumber,
  priorityFeesTotal: BigNumber,
  totalGasUsed: BigNumber
): BigNumber {
  return ethSentToCoinbase.add(priorityFeesTotal).div(totalGasUsed)
}

// Minimum tip to displace tail block tx (tail gas price from recent blocks ~10-15 gwei)
function minCoinbaseBribe(
  targetMevGasPrice: BigNumber,  // gwei — tail block tx price
  bundleGasUsed: BigNumber,
  existingPriorityFees: BigNumber
): BigNumber {
  const required = targetMevGasPrice.mul(bundleGasUsed)
  const shortfall = required.sub(existingPriorityFees)
  return shortfall.isNegative() ? BigNumber.from(0) : shortfall
}
```

### EIP-1559 bundle tx construction

```typescript
const tx = {
  type: 2,
  chainId: 1,
  nonce: await wallet.getTransactionCount('pending'),
  to: TARGET,
  data: calldata,
  gasLimit: estimatedGas,
  maxFeePerGas: maxBaseFee.add(priorityFee),      // never goes below baseFee
  maxPriorityFeePerGas: priorityFee,              // tip to validator
}
```

## LEGION USE CASES

### 1. Pre-flight profit check before bundle submission

```typescript
async function isProfitable(
  flashbotsProvider: FlashbotsBundleProvider,
  signedTxs: string[],
  targetBlock: number,
  minProfitWei: BigNumber
): Promise<boolean> {
  const sim = await flashbotsProvider.simulate(signedTxs, targetBlock, 'latest')
  if ('error' in sim) return false
  const pricing = sim.bundleGasPricing
  // Profit = revenue captured - gas cost to searcher
  const gasCost = pricing.gasFeesPaidBySearcher
  const coinbaseRevenue = pricing.ethSentToCoinbase
  // Net: coinbaseDiff measures validator gain, not searcher gain
  // Searcher profit must be tracked via state diff in simulation
  return pricing.coinbaseDiff.gt(0) && pricing.effectiveGasPriceToSearcher.gt(0)
}
```

### 2. Dynamic tip scaling to beat competing bundles

```typescript
async function buildCompetitiveTip(
  baseFee: BigNumber,
  bundleGasUsed: number,
  competingMevGasPrice: BigNumber  // estimated from mempool scan
): Promise<{ maxFeePerGas: BigNumber; maxPriorityFeePerGas: BigNumber }> {
  // Beat competitor by 5%
  const targetMevGasPrice = competingMevGasPrice.mul(105).div(100)
  const requiredPriorityFees = targetMevGasPrice.mul(bundleGasUsed)
  const priorityFeePerGas = requiredPriorityFees.div(bundleGasUsed)
  const maxFeePerGas = baseFee.mul(2).add(priorityFeePerGas)  // 2x baseFee buffer
  return { maxFeePerGas, maxPriorityFeePerGas: priorityFeePerGas }
}
```

### 3. Multi-block bundle retry with nonce refresh

```typescript
async function sendWithRetry(
  flashbotsProvider: FlashbotsBundleProvider,
  txBuilder: (nonce: number, block: number) => Promise<string[]>,
  wallet: ethers.Wallet,
  maxBlocks = 5
): Promise<boolean> {
  const startBlock = await flashbotsProvider.getBlockNumber()
  for (let i = 0; i < maxBlocks; i++) {
    const targetBlock = startBlock + i + 1
    const nonce = await wallet.getTransactionCount('pending')
    const signedTxs = await txBuilder(nonce, targetBlock)
    const resp = await flashbotsProvider.sendRawBundle(signedTxs, targetBlock)
    if ('error' in resp) continue
    const resolution = await resp.wait()
    if (resolution === FlashbotsBundleResolution.BundleIncluded) return true
    if (resolution === FlashbotsBundleResolution.AccountNonceTooHigh) return false
  }
  return false
}
```

### 4. Coinbase bribe calculation for zero-gwei swap bundle

```typescript
function calcCoinbaseBribe(
  expectedProfitWei: BigNumber,
  keepBps: number,           // basis points to keep (e.g. 5000 = 50%)
  bundleGasUsed: BigNumber,
  baseFee: BigNumber
): BigNumber {
  // Pay validator the baseFee cost + portion of profit
  const baseFeeTotal = baseFee.mul(bundleGasUsed)
  const validatorShare = expectedProfitWei.mul(10000 - keepBps).div(10000)
  return baseFeeTotal.add(validatorShare)
}
// Usage: send coinbase.transfer(bribe) as last tx in bundle
// tx.gasPrice = 0, gasLimit = 21000 for the bribe transfer
```
