# ⚡ Flashbots "God-Level" Logic-Map — Execution Hardening

Target Repository: `https://github.com/flashbots/mev-geth`
Focus: Bundle Submission, X-Flashbots-Signature, Bribe Math.

## 1. X-Flashbots-Signature (Auth Layer)

Every request to the Flashbots Relay must be signed by an arbitrary Ethereum key (the "Auth Key"). This key does not need to hold funds.

### 1.1 Signing Logic
The signature is a `secp256k1` signature of the `keccak256` hash of the JSON-RPC request body.

```typescript
const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_sendBundle', params: [...] });
const signature = await authSigner.signMessage(utils.keccak256(body));
const header = {
    'X-Flashbots-Signature': `${authSigner.address}:${signature}`
};
```

## 2. Bribe & Tip Math (Lethality calculation)

To ensure inclusion in the next block, the **Dispatcher** must calculate a competitive bribe.

### 2.1 Formula for Profitable Extraction
*   **Gross Profit ($P_g$):** $(Amount_{out} \cdot Price_{out}) - (Amount_{in} \cdot Price_{in})$
*   **Bribe Percentage ($\beta$):** Default `0.9` (90% to builder during high contention).
*   **Absolute Bribe ($B$):** $P_g \cdot \beta$

### 2.2 Payment Methods
1.  **Gas Price Inflation (Legacy):** Set `gasPrice` high enough so that `(gasPrice - baseFee) * gasUsed = B`.
2.  **Coinbase Transfer (Preferred):** Include a transaction in the bundle that sends ETH directly to `block.coinbase`.
    ```solidity
    block.coinbase.transfer(B);
    ```

## 3. Real API Signatures (Bundle Submission)

### 3.1 `eth_sendBundle`
```json
{
  "method": "eth_sendBundle",
  "params": [{
    "txs": ["0x...rawTx1", "0x...rawTx2"],
    "blockNumber": "0x123456",
    "minTimestamp": 0,
    "maxTimestamp": 123456789,
    "revertingTxHashes": ["0x..."]
  }]
}
```

## 4. STRICT_RULES
1. **Simulation Guard**: ALWAYS call `eth_callBundle` before submission. If `coinbaseDiff` is negative or 0, the extraction lane is non-lethal; ABORT.
2. **Target Block**: Target `currentBlock + 1`. If not included, re-simulate and re-sign for `currentBlock + 2` with updated bribe math.
3. **Bundle Atomicity**: Never submit an `approve` and `swap` as separate bundles. Combine them into a single `txs` array to prevent partial state execution.
4. **Auth Key Privacy**: Never use the execution wallet as the Auth Key signer. Keep them isolated.
