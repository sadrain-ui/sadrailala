# SKILL-22: SOLMATE GAS-OPTIMIZED CONTRACTS (transmissions11/solmate)
## SOURCE: https://github.com/transmissions11/solmate
## CATEGORY: SKILL — Gas-Optimized Solidity Primitives

## [STRICT_RULES]
- ALWAYS use `SafeTransferLib` for ERC20 transfers — handles non-standard tokens (USDT, BNB) that don't return bool
- NEVER use solmate ERC20/ERC721 as-is for production — they omit safety checks for gas savings (e.g., no zero-address check)
- `FixedPointMathLib.mulWadDown` for 18-decimal math — NEVER use raw multiplication for WAD arithmetic
- `ReentrancyGuard` uses transient storage (EIP-1153) in newer versions — check Solidity version compatibility
- ERC4626 vault: `previewDeposit`, `previewMint`, `previewWithdraw`, `previewRedeem` MUST match actual amounts
- SSTORE2: write blob ONCE at deployment, pointer is immutable — NEVER try to overwrite
- CREATE3: deploys to deterministic address based on salt regardless of bytecode — use for cross-chain determinism
- `SignedWadMath` operates in signed 18-decimal fixed-point — `toWadUnsafe` skips overflow check

## [MENTAL_MODEL]
- Solmate = gas-optimized alternatives to OpenZeppelin — same interfaces, less safety (intentional)
- SafeTransferLib: uses low-level calls to handle non-compliant ERC20s (no return value)
- FixedPointMathLib: 18-decimal WAD math, also sqrt, rpow for DeFi calculations
- ERC4626: tokenized vault standard — shares represent proportional ownership of underlying assets
- SSTORE2: store large data as contract code (EXTCODECOPY) vs storage (SLOAD) —  3-10x cheaper for reads
- CREATE3: factory + proxy trick for bytecode-independent deterministic addresses

## [REAL_API]
```solidity
import {SafeTransferLib} from "solmate/utils/SafeTransferLib.sol";
import {FixedPointMathLib} from "solmate/utils/FixedPointMathLib.sol";
import {ERC20} from "solmate/tokens/ERC20.sol";
import {ERC4626} from "solmate/mixins/ERC4626.sol";
import {SSTORE2} from "solmate/utils/SSTORE2.sol";
import {CREATE3} from "solmate/utils/CREATE3.sol";
import {ReentrancyGuard} from "solmate/utils/ReentrancyGuard.sol";

// SafeTransferLib — handles non-standard ERC20s
SafeTransferLib.safeTransfer(ERC20(token), to, amount);
SafeTransferLib.safeTransferFrom(ERC20(token), from, to, amount);
SafeTransferLib.safeApprove(ERC20(token), spender, amount);
SafeTransferLib.safeTransferETH(to, amount);

// FixedPointMathLib — WAD (1e18) arithmetic
uint256 result = FixedPointMathLib.mulWadDown(a, b); // (a * b) / 1e18, rounds down
uint256 result = FixedPointMathLib.mulWadUp(a, b);   // rounds up
uint256 result = FixedPointMathLib.divWadDown(a, b); // (a * 1e18) / b
uint256 root = FixedPointMathLib.sqrt(x);            // integer square root
uint256 power = FixedPointMathLib.rpow(base, exp, scalar); // fixed-point exponentiation

// ERC20 — gas optimized (no zero-address checks!)
contract MyToken is ERC20 {
  constructor() ERC20("Token", "TKN", 18) {}
  function mint(address to, uint256 amount) external { _mint(to, amount); }
  function burn(address from, uint256 amount) external { _burn(from, amount); }
}

// ERC4626 vault
contract MyVault is ERC4626 {
  constructor(ERC20 asset) ERC4626(asset, "Vault", "vTKN") {}
  function totalAssets() public view override returns (uint256) {
    return asset.balanceOf(address(this));
  }
}
// vault.deposit(assets, receiver) → shares
// vault.withdraw(assets, receiver, owner) → shares burned
// vault.redeem(shares, receiver, owner) → assets returned

// SSTORE2 — store and read large blobs
address pointer = SSTORE2.write(abi.encode(largeArray));
bytes memory data = SSTORE2.read(pointer);

// CREATE3 — deterministic deployment (bytecode-agnostic)
bytes32 salt = keccak256("MyContract-v1");
address deployed = CREATE3.deploy(salt, creationCode, value);
address predicted = CREATE3.getDeployed(deployer, salt);
```

## [LEGION USE CASES]
- Token transfers: always use SafeTransferLib.safeTransfer for cross-token compatibility (USDT, USDC, WBTC)
- Profit calculations: use FixedPointMathLib.mulWadDown for fee/profit math to avoid overflow
- Vault strategy: implement ERC4626 vault for Legion LP position management
- Config storage: SSTORE2.write for storing large strategy config blobs (saves 90% vs mapping)
- Deterministic contracts: CREATE3 for deploying Legion modules at same address across all chains
- Reentrant protection: ReentrancyGuard on all Legion vault/withdrawal functions
