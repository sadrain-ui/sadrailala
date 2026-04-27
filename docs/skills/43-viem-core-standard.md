# Viem Core EVM Standard Skill

Modular architecture, client abstraction, and type-safe ABI interaction using Viem for core Legion Engine operations.

## Core Rules

- **Modular Actions**: Prefer modular actions (e.g., `getBalance(client, { address })`) over client methods for better tree-shaking and extensibility.
- **Client Extension**: Use `client.extend()` to attach sentinel-specific capabilities (e.g., `client.extend(scoutActions)`) to the core engine.
- **Transport Resilience**: Implement built-in retry logic and failover mechanisms in the transport layer to handle RPC latency and failures.
- **Type Safety**: Always use type-safe ABI utilities (`encodeFunctionData`, `decodeEventLog`) for contract interactions.
- **Client Selection**: Use `PublicClient` for read-only Scout operations and `WalletClient` for Closer signing/broadcasting.

## Implementation Patterns

### 1. Modular Action Pattern
Sentinel logic should be implemented as modular actions that accept a `LegionClient`.
```typescript
import { getBalance } from 'viem';

// Sentinel logic implemented as a modular action
const balance = await getBalance(legionClient, { 
  address: legionAddress 
});
```

### 2. Dynamic Client Extension
Attach Scout or Closer specific capabilities to the core engine instance.
```typescript
const scoutClient = coreClient.extend(scoutActions);
// Dynamically adds methods to the client instance
```

### 3. Resilient Transport Configuration
Crucial for the Dispatcher to handle RPC latency during high-value extractions.
```typescript
const transport = http(rpcUrl, {
  retryCount: 3,
  retryDelay: 1000,
});
```

## Use Cases

1. **Scout**: Primary tool for read-only blockchain access (logs, state, blocks) via Public Client.
2. **Closer**: Primary tool for signing and sending transactions via Wallet Client.
3. **Telemetry**: Extraction of transaction results using `decodeEventLog` for monitoring.
