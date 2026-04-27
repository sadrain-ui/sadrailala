# 🛡️ Permit2 "God-Level" Logic-Map — Core Execution Hardening

Target Repository: `https://github.com/Uniswap/permit2`
Focus: Universal Approvals, Signature-based Transfers, Nonce Bitmaps.

## 1. EIP-712 Domain & TypeHashes

### 1.1 Domain Separator
Legion uses the universal Permit2 address: `0x000000000022d473030f116ddee9f6b43ac78ba3`.

```solidity
bytes32 public constant DOMAIN_SEPARATOR = keccak256(
    abi.encode(
        keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)"),
        keccak256("Permit2"),
        block.chainid,
        0x000000000022d473030f116ddee9f6b43ac78ba3
    )
);
```

### 1.2 Structural TypeHashes
| Type | Value (Hex / String) |
|------|----------------------|
| **PermitSingle** | `keccak256("PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)")` |
| **PermitBatch** | `keccak256("PermitBatch(PermitDetails[] details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)")` |
| **PermitDetails** | `keccak256("PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)")` |

## 2. Nonce Bitmap Logic (256-bit Unordered Nonces)

To prevent replay attacks while allowing parallel extraction, Permit2 uses a mapping: `mapping(address => mapping(uint256 => uint256)) public nonceBitmap`.

### 2.1 Math for Nonce Tracking
*   **Word Position**: `wordPos = nonce >> 8`
*   **Bit Position**: `bitPos = nonce & 0xff`
*   **Check if Used**: `(bitmap[wordPos] >> bitPos) & 1 == 1`
*   **Update (Mark Used)**: `nonceBitmap[owner][wordPos] |= (1 << bitPos)`

*Legion Strategy*: The **Dispatcher** maintain a local state of `wordPos` to select a `bitPos` with a zero bit for the next extraction lane to ensure zero revert risk due to nonce collisions.

## 3. Real API Signatures (Closer Sentinel)

### 3.1 `permit` (Single)
```solidity
struct PermitSingle {
    PermitDetails details;
    address spender;
    uint256 sigDeadline;
}
function permit(address owner, PermitSingle calldata permitSingle, bytes calldata signature) external;
```

### 3.2 `transferFrom` (Execution)
```solidity
function transferFrom(address from, address to, uint160 amount, address token) external;
function batchTransferFrom(AllowanceTransfer.AllowanceBatchTransfer[] calldata batch) external;
```

## 4. STRICT_RULES
1. **Nonce Bitmap Integrity**: Never reuse a nonce. Calculate `wordPos` and `bitPos` locally before signing.
2. **Infinite Approval**: ALWAYS approve `type(uint256).max` to the Permit2 contract once, then manage granular permissions via EIP-712.
3. **Expiration Hardening**: Set `expiration` to `block.timestamp + 300` (5 mins) for JIT extractions to minimize "Toxic Signature" exposure.
4. **DOMAIN_SEPARATOR Re-calc**: Re-calculate domain separator if `chainId` changes (cross-chain extraction).
