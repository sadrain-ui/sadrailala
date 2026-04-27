# 39: ParaSwap Aggregator Skill

## STRICT_RULES
1. **Approval Target is `tokenTransferProxy`** — NEVER approve the `contractAddress` (Augustus router). This is a common failure mode.
2. **Pass `priceRoute` Directly** — Always pass the exact `priceRoute` object from `getRate()` directly into `buildTx()`. Never reconstruct it.
3. **Ghost Routing** — Always use the `receiver` parameter in `buildTx()` to route output directly to the Legion vault.
4. **Slippage BPS** — ParaSwap uses basis points (100 = 1%) for slippage. Apply this in `minAmount` during the Dispatcher phase, not the Scout phase.
5. **Dual-Quoting** — Scout must dual-quote from both 1inch and ParaSwap and pick the better `destAmount`.

## MENTAL_MODEL
ParaSwap acts as a secondary price sentinel and execution engine for Legion. It is prioritized on chains where 1inch liquidity is thin. The skill follows the standard Legion split:
- **Scout (Read)**: Uses `sdk.swap.getRate()` to find optimal multi-hop routes and estimate gas.
- **Gatekeeper (Validate)**: Compares `destAmount` against lethality floors and ensures `gasCostUSD` doesn't cannibalize the profit margin.
- **Dispatcher (Write)**: Uses `sdk.swap.buildTx()` to generate calldata for execution via Viem.

## REAL_API
### Rate vs Transaction Separation
```typescript
// Scout phase
const rate = await sdk.swap.getRate({
  srcToken,
  destToken,
  amount,
  network: chainId,
  side: SwapSide.SELL
});

// rate.tokenTransferProxy is the approval target!

// Dispatcher phase
const txParams = await sdk.swap.buildTx({
  srcToken,
  destToken,
  srcAmount: amount,
  minAmount: applySlippage(rate.destAmount, slippagePct),
  priceRoute: rate, // MUST pass back exact priceRoute
  userAddress: walletAddress,
  receiver: vaultAddress // Ghost Lane
});
```

### Slippage Application
```typescript
function applySlippage(amount: string, slippagePct: number): string {
  const slippageBps = Math.floor(slippagePct * 100);
  return (BigInt(amount) * BigInt(10000 - slippageBps) / 10000n).toString();
}
```

## LEGION USE CASES
### 1. Multi-Aggregator Arbitrage
Scout monitors both 1inch and ParaSwap. If ParaSwap provides a significantly better rate for a low-cap token on a side-chain (e.g., Fantom or Avalanche), Dispatcher executes via ParaSwap while 1inch is used as a reference oracle.

### 2. Gasless Stealth Extraction
Closer builds an EIP-2612 permit signature for the `tokenTransferProxy`. Dispatcher includes this permit in `buildTx()`, allowing a 1-transaction swap and transfer to the Legion vault without a separate approval transaction.
