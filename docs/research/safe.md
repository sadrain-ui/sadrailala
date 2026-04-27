# 🔐 Safe Core "God-Level" Logic-Map — Execution Hardening

Target Repository: `https://github.com/safe-global/safe-core-sdk`
Focus: Multi-sig Hashing, Transaction Service Telemetry, EIP-712 Structs.

## 1. EIP-712 Hashing (SafeTx)

### 1.1 SAFE_TX_TYPEHASH
The definitive TypeHash for signing transactions within the Safe ecosystem.
`0xbbd351e60ad4807038fb8d7fa351f73d8a699bfcb2f2adc4866d28caf631bb85`

String representation:
`"SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address refundReceiver,uint256 nonce)"`

### 1.2 Hashing Structural Layout
To generate the `safeTxHash` for the **Closer** sentinel:
1.  **Domain Separator**: Includes `chainId`, `verifyingContract` (the Safe address).
2.  **Struct Hash**: `keccak256(abi.encode(SAFE_TX_TYPEHASH, to, value, keccak256(data), operation, safeTxGas, baseGas, gasPrice, refundReceiver, nonce))`
3.  **Final Hash**: `keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash))`

## 2. Transaction Service Endpoints (Telemetry API)

Legion **Scout** uses these to poll for pending signatures and historical asset moves.

| Network | Chain ID | Service Base URL |
|---------|----------|------------------|
| **Ethereum** | 1 | `https://safe-transaction-mainnet.safe.global/` |
| **Optimism** | 10 | `https://safe-transaction-optimism.safe.global/` |
| **Base** | 8453 | `https://safe-transaction-base.safe.global/` |
| **Arbitrum** | 42161 | `https://safe-transaction-arbitrum.safe.global/` |
| **Polygon** | 137 | `https://safe-transaction-polygon.safe.global/` |

## 3. Real API Signatures (Protocol Kit)

### 3.1 Create Transaction
```typescript
const safeTransaction = await safeSdk.createTransaction({
  transactions: [{ to, value, data, operation: OperationType.Call }]
})
```

### 3.2 Propose to Service (Scout/Closer sync)
`POST /api/v1/safes/{address}/multisig-transactions/`
Payload: `{ to, value, data, operation, safeTxGas, baseGas, gasPrice, refundReceiver, nonce, contractTransactionHash, sender, signature, origin }`

## 4. STRICT_RULES
1. **Nonce Sync**: ALWAYS fetch the latest nonce from the Safe contract via `safe.getNonce()` before proposing to the service to avoid out-of-order execution.
2. **Threshold Awareness**: Check `safe.getThreshold()`; the Dispatcher must not attempt execution until `signatures.length >= threshold`.
3. **DelegateCall Guard**: For logic extractions, use `operation: 1` (DelegateCall). For standard transfers, use `operation: 0` (Call).
4. **Endpoint Resilience**: If the Safe Transaction Service is down, the **Mask** sentinel must fallback to direct contract-level signature collection via events.
