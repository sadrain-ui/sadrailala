
# Logic-Map: MEV-Share (Private Execution & Stealth)

**Target Repository**: `https://github.com/flashbots/mev-share-client-ts`
**Focus**: Private Bundle Submission, Privacy Hints, and Mempool Stealth.

## 🏗️ Architecture Overview

MEV-Share allows users to submit transactions to a private mempool while sharing specific "hints" with searchers. For Legion Engine, this defines the **Dispatcher (Ghost)** sentinel's core execution logic.

- **`src/client.ts`**: The main interface for interacting with the MEV-Share Matchmaker.
- **`src/api/interfaces.ts`**: Defines the data models for bundles, hints, and inclusion logs.
- **`src/flashbots.ts`**: Internal logic for signing and relaying to Flashbots infrastructure.

## 🔍 Core Patterns to Copy

1. **Private Bundle Submission (Dispatcher/Ghost)**:
   - Instead of broadcasting to the public mempool, transactions are bundled and sent to a private RPC.
   - **Legion Application**: The **Dispatcher** sentinel uses this to ensure "Extraction Lanes" are executed without alerting front-runners or sandwich bots.

2. **Privacy Hints (Shadow)**:
   - Users can choose what data to reveal (e.g., only the logs, not the calldata).
   - **Legion Application**: The **Shadow** sentinel manages these hints as "Anonymity Policies" to balance execution speed with metadata privacy.

3. **Mempool Stealth (Mask)**:
   - Transactions are kept off-chain until the moment of inclusion.
   - **Legion Application**: This pattern is integrated into the **Mask** sentinel's account abstraction to hide the "Sovereign Sync" origins.

## 🛤️ Bundle Flow (Logic Map)

1. **Preparation**: `client.ts` creates a bundle from raw transactions.
2. **Hinting**: `IPrivacyHints` are applied to define visibility.
3. **Signing**: Bundle is signed with an auth key.
4. **Submission**: `sendBundle` sends the payload to the Matchmaker.
5. **Monitoring**: `getInclusion` polls for status using the bundle hash.

## 📂 Key File References

- `src/api/interfaces.ts`: Detailed types for `BundleParams` and `PrivacyHints`.
- `src/client.ts`: Implementation of `sendBundle` and `simulateBundle`.
- `src/examples/sendBundle.ts`: Practical blueprint for multi-transaction atomicity.
