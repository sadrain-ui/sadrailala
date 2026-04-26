# Logic-Map: Viem (Core EVM Standard)

**Target Repository**: `https://github.com/wevm/viem`
**Focus**: Modular Architecture, Client Abstraction, Type-Safe ABI, and Efficient Encoding.

## 🏛 Architecture Overview

Viem is the primary EVM standard for Legion Engine. Its modular design allows for a lightweight core with extensible functionalities.

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
