# Logic-Map: Rabby Wallet (Advanced Telemetry & Simulation)

**Target Repository**: `https://github.com/RabbyHub/Rabby`
**Focus**: Pre-execution simulation, multi-chain asset telemetry, and EIP-6963 integration.

## 1. Provider Detection (Multi-Wallet Compatibility)

### 1.1 EIP-6963 (The Modern Standard)
```typescript
window.addEventListener("eip6963:announceProvider", (event) => {
  const { info, provider } = event.detail;
  if (info.rdns === "io.rabby") {
    // Rabby detected via standardized discovery
  }
});
```

### 1.2 Legacy window.ethereum
```typescript
if (window.ethereum?.isRabby) {
  // Rabby specific logic
}
```

## 2. STRICT_RULES: Execution Hardening

- **RULE 01**: NEVER assume `window.ethereum` is the only provider. Rabby often co-exists with MetaMask. Use EIP-6963 to target Rabby specifically.
- **RULE 02**: Leverage Rabby's `Pre-execution` UI. When sending a transaction, provide a clear `data` field so Rabby can simulate and show the user exactly what will change (balance shifts, approvals).
- **RULE 03**: Rabby switches accounts per-dapp. Always re-fetch `eth_accounts` on `accountsChanged` events to ensure the session is synced.

## 3. High-Lethality Patterns

### 3.1 Custom RPC Injection
Rabby allows users to add custom RPCs with specific Chain IDs. For Legion, this means we can point Rabby to a local anvil fork or a private MEV-geth node for "Shadow Execution" testing.

### 3.2 Security Telemetry
Rabby automatically scans for:
- **Contract Maturity**: Flags new/unverified contracts.
- **Approval Risks**: Flags "Infinite Approval" requests to unknown contracts.
- **Scam List**: Blocks domains on the DeBank/Rabby blacklist.

## 4. Operational API Surface
| Method | Description | Legion Pattern |
| :--- | :--- | :--- |
| `eth_requestAccounts` | Entry point for session | `provider.request({ method: 'eth_requestAccounts' })` |
| `eth_accounts` | Current active account | Check `isRabby` first to confirm context. |
| `wallet_addEthereumChain` | Add custom network | Use for Legion private L2/Sidechains. |

## 5. Legion Use Cases
- **Simulation Sentinel**: Use Rabby's built-in simulation engine as a secondary verification layer before a Legion "Closer" executes a high-stakes transaction.
- **Account Aggregator**: Target Rabby for users managing multiple high-net-worth accounts across different chains.
- **Phishing Protection**: Integrate with Rabby's scam-list API (via DeBank) to flag malicious counterparties in the Scout phase.
