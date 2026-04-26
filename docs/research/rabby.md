# Logic-Map: Rabby (Advanced Telemetry & Simulation)

**Target Repository**: `https://github.com/RabbyHub/Rabby`
**Focus**: Unified Asset Telemetry, Pre-execution Simulation, and Risk Scoring.

## 🏗️ Architecture Overview

Rabby's core strength lies in its ability to aggregate data from multiple chains and simulate transactions before they are signed. For Legion Engine, this defines the **Scout** (Discovery) and **Shadow** (Simulation) sentinels.

- **`src/background/service/openapi.ts`**: The unified gateway for fetching balance, token, and protocol data.
- **`src/background/service/preference.ts`**: Manages user-specific chain and RPC configurations.
- **`src/background/service/keyring/index.ts`**: Orchestrates signing across different account types (HD, Ledger, etc.).

## 🔍 Core Patterns to Copy

1. **Unified Asset Telemetry (Scout)**:
   - Rabby doesn't just check ETH balance; it queries a proprietary OpenAPI to get a full portfolio view.
   - **Legion Application**: The **Scout** sentinel should implement a similar "Universal Sync" that maps external protocol DNA to internal asset models.

2. **Pre-execution Simulation (Shadow)**:
   - Before a signature is requested, Rabby runs the transaction against a simulation node.
   - **Legion Application**: The **Shadow** sentinel uses this to verify that an "Extraction Lane" will result in the expected asset movement without being front-run or failing.

3. **Risk Scoring / Security Engine (Gatekeeper)**:
   - Rabby checks for common attack patterns (e.g., approval to a known scammer).
   - **Legion Application**: The **Gatekeeper** sentinel implements these heuristics as "Lethality Guards" to prevent accidental loss during automated extraction.

## 🛤️ Transaction Flow (Logic Map)

1. **Initiation**: `controller/transaction.ts` receives a request.
2. **Enrichment**: `service/openapi.ts` fetches metadata (gas, token info).
3. **Simulation**: Transaction is sent to a simulation endpoint to check for state changes.
4. **Validation**: `service/securityEngine` (Internal) runs risk checks.
5. **Approval**: UI displays the "Risk & Simulation" view to the user.
6. **Execution**: If approved, `service/keyring` signs and `service/transaction` broadcasts.

## 📂 Key File References

- `src/background/service/openapi.ts`: API integration for multi-chain data.
- `src/background/service/transaction/history.ts`: Pattern for tracking cross-chain execution state.
- `src/ui/component/ProxyWallet/Simulation.tsx`: UI DNA for displaying "Before/After" asset states.
