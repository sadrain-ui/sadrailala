# Logic-Map: Ledger Hardware Interaction (HID Protocol)

**Target Repository**: `https://github.com/LedgerHQ/ledgerjs`
**Focus**: APDU communication, transport abstraction, and error state mapping.

## 1. Transport & Handshake (Immutable Patterns)

### 1.1 WebHID Transport (Preferred)
```typescript
import TransportWebHID from "@ledgerhq/hw-transport-webhid";
import AppEth from "@ledgerhq/hw-app-eth";

// MUST be called in response to a user gesture (click)
const transport = await TransportWebHID.create();
const ethApp = new AppEth(transport);
```

### 1.2 BIP-44 Derivation Path
Default Ethereum Path: `m/44'/60'/0'/0/0`
MetaMask/Legacy Path: `m/44'/60'/0'/n`

## 2. STRICT_RULES: Execution Hardening

- **RULE 01**: ALWAYS check for "Blind Signing" capability. If the user hasn't enabled "Blind Signing" in the device's Ethereum app settings, contract interactions will fail with `0x6a80`.
- **RULE 02**: Handle timeout states. Ledger devices disconnect after inactivity; implement a ping/keep-alive or clear error prompts for reconnection.
- **RULE 03**: Map hex error codes to human-readable instructions. Never show raw `0x6985` to the user.

## 3. High-Lethality Patterns

### 3.1 Error Code Mapping (APDU Standards)
| Code | Technical Meaning | Legion Action |
| :--- | :--- | :--- |
| **0x6985** | User Rejected Transaction | Revert locally; stop payload pump. |
| **0x6a80** | Invalid Data / Blind Signing Off | Prompt user: "Enable Blind Signing in Settings." |
| **0x6b0c** | Device Locked | Prompt user: "Unlock your Ledger." |
| **0x6d00** | App Not Open | Prompt user: "Open Ethereum App on device." |

### 3.2 EIP-712 Signing
```typescript
// Ledger requires structured data for clear-signing
const result = await ethApp.signEIP712Message(
  path,
  structuredData
);
```

## 4. Mathematical Invariants
- **BIP-32**: Hierarchical Deterministic wallet derivation logic.
- **secp256k1**: The elliptic curve used for all Ledger-signed Ethereum transactions.

## 5. Legion Use Cases
- **Cold Storage Closer**: Prepare transactions in Legion, then trigger Ledger for final signing of high-value MEV extractions.
- **Multi-Sig Guard**: Use Ledger as a required signer for the `legion-engine` admin vault.
- **Audit Logging**: Map APDU exchange logs to verify device-level integrity during execution.
