# SKILL-20: USEFUL SOLIDITY PATTERNS (dragonfly-xyz/useful-solidity-patterns)
## SOURCE: https://github.com/dragonfly-xyz/useful-solidity-patterns
## CATEGORY: SKILL — Smart Contract Engineering

## [STRICT_RULES]
- ALWAYS use Checks-Effects-Interactions order — state changes BEFORE external calls to prevent reentrancy
- NEVER use `transfer()` or `send()` for ETH — use low-level `call{value: amount}("")` and check return
- ALWAYS pack storage variables by size (bool/uint8/address in same slot) — saves 20k gas per extra SLOAD
- EIP712 messages MUST include domain separator with chainId — prevents cross-chain replay attacks
- SSTORE2 for big data: store bytes as contract bytecode (deploy) — read costs ~200 gas vs 2100 SLOAD
- Proxy contracts MUST use explicit storage buckets (EIP-1967 slots) — prevents slot collision with impl
- Bitmap nonces for permits: `usedNonces[nonce/256] |= 1 << (nonce%256)` — O(1) invalidation
- Flash loans MUST verify repayment in same tx — check `balanceAfter >= balanceBefore + fee`
- Merkle proofs: use `keccak256(abi.encodePacked(left, right))` with leaf = `keccak256(abi.encodePacked(data))`
- NEVER use `delegatecall` to untrusted contracts — caller's storage is at risk

## [MENTAL_MODEL]
- Storage packing: EVM reads 32-byte slots, pack variables to minimize SLOAD count
- Proxy pattern: delegatecall preserves msg.sender + storage, use for upgradeable contracts
- SSTORE2: write-once blob storage via CREATE opcode, read via EXTCODECOPY (cheap)
- EIP712: typed structured data signing — domain separator prevents cross-protocol replay
- Reentrancy guard: nonReentrant modifier sets flag before call, clears after
- Factory proofs: prove a contract was deployed by specific factory using CREATE2 address derivation
- Off-chain storage: store Merkle root onchain, verify individual items with proofs

## [REAL_API]
```solidity
// Storage Packing (saves gas)
struct PackedData {
  uint128 amount;   // slot 0
  uint64 timestamp; // slot 0
  uint32 nonce;     // slot 0
  bool active;      // slot 0
  address owner;    // slot 1 (20 bytes)
}

// Reentrancy Guard
uint256 private _reentrancyGuard;
modifier nonReentrant() {
  require(_reentrancyGuard == 1, "REENTRANCY");
  _reentrancyGuard = 2;
  _;
  _reentrancyGuard = 1;
}

// Safe ETH transfer
(bool ok, ) = recipient.call{value: amount}("");
require(ok, "ETH_TRANSFER_FAILED");

// EIP712 domain separator
bytes32 public immutable DOMAIN_SEPARATOR = keccak256(abi.encode(
  keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
  keccak256(bytes("MyProtocol")),
  keccak256(bytes("1")),
  block.chainid,
  address(this)
));

// Bitmap nonce invalidation
mapping(uint256 => uint256) public usedNonces;
function useNonce(uint256 nonce) internal {
  uint256 word = nonce / 256;
  uint256 bit = 1 << (nonce % 256);
  require(usedNonces[word] & bit == 0, "NONCE_USED");
  usedNonces[word] |= bit;
}

// SSTORE2 big data storage
import {SSTORE2} from "solady/utils/SSTORE2.sol";
address pointer = SSTORE2.write(abi.encode(bigData));
bytes memory data = SSTORE2.read(pointer);

// Explicit storage bucket (EIP-1967)
bytes32 constant IMPL_SLOT = keccak256("eip1967.proxy.implementation") - 1;
function _getImpl() internal view returns (address impl) {
  assembly { impl := sload(IMPL_SLOT) }
}

// Merkle proof verification
function verify(bytes32[] calldata proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
  bytes32 hash = leaf;
  for (uint256 i = 0; i < proof.length; i++) {
    hash = hash < proof[i]
      ? keccak256(abi.encodePacked(hash, proof[i]))
      : keccak256(abi.encodePacked(proof[i], hash));
  }
  return hash == root;
}

// Flash loan pattern
function flashLoan(address token, uint256 amount, address receiver) external {
  uint256 balBefore = IERC20(token).balanceOf(address(this));
  IERC20(token).transfer(receiver, amount);
  IFlashBorrower(receiver).onFlashLoan(token, amount);
  require(IERC20(token).balanceOf(address(this)) >= balBefore + fee, "NOT_REPAID");
}
```

## [LEGION USE CASES]
- Legion contract security: apply nonReentrant to all state-mutating external functions
- MEV profit storage: pack (profitWei, blockNum, nonce, executed) into single slot for gas efficiency
- Permit2 integration: use bitmap nonces for one-time transfer authorizations
- Merkle whitelist: store approved token list root onchain, verify per-token with proof
- Proxy upgrade path: use EIP-1967 slots for Legion module upgrades without storage collision
- Flash arb: use flash loan pattern to borrow, arbitrage, repay in single atomic tx
