
# Uniswap V3 Logic-Map — Legion Engine Integration

Target Repository: `https://github.com/Uniswap/v3-core`, `https://github.com/Uniswap/v3-periphery`
Focus: Concentrated Liquidity, Tick-based Price Discovery, SwapRouter02, QuoterV2

## 1. Role in Legion Engine
* **Primary Sentinel**: Scout (price discovery) + Dispatcher (execution)
* **Function**: Highly efficient AMM with concentrated liquidity; allows Legion to strike with minimal slippage within specific price ranges.
* **Legion Use-Case**: Scout uses QuoterV2 to find optimal paths; Dispatcher executes via SwapRouter02; Ghost Lane uses `recipient` for stealth routing to Legion vaults.

## 2. Core Architecture
### 2.1 Contract Surface
* **Factory**: `0x1F98431c8aD98523631AE4a59f267346ea31F984` — Deploys pools.
* **SwapRouter02**: `0x68b3465833fb72A70ecdf485E0e4C7bD8665Fc45` — Preferred entry point for swaps.
* **QuoterV2**: `0x61fFE01691351bdC959b02013f84488bfa6A3393` — Returns exact output for a given input (Scout phase).

## 3. Key Data Models & ABIs
### 3.1 SwapRouter02 (`exactInputSingle`)
```solidity
struct ExactInputSingleParams {
    address tokenIn;
    address tokenOut;
    uint24 fee;
    address recipient;
    uint256 amountIn;
    uint256 amountOutMinimum;
    uint160 sqrtPriceLimitX96;
}

function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
```

### 3.2 QuoterV2 (`quoteExactInputSingle`)
```solidity
struct QuoteExactInputSingleParams {
    address tokenIn;
    address tokenOut;
    uint256 amountIn;
    uint24 fee;
    uint160 sqrtPriceLimitX96;
}

function quoteExactInputSingle(QuoteExactInputSingleParams memory params) 
    public 
    returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
```

## 4. Concentrated Liquidity Math
* **Price to Tick**: `P = 1.0001^tick`
* **Tick to SqrtPrice**: `sqrtPriceX96 = sqrt(1.0001^tick) * 2^96`
* **Legion Pattern**: Scout monitors `sqrtPriceX96` to detect if a trade will push the price out of the current active tick range (causing high slippage).

## 5. Legion Sentinel Matrix
| Sentinel | Uniswap V3 Usage |
|----------|------------------|
| **Scout** | `QuoterV2.quoteExactInputSingle` — discover best fee tier (0.01%, 0.05%, 0.3%, 1%). |
| **Gatekeeper** | Compare `amountOut` vs `amountOutMinimum`; verify `sqrtPriceLimitX96` safety. |
| **Closer** | Build `approve` tx for `SwapRouter02` address. |
| **Dispatcher** | `SwapRouter02.exactInputSingle` with `recipient` set to Legion vault. |
| **Ghost** | Manipulate `recipient` param to break the on-chain link. |

## 6. Use Cases
### 1. Range Strike (Scout-Dispatcher)
Scout identifies a liquidity gap in a Uniswap V3 pool. Dispatcher executes a large swap ensuring `sqrtPriceLimitX96` prevents the trade from slipping beyond the profitable range.

### 2. Multi-Hop Stealth (Ghost Lane)
Dispatcher uses `exactInput` with a path (e.g., USDC -> WETH -> DAI) and sets `recipient` to a fresh stealth address, obfuscating the source of funds for the final asset.
