# Logic-Map: Safe Core SDK (Account Abstraction)

**Target Repository**: `https://github.com/safe-global/safe-core-sdk`
**Focus**: Smart Accounts, Multi-sig Sync, Transaction Proposal, and Execution.

## 🏛 Architecture Overview

The Safe Core SDK is a monorepo designed to facilitate interaction with Safe (Gnosis Safe) smart contracts. For Legion Engine, it provides the "Sovereign Control" layer.

- **`protocol-kit`**: The core library. Handles account instantiation, transaction creation, signing, and local execution logic.
- **`api-kit`**: Client for the Safe Transaction Service. Essential for off-chain signature collection and tracking pending transactions.
- **`relay-kit`**: Integration for relayers (like Gelato) to enable gasless or sponsored transactions.
- **`types-kit`**: Shared TypeScript definitions across the monorepo.

## 🤝 Handshake & Sync Flow

1. **Account Discovery**:
   - Use `api-kit.getSafesByOwner(address)` to identify all Safe accounts where a specific EOA is an owner.
   - Legion uses this for the **Scout** sentinel to map out existing assets.

2. **Initialization**:
   - Create a `Safe` instance using `protocol-kit`.
   - Requires a `SafeProvider` (adapter for Viem/Ethers).

3. **State Sync**:
   - Fetch threshold, owners, and nonce directly from the contract via `protocol-kit`.
   - Fetch pending transactions from the Safe Service via `api-kit`.

## ✍️ Transaction & Signature Flow

1. **Transaction Creation**:
   - `safe.createTransaction({ transactions: [...] })`: Creates a `SafeTransaction` object.
   - Supports batching multiple calls into a single Safe transaction.

2. **Signing**:
   - `safe.signTransaction(safeTransaction)`: Generates a signature from the connected owner.
   - For multi-sig: The first owner signs and proposes to the service via `api-kit.proposeTransaction()`.

3. **Collection**:
   - Other owners poll the service via `api-kit.getPendingTransactions()`.
   - They sign locally and submit signatures back to the service.

4. **Execution**:
   - Once threshold is met, any owner can call `safe.executeTransaction(safeTransaction)`.
   - Alternatively, use `relay-kit` to execute via a relayer if gas abstraction is required.

## 🧬 Data Models

- **`SafeTransaction`**:
  - `to`, `value`, `data`: Standard EVM fields.
  - `operation`: Call (0) or DelegateCall (1).
  - `nonce`: Safe-specific sequence number.
  - `signatures`: A Map of owner addresses to `SafeSignature` objects.

- **`SafeSignature`**:
  - `signer`: Address of the owner.
  - `data`: The raw signature string.

## 📂 Key File References

- `packages/protocol-kit/src/Safe.ts`: Main entry point for account logic.
- `packages/api-kit/src/SafeApiKit.ts`: Interaction with the off-chain Transaction Service.
- `packages/protocol-kit/src/utils/transactions/SafeTransaction.ts`: Logic-map for the transaction object.
- `packages/relay-kit/src/RelayKit.ts`: Entry point for sponsored execution.

---
*Generated for Legion Engine Research*
