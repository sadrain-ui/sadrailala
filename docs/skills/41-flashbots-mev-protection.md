# Flashbots MEV Protection Skill

Private transaction routing and bundle execution via Flashbots Protect RPC and Bundle API to prevent frontrunning and ensure atomic execution.

## Core Rules

- **Unified module**: `@legion/core/mev-relay` — see [docs/MEV-RELAY.md](../MEV-RELAY.md) for `MEV_PROTECT`, `MEV_RELAY_URL`, and settlement integration.
- **Endpoints**:
  - Protect RPC: `https://rpc.flashbots.net` (Mainnet only) — `eth_sendPrivateTransaction`
  - Bundle API: `https://relay.flashbots.net` (eth_sendBundle)
- **Security**: Always use a separate Auth Signer (EOA with zero funds) for the `X-Flashbots-Signature` header.
- **Simulation**: NEVER submit a bundle without first calling `eth_callBundle` to ensure it doesn't revert.
- **Targeting**: Target the next block (`currentBlock + 1`).
- **Monitoring**: Poll block inclusion for 3-5 blocks; do not rely on relay API for inclusion status.

## Mental Model

Flashbots acts as a private lane (Ghost Lane) that bypasses the public mempool. Transactions are either included atomically or dropped entirely, protecting Legion from searchers.

## Real API Details

### Flashbots Bundle (eth_sendBundle)
```typescript
type FlashbotsBundle = {
  txs: Hex[];              // signed raw transactions
  blockNumber: Hex;        // target block in hex
  minTimestamp?: number;
  maxTimestamp?: number;
  revertingTxHashes?: Hex[];
}
```

### Simulation Request
```typescript
{
  jsonrpc: '2.0',
  method: 'eth_callBundle',
  params: [{
    txs: signedTxs,
    blockNumber: targetBlockHex,
    stateBlockNumber: 'latest'
  }]
}
```

## Integration Patterns

### 1. Protect RPC (Simplest Ghost Lane)
Used by the **Dispatcher** for single-tx extractions via a standard Viem `walletClient`.
```typescript
const ghostWallet = createWalletClient({
  chain: mainnet,
  transport: http('https://rpc.flashbots.net'),
  account: executionSigner
});
```

### 2. Atomic Multi-Tx Bundle
Used by the **Closer** for complex extractions (e.g., `[Approve, Swap]`).
```typescript
const signature = await authSigner.signMessage({
  message: keccak256(toBytes(JSON.stringify(bundleBody)))
});

const res = await fetch('https://relay.flashbots.net', {
  method: 'POST',
  headers: {
    'X-Flashbots-Signature': `${authSigner.address}:${signature}`
  },
  body: JSON.stringify(bundleBody)
});
```

## Use Cases

1. **Ghost/Dispatcher**: Private tx routing for single-step extractions.
2. **Closer**: Atomic multi-transaction bundles to capture profit.
3. **Shadow**: Mandatory pre-submission simulation.
4. **Gatekeeper**: Profitability check via `bundleGasPrice` comparison.
