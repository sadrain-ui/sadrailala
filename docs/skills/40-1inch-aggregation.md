# 40: 1inch Aggregation Skill

## STRICT_RULES
1. **Always `/quote` first** — never jump to `/swap` without Scout verification.
2. **Validate `protocols`** — If a route includes an unaudited/new DEX, Gatekeeper must flag.
3. **Ghost Routing** — Always use `destReceiver` when executing for high-net-worth accounts to break the on-chain link.
4. **Simulation Required** — Enable on-chain simulation via `disableEstimate: false` in the `/swap` call to ensure calldata validity.
5. **Approval Target** — Closer must build the approval transaction for the `AggregationRouterV5` address (`0x1111111254EEB25477B68fb85Ed929f73A960582`).

## MENTAL_MODEL
The 1inch Aggregator skill provides Legion with the best-price discovery across 400+ liquidity sources on 10+ EVM chains. It focuses on immediate settlement.
- **Scout**: Calls `/v5.2/{chainId}/quote` for optimal routing and price discovery.
- **Dispatcher**: Calls `/v5.2/{chainId}/swap` to generate calldata for execution.
- **Closer**: Calls `/v5.2/{chainId}/approve/transaction` to build approval transactions for the router.

## REAL_API
### Aggregation Router V5 (`0x1111111254EEB25477B68fb85Ed929f73A960582`)
```solidity
function swap(
    IAggregationExecutor executor,
    SwapDescription calldata desc,
    bytes calldata permit,
    bytes calldata data
) external payable returns (uint256 returnAmount, uint256 spentAmount);

struct SwapDescription {
    IERC20 srcToken;
    IERC20 dstToken;
    address payable srcReceiver;
    address payable dstReceiver; // Legion Vault / Ghost Lane
    uint256 amount;
    uint256 minReturnAmount;
    uint256 flags;
}
```

### API Integration (Scout & Dispatcher)
```typescript
const INCH_API = 'https://api.1inch.dev/swap/v5.2/1';

// Scout Discovery
async function getLegionRoute(from: Address, to: Address, amount: string) {
    const params = new URLSearchParams({
        src: from,
        dst: to,
        amount: amount,
        includeTokensInfo: 'true',
        includeProtocols: 'true',
        complexityLevel: '2' // Deep routing
    });
    const res = await fetch(`${INCH_API}/quote?${params}`);docs: add 1inch-aggregation.md skill
    return res.json();
}

// Dispatcher Stealth Swap
async function buildStealthSwap(params: SwapParams) {
    const res = await fetch(`${INCH_API}/swap?${new URLSearchParams({
        ...params,
        fromAddress: userAddress,
        destReceiver: LEGION_GHOST_VAULT, // Stealth destination
        slippage: '0.5',
        disableEstimate: 'false' // Simulation enabled
    })}`);
    return res.json();
}
```

## LEGION USE CASES
### 1. High-Precision Arbitrage (Scout-Dispatcher)
Scout monitors 1inch price vs raw DEX pools. If a gap > 0.5% exists, Dispatcher builds a `/swap` transaction ensuring `destReceiver` is the Legion vault to capture the profit atomically.

### 2. Stealth Extraction (Ghost Lane)
Ghost Sentinel uses the `destReceiver` parameter in the 1inch swap call to move assets directly to a stealth vault address, breaking the link between the maker and the final destination on-chain.
