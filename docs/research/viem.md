# Logic-Map: Viem (Core EVM Standard)

**Target Repository**: `https://github.com/wevm/viem`
**Focus**: Modular Architecture, Client Abstraction, Type-Safe ABI, and Efficient Encoding.

## 🏛 Architecture Overview

Viem is the primary EVM standard for Legion Engine. Its modular design allows for a lightweight core with extensible functionalities.
ctrl+# Logic-Map: Viem (Core EVM Standard)

**Target Repository**: `https://github.com/wevm/viem`
**Focus**: High-performance, type-safe primitives for EVM interaction. No bloat, pure functional composition.

## 1. Client Architecture (Immutable Patterns)

### 1.1 Public Client (Read-Only/Simulation)
```typescript
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http('RPC_URL'),
  batch: { multicall: true } // Internal multicall aggregation
})
```

### 1.2 Wallet Client (Signing/Execution)
```typescript
import { createWalletClient, custom } from 'viem'

const walletClient = createWalletClient({
  account, // LocalAccount or JSON-RPC Account
  chain: mainnet,
  transport: custom(window.ethereum)
})
```

## 2. STRICT_RULES: Execution Hardening

- **RULE 01**: NEVER use `writeContract` directly. ALWAYS use the `simulateContract` -> `request` pattern to prevent gas waste on reverts.
- **RULE 02**: Use `encodePacked` ONLY for `keccak256` hashing. For contract calls, stick to `encodeFunctionData`.
- **RULE 03**: When handling errors, ALWAYS use `.walk()` to find the root `BaseError`.

## 3. High-Lethality Patterns

### 3.1 The Simulation-Write Flow
```typescript
// 1. Simulate to catch reverts and get request object
const { request, result } = await publicClient.simulateContract({
  address: '0x...',
  abi: [...],
  functionName: 'transfer',
  args: [recipient, amount],
  account
})

// 2. Execute using the validated request
const hash = await walletClient.writeContract(request)
```

### 3.2 Root Error Extraction
```typescript
try {
  // logic
} catch (err) {
  if (err instanceof BaseError) {
    const revertError = err.walk(e => e instanceof ContractFunctionRevertedError)
    if (revertError) {
      const errorData = revertError.data
      // Decode custom error data if ABI is available
    }
  }
}
```

### 3.3 Raw ABI Primitives (Low-Level)
| Utility | Use Case | Pattern |
| :--- | :--- | :--- |
| `encodeFunctionData` | Manual payload generation | `encodeFunctionData({ abi, functionName, args })` |
| `decodeFunctionResult` | Parsing raw RPC response | `decodeFunctionResult({ abi, functionName, data })` |
| `parseUnits` | Human to BigInt | `parseUnits('1.5', 18)` |
| `keccak256` | Hash generation | `keccak256(toHex('content'))` |

## 4. Mathematical Invariants
- `formatEther(1000000000000000000n) === '1'`
- `parseEther('1') === 1000000000000000000n`
- ABI Encoding is big-endian, 32-byte padded by default unless using `encodePacked`.

## 5. Legion Use Cases
- **MEV Bundles**: Use `encodeFunctionData` to build the transaction payload for Flashbots `eth_sendBundle`.
- **Arbitrage**: Simulate swaps using `simulateContract` to verify profitability before execution.
- **Gas Profiling**: Use `estimateGas` with `stateOverride` to test complex contract states.

- **Modular Actions**: Actions (e.g., `getBalance`, `sendTransaction`) are decoupled from clients, allowing for better tree-shaking and extensibility.
- **Client Composition**: Thin client instances built from a Transport, a Chain, and optional Account.
- **Transport Abstraction**: A unified interface for HTTP, WebSocket, IPC, and custom transports.
- **State-Free Utilities**: Robust utilities for RLP encoding, ABI parsing, and Hex manipulation.

## 🤝 Core Patterns to Copy

1. **The "Action" Pattern**:
   - Instead of `client.getBalance()`, it uses `getBalance(client, { address })`.
   - **Legion Application**: Sentinel logic should be implemented as modular actions that accept a `LegionClient`.

2. **Client Extension**:
   - `client.extend(publicActions)`: Dynamically adds methods to a client instance.
   - **Legion Application**: Use this to attach Sentinel-specific capabilities (e.g., `client.extend(scoutActions)`) to the core engine.

3. **Transport Resilience**:
   - Built-in retry logic and failover mechanisms in the transport layer.
   - **Legion Application**: Crucial for the **Dispatcher** to handle RPC latency and failures during high-value extractions.

## ✍️ Key Client Types

1. **Public Client**: Read-only access to the blockchain (logs, state, blocks).
   - *Legion Role*: Primary tool for the **Scout** sentinel.
2. **Wallet Client**: Capability to sign and send transactions.
   - *Legion Role*: Primary tool for the **Closer** sentinel.
3. **Test Client**: Low-level control for local development (anvil/hardhat).

## 🧬 Data Models & Utils

- **`Chain`**: Configuration object containing chain ID, name, RPC URLs, and block explorer info.
- **`Account`**: Abstraction for EOAs (Private Key, JSON-RPC, or Custom).
- **`ABI`**: JSON-based contract interface, used for type-safe interaction.
- **Encoding/Decoding**: 
  - `encodeFunctionData`: Prepare contract calls.
  - `decodeEventLog`: Parse transaction results.

## 📂 Key File References

- `src/clients/createClient.ts`: The factory for all Viem clients.
- `src/actions/public/getBalance.ts`: Example of a modular public action.
- `src/actions/wallet/sendTransaction.ts`: Example of a modular wallet action.
- `src/utils/abi/decodeEventLog.ts`: Core utility for telemetry extraction.

---
*Generated for Legion Engine Research*
