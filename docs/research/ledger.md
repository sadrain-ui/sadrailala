# Logic-Map: Ledger Live (Monorepo)

**Target Repository**: `https://github.com/LedgerHQ/ledger-live`
**Focus**: UI DNA, Handshake, Connection, Signer flow, safety checks.

## 🏛 Architecture Overview

Ledger Live is a massive monorepo using **develop** as the primary branch. It separates concerns between chain-agnostic transport, chain-specific logic (coin-modules), and UI components.

- **Monorepo Structure**: 
    - `libs/ledgerjs`: Low-level hardware communication (APDU).
    - `libs/coin-modules`: Chain-specific business logic (e.g., `coin-evm`).
    - `libs/ui`: Shared React components and design system.
    - `apps/ledger-live-desktop`: Electron-based implementation.
- **Transport Abstraction**: Uses `@ledgerhq/hw-transport` to support WebHID, WebUSB, and Bluetooth through a unified interface.

## 🤝 Handshake & Connection Flow

1.  **Transport Selection**: The application requests a transport (e.g., `TransportWebHID.create()`).
2.  **Device Discovery**: The transport layer listens for connected devices.
3.  **App Opening**: Ledger requires the specific app (e.g., "Ethereum") to be open on the device. The handshake involves sending a "Get App Info" APDU command.
4.  **Session Establishment**: Once the correct app is detected, a communication session is established via the transport instance.

## ✍️ Signer Flow (EVM/Ethereum)

Implementation found in `libs/ledgerjs/packages/hw-app-eth/src/Eth.ts`.

- **`Eth.ts` (signTransaction)**:
    - **Payload Preparation**: Converts the transaction object into a RLP-encoded byte string.
    - **Chunking**: Large transactions are split into multiple APDU packets using `safeChunkTransaction`.
    - **APDU Exchange**: Sends the `0xE0` (CLA) commands to the device for signature.
    - **Metadata Resolution**: Uses "External Resolution" (`libs/ledger-live-common/src/families/evm/bridge/js.ts`) to fetch token names and decimals so the user can verify them on the device screen.

## 🧬 UI DNA & Patterns

- **UI Components**: Found in `libs/ui`. Follows a strict design language with high-contrast typography and specific "Device Action" components.
- **Device Action Pattern**: A standardized React component flow that guides the user through:
    1.  Connect device
    2.  Open app
    3.  Confirm transaction on device
- **Patterns to Copy**:
    - **APDU Abstraction**: The way Ledger wraps complex hardware commands into simple async functions (`getAddress`, `signTransaction`).
    - **Bridge Pattern**: Decoupling the UI from the execution logic using a "Bridge" interface, allowing the same logic to run on Desktop, Mobile, or Web.

## 📂 Key File References

- `libs/ledgerjs/packages/hw-app-eth/src/Eth.ts`: Main EVM signing logic.
- `libs/coin-modules/coin-evm/src/signOperation.ts`: High-level operation flow for EVM.
- `libs/ui/src/components/DeviceAction`: Central UI flow orchestrator.
- `libs/ledgerjs/packages/hw-transport/src/Transport.ts`: Base transport interface.

---
*Generated for Legion Engine Research*
