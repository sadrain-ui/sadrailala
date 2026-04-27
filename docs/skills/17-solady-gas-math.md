# SKILL-17: SOLADY GAS-OPTIMIZED MATH (SKILL Layer — Zero-Cost Assembly Ops)
# Source: github.com/Vectorized/solady (src/utils/ — README.md catalog)
# Scanned: Real contract catalog from Solady README — NOT generic
# Priority: SKILL-3 (all Solidity math in Legion contracts uses Solady)

## [STRICT_RULES]
```
RULE-17-A: ALWAYS use FixedPointMathLib for DeFi math. NEVER use plain Solidity arithmetic.
            FixedPointMathLib has WAD (1e18) and RAY (1e27) ops with no overflow.
            Source: solady/src/utils/FixedPointMathLib.sol

RULE-17-B: ALWAYS use SafeTransferLib for token transfers in Legion contracts.
            SafeTransferLib handles missing return values (USDT-style non-standard ERC20).
            Source: solady/src/utils/SafeTransferLib.sol

RULE-17-C: Use ECDSA from Solady — NOT OpenZeppelin ECDSA.
            Solady ECDSA: 40% less gas. Same security. Drop-in replacement.
            Source: solady/src/utils/ECDSA.sol

RULE-17-D: Use SignatureCheckerLib for ERC1271 (smart wallet) sig verification.
            EOA wallets use ECDSA. Smart wallets (Safe, etc.) use ERC1271. Handle both.
            Source: solady/src/utils/SignatureCheckerLib.sol

RULE-17-E: EfficientHashLib for any keccak256 operations inside hot paths.
            Assembly-optimized hashing. Use for MEV profit calc loops.
            Source: solady/src/utils/EfficientHashLib.sol
```

## [MENTAL_MODEL]
```
Solady replaces these common patterns with gas-optimized assembly:

  OpenZeppelin ECDSA.recover()     -> Solady ECDSA.recover()       [-40% gas]
  ERC20.transfer()                 -> SafeTransferLib.safeTransfer() [-15% gas + safety]
  mulDiv(a, b, c)                  -> FixedPointMathLib.mulDiv()   [-30% gas]
  keccak256(abi.encodePacked())    -> EfficientHashLib.hash()      [-20% gas]

For Legion: every basis point of gas saved = more profitable MEV extraction.
```

## [REAL API — from Solady README catalog]
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {FixedPointMathLib} from "solady/src/utils/FixedPointMathLib.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";
import {ECDSA} from "solady/src/utils/ECDSA.sol";
import {SignatureCheckerLib} from "solady/src/utils/SignatureCheckerLib.sol";

contract LegionVault {
  using FixedPointMathLib for uint256;

  // RULE-17-A: WAD math for DeFi calcs
  uint256 constant WAD = 1e18;

  function calcFee(uint256 amount, uint256 feeRate) internal pure returns (uint256) {
    // feeRate in WAD (e.g., 0.003e18 = 0.3%)
    return amount.mulWad(feeRate); // RULE-17-A
  }

  function calcProfitAfterGas(
    uint256 grossProfit,
    uint256 gasUsed,
    uint256 gasPrice
  ) internal pure returns (int256) {
    uint256 gasCost = gasUsed.mulWad(gasPrice);
    return int256(grossProfit) - int256(gasCost);
  }

  // RULE-17-B: safe token transfer
  function sweepToken(address token, address to, uint256 amount) external {
    SafeTransferLib.safeTransfer(token, to, amount); // handles USDT
  }

  // RULE-17-C: gas-efficient sig recovery
  function verifySig(
    bytes32 digest,
    bytes calldata sig
  ) internal pure returns (address signer) {
    return ECDSA.recover(digest, sig); // 40% cheaper than OZ
  }

  // RULE-17-D: smart wallet compatible
  function verifyAnySig(
    address signer,
    bytes32 digest,
    bytes calldata sig
  ) internal view returns (bool) {
    // Works for both EOA and ERC1271 smart wallets (Safe, etc.)
    return SignatureCheckerLib.isValidSignatureNow(signer, digest, sig);
  }
}
```

```typescript
// TypeScript: install Solady for Foundry
// foundry.toml: solady = { git = 'https://github.com/Vectorized/solady' }
// forge install Vectorized/solady

// Key Solady modules for Legion Solidity contracts:
const SOLADY_IMPORTS = {
  math: 'solady/src/utils/FixedPointMathLib.sol',
  transfer: 'solady/src/utils/SafeTransferLib.sol',
  ecdsa: 'solady/src/utils/ECDSA.sol',
  sigCheck: 'solady/src/utils/SignatureCheckerLib.sol',
  hash: 'solady/src/utils/EfficientHashLib.sol',
  bitmap: 'solady/src/utils/LibBit.sol'
}
```

## [LEGION USE CASES]
```
- Profit calc: FixedPointMathLib.mulWad(grossProfit, 0.997e18) [deduct 0.3% fee]
- Token sweeps: SafeTransferLib.safeTransferAll(token, treasury)
- Bundle sig auth: ECDSA.recover(bundleHash, authSig)
- Safe wallet compat: SignatureCheckerLib.isValidSignatureNow()
- MEV math hot paths: EfficientHashLib for opportunity hash trees
```
