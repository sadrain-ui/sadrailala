# Logic-Map: Permit2 (Advanced Approvals)

**Target Repository**: `https://github.com/Uniswap/permit2`
**Focus**: Time-bound Approvals, Signature-based Transfers, and Batching.

## 🏛 Architecture Overview

Permit2 is a next-generation approval mechanism that introduces "universal approvals" and time-limited permissions. For Legion Engine, it serves as the core of the **Closer** sentinel's consent logic.

- **`AllowanceTransfer`**: Handles time-bound budgets and recurring extraction permissions.
- **`SignatureTransfer`**: Handles single-use, signature-based asset movements (Permit-style).
- **EIP-712 Integration**: Uses structured data signing to ensure users know exactly what they are approving.

## 🤝 Core Patterns to Copy

1. **Extraction Budgets (AllowanceTransfer)**:
   - Users grant a "budget" to the Legion contract for a specific token and timeframe (e.g., 5000 USDC for 30 days).
   - **Legion Application**: Enables the **Dispatcher** to perform autonomous "Extraction Lanes" without requiring a signature for every small move.

2. **One-Tap Execution (SignatureTransfer)**:
   - A single EIP-712 signature authorizes a transfer to a specific destination with a precise expiration.
   - **Legion Application**: The **Closer** sentinel uses this for high-value "Sovereign Syncs" where trust is minimized.

3. **Master Approval Pattern**:
   - The user approves the Permit2 contract once. All subsequent permissions are granted via off-chain signatures.
   - **Legion Application**: Dramatically improves UX for the **Mask** sentinel while maintaining the security of the **Gatekeeper**.

## ✍️ Key Flows

1. **Approval**: User calls `erc20.approve(permit2, infinity)`.
2. **Consent**: User signs an EIP-712 message containing `token`, `amount`, `expiration`, and `nonce`.
3. **Execution**: Legion's **Dispatcher** submits the signature to the Permit2 contract to move assets.
4. **Validation**: Permit2 verifies the signature, checks for expiration, and ensures the nonce hasn't been used.

## 🧬 Data Models

- **`PermitSingle`**: Individual token approval.
  - `details`: (token, amount, expiration, nonce)
  - `spender`: The Legion engine address.
  - `sigDeadline`: When the signature itself expires.
- **`PermitBatch`**: Authorizing multiple token extractions in one signature.
- **`Allowance`**: On-chain storage of current budget and expiration.

## 📂 Key File References

- `src/AllowanceTransfer.sol`: Logic for recurring budgets.
- `src/SignatureTransfer.sol`: Logic for one-time signatures.
- `src/interfaces/IPermit2.sol`: The master interface for integration.
- `src/libraries/PermitHash.sol`: Pattern for EIP-712 hash calculation.

---
*Generated for Legion Engine Research*
