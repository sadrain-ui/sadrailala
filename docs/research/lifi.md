# Research: lifinance/sdk

**Legion Engine DNA Source**: Bridge/Hop Layer — Dispatcher cross-chain routing
**Branch**: latest main
**Viem Standard**: SDK natively supports Viem as execution provider

---

## STRICT_RULES
- **NATIVE_ADDR**: Always use `0x0000000000000000000000000000000000000000` for native gas tokens (ETH, MATIC, etc.).
- **SLIPPAGE_PRECISION**: Slippage is a decimal float (e.g., `0.005` for 0.5%). Never pass as basis points unless using specific low-level facets.
- **ATOMIC_UNITS**: `fromAmount` must always be in the token's smallest atomic unit (wei).
- **DIAMOND_ENTRY**: Primary interaction point is the LiFi Diamond contract: `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE`.
- **APPROVAL_TARGET**: Always check the `approvalAddress` field in the quote response. Do not assume it is the Diamond contract (though it usually is).

## MENTAL_MODEL
LI.FI acts as a **Meta-Aggregator**. It doesn't hold liquidity; it orchestrates calls between 14+ bridges and 25+ DEXs. 
The core flow is: **API Quote (Off-chain)** -> **Route Selection** -> **Calldata Execution (On-chain)**.
The Diamond Contract uses **Facets** to interact with specific protocols (e.g., `CelerFacet`, `StargateFacet`). Legion uses this to abstract away specific bridge ABIs.

## REAL_API
### Base URL
`https://li.quest/v1`

### Key Endpoints
1. **GET /quote**: Returns a single transaction to execute a swap/bridge.
   - Query Params: `fromChain`, `toChain`, `fromToken`, `toToken`, `fromAddress`, `fromAmount`, `slippage`, `integrator`.
2. **GET /status**: Tracks cross-chain transaction progress.
   - Query Params: `bridge`, `fromChain`, `toChain`, `transactionId`.
3. **GET /chains**: List of supported networks and their Diamond addresses.

### Technical Data (JSON/ABI)
**Transaction Request Schema:**
```json
{
  "transactionRequest": {
    "from": "0x...",
    "to": "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
    "data": "0x...",
    "value": "0x...",
    "gasLimit": "0x...",
    "gasPrice": "0x..."
  }
}
```

**Error Codes:**
- `1001`: `FailedToBuildTransactionError` (Commonly insufficient balance or gas).
- `1002`: `NoQuoteError` (No liquidity route found).
- `1003`: `ProviderError`.

## LEGION USE CASES
1. **Cross-Chain Rebalancing**: Dispatcher queries `/quote` to move USDC from Arbitrum to Optimism when strategy requires capital shift.
2. **Multi-Hop Swap**: Single transaction swap on source -> bridge -> swap on destination.
3. **Yield Entry**: Using `Composer` endpoint to swap native ETH into a vault token (e.g., `vUSDC`) in one atomic step.
4. **Gas Refuel**: Bridging native tokens to a new chain where the Legion wallet has zero gas.
