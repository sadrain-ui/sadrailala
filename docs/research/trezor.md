# Logic-Map: Trezor Suite (Connect)

**Target Repository**: `https://github.com/trezor/trezor-suite` (packages/connect)
**Focus**: UI DNA, Handshake, Connection, Signer flow, safety checks.

## 🏛 Architecture Overview

Trezor Suite is a monorepo using **develop** as the primary branch. The core SDK logic is centralized in `packages/connect`, which follows a strict **Command Pattern** using the `AbstractMethod` class.

- **Monorepo Structure**: Logic is split across `connect`, `connect-web`, `connect-popup`, and `connect-ui`.
- **AbstractMethod Pattern**: Every API call (e.g., `ethereumSignTransaction`) is a class inheriting from `AbstractMethod`, encapsulating validation, UI orchestration, and device communication.
- **Transport**: Uses a multi-layered transport system (WebUSB, Bridge) abstracted behind a `Device` class.

## 🤝 Handshake & Connection Flow

1.  **Initialization**: `trezor-connect.js` (from `packages/connect-web`) creates a hidden `iframe` (served from `connect.trezor.io`).
2.  **Handshake**: The host app communicates with the iframe via `postMessage`. The iframe performs a handshake to verify origin and version.
3.  **Popup Initiation**: For any sensitive action, the iframe opens a `popup` window (`packages/connect-popup`).
4.  **Channel Creation**: A `WindowWindowChannel` is established between the host app and the popup to pass commands and receive user confirmation.

## ✍️ Signer Flow (EVM/Ethereum)

Implementation found in `packages/connect/src/api/ethereum/`.

- **`ethereumSignTransaction.ts`**:
    - **Validation**: Uses `paramsValidator` to ensure the TX payload is well-formed.
    - **UI Interaction**: Triggers `UI.REQUEST_CONFIRMATION` to show transaction details in the popup.
    - **Device Communication**: Sends `EthereumSignTx` Protobuf message to the hardware device.
    - **Safety Heuristics**: Includes checks for fee limits and "blind signing" warnings.

## 🧬 UI DNA & Patterns

- **UI Components**: Primarily found in `packages/connect-ui`. Uses a standardized typography and component set (`packages/theme`).
- **State Management**: Uses a centralized event bus (`packages/connect/src/events`) to notify the UI of device state changes (e.g., `DEVICE.CONNECT`, `UI.REQUEST_PIN`).
- **Patterns to Copy**:
    - **Method Context**: Passing a `MethodContext` through the `run` method to maintain state during multi-step signing.
    - **Message Channel Abstraction**: The way Trezor abstracts `postMessage` into a reliable request-response channel.

## 📂 Key File References

- `packages/connect/src/core/AbstractMethod.ts`: Base class for all logic.
- `packages/connect-web/src/popup/web.ts`: Popup transport and handshake.
- `packages/connect/src/api/ethereum/ethereumSignTransaction.ts`: EVM signing implementation.
- `packages/connect-common/src/data/connectSettings.ts`: Default configuration and safety settings.
- `packages/connect/src/device/Device.ts`: Hardware communication abstraction.

---
*Generated for Legion Engine Research*
