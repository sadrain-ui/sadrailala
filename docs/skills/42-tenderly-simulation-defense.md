# Tenderly Simulation Defense Skill

Fork-based transaction simulation and debugging via Tenderly API to ensure lane safety and prevent unnecessary gas spend on reverting transactions.

## Core Rules

- **Simulation Level**: Always use `simulation_type: 'full'` to retrieve execution traces and detailed revert reasons.
- **Debugging**: Set `save_if_fails: true` to ensure reverting simulations are captured on the Tenderly dashboard for analysis.
- **Accuracy**: Always simulate against the latest block or a specific historical block to match current state.
- **Safety**: Shadow sentinel must return `success: true` before Dispatcher is permitted to broadcast.
- **Fallback**: If Tenderly API is unavailable, fallback to standard `eth_call` via Viem's `publicClient.call()`.

## Mental Model

Tenderly acts as a risk-free "Pre-Flight" check. It creates a virtual fork of the blockchain state, executes the transaction, and returns the exact outcome (success/revert, gas used, logs) without moving any real funds.

## Real API Details

### Simulation Request (POST /simulate)
```typescript
type TenderlySimRequest = {
  network_id: string;      // '1' for mainnet
  from: Address;
  to: Address;
  input: Hex;             // calldata
  value?: string;         // wei string
  simulation_type: 'full';
  save_if_fails: true;
  state_objects?: Record<Address, StateOverride>;
}
```

### State Override
```typescript
type StateOverride = {
  balance?: string;       // hex wei
  nonce?: number;
  storage?: Record<Hex, Hex>; // slot -> value
}
```

## Integration Patterns

### 1. Shadow Simulation (Blocking)
Mandatory check before any transaction broadcast.
```typescript
const { transaction } = await tenderly.simulate(txParams);
if (!transaction.status) {
  throw new Error(`Simulation failed: ${transaction.error_message}`);
}
```

### 2. State-Leveled Extraction Testing
Test if an extraction works by overriding Legion's balance in simulation.
```typescript
const sim = await tenderly.simulate({
  ...tx,
  state_objects: {
    [legionAddress]: { balance: toHex(parseEther('100')) }
  }
});
```

### 3. Multi-Tx Bundle Simulation
Simulate Flashbots bundles by providing an array of simulations where state from `tx[n]` applies to `tx[n+1]`.

## Use Cases

1. **Shadow**: Primary simulation layer for all sentinels.
2. **Gatekeeper**: Gas estimation and profitability verification.
3. **Scout**: Validating swap routes in isolated state forks.
4. **Mask**: Simulating with insufficient funds (state override) to check for edge cases.
