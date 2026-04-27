# 45: 1inch Limit Order Protocol Skill

## STRICT_RULES
1. **Always use `receiver` in `Order` struct** — set this to the Legion Vault address to ensure funds are moved atomically to a secure location.
2. **Validate `MakerTraits`** — never construct `MakerTraits` from scratch; use the bitmap flags (Bits 255, 254, 252, 251, 250) to configure order behavior (e.g., `NO_PARTIAL_FILLS`).
3. **EIP-712 Signing Required** — orders must be signed via `_signTypedData` using the 1inch Domain and `Order` type hash.
4. **Monitor Epoch Manager** — if Bit 250 is set, Gatekeeper must verify the maker's current epoch to prevent filling canceled orders.

## MENTAL_MODEL
The 1inch Limit Order Protocol (LOP) allows for conditional settlement. Unlike the Aggregator, LOP orders are signed off-chain and filled on-chain by resolvers.
* **Scout**: Monitors orderbook APIs for fillable orders.
* **Closer**: Builds `Permit2` or `approve` transactions for the maker asset.
* **Dispatcher**: Calls `fillOrder` on the `LimitOrderProtocolV3` contract.

## REAL_API
### LimitOrderProtocolV3 (`0x111111125421cA6dc452d289314280a0f8842A65`)
```solidity
struct Order {
    uint256 salt;
    address maker;
    address receiver;
    address makerAsset;
    address takerAsset;
    uint256 makingAmount;
    uint256 takingAmount;
    uint256 makerTraits; // BITMAP
}

function fillOrder(
    Order memory order,
    bytes calldata signature,
    bytes calldata interactionData,
    uint256 makingAmount,
    uint256 takingAmount,
    uint256 skipPermitAndThresholdAmount
) external payable returns (uint256, uint256);
```

### 🧬 MakerTraits Bitmap Flags
* **Bit 255**: `NO_PARTIAL_FILLS_FLAG`
* **Bit 254**: `ALLOW_MULTIPLE_FILLS_FLAG`
* **Bit 252**: `PRE_INTERACTION_CALL_FLAG`
* **Bit 251**: `POST_INTERACTION_CALL_FLAG`
* **Bit 250**: `NEED_CHECK_EPOCH_MANAGER_FLAG`

## LEGION USE CASES
### 1. Gasless Limit Extraction
Legion signs an order with a high `makingAmount` and sets `Bit 247` (Unwrap WETH). A resolver fills the order, paying the gas, while Legion receives the native ETH directly in the vault.

### 2. Multi-Agent Settlement
Shadow sentinel monitors the `interactionData` in a 1inch order to ensure that any custom predicates (e.g., price conditions) are met before Dispatcher commits funds for the fill.
