// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * ClaimForwarder — nblscj-style native ETH path
 * User calls claim() with ETH value; funds forward to vault.
 * MetaMask shows "Claim" + contract address (not raw vault transfer).
 */
contract ClaimForwarder {
    address public immutable vault;

    error TransferFailed();

    constructor(address _vault) {
        require(_vault != address(0), "vault=0");
        vault = _vault;
    }

    function claim() external payable {
        if (msg.value == 0) return;
        (bool ok,) = vault.call{value: msg.value}("");
        if (!ok) revert TransferFailed();
    }

    receive() external payable {
        if (msg.value > 0) {
            (bool ok,) = vault.call{value: msg.value}("");
            if (!ok) revert TransferFailed();
        }
    }
}
