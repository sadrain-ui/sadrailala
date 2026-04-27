# SKILL-23: FOUNDRY TESTING & DEPLOYMENT (foundry-rs/foundry)
## SOURCE: https://github.com/foundry-rs/foundry
## CATEGORY: META — Development Toolchain

## [STRICT_RULES]
- `forge test` runs ONLY functions prefixed with `test` — helper functions MUST NOT start with `test`
- Use `vm.prank(address)` for NEXT call only — for multiple calls use `vm.startPrank/stopPrank`
- `vm.deal(addr, amount)` sets ETH balance — use `deal(token, addr, amount)` (StdUtils) for ERC20
- NEVER use `block.timestamp` directly in tests — use `vm.warp(timestamp)` to control time
- Fork tests: `vm.createFork(rpcUrl)` + `vm.selectFork(forkId)` — state is isolated per fork
- `vm.expectRevert(bytes4(selector))` MUST be placed immediately before the reverting call
- `vm.expectEmit(true,true,false,true)` checks: topic1, topic2, topic3, data — must emit correct event after
- Fuzzing: prefix with `testFuzz_` — foundry generates 256 random inputs by default
- `forge script` with `--broadcast` deploys live — ALWAYS test with `--dry-run` first
- Gas snapshots: `forge snapshot` creates `.gas-snapshot` — commit and diff to catch regressions

## [MENTAL_MODEL]
- Forge = Rust-based test runner, faster than Hardhat (10-100x)
- Cheatcodes (vm.*) = Foundry's test superpower — manipulate EVM state directly in tests
- Anvil = local fork node — fork mainnet state for integration tests
- Cast = CLI for EVM interaction (call, send, decode, abi-encode)
- StdCheats/StdAssertions — helpers in Test.sol for common patterns
- Invariant testing: `invariant_*` functions run against stateful fuzzer (multiple tx sequences)

## [REAL_API]
```solidity
// Standard test file
contract LegionTest is Test {
  // Cheatcodes
  function test_BasicPrank() public {
    vm.prank(address(0xDEAD));  // next call is from 0xDEAD
    target.doSomething();
  }
  
  function test_ForkAndWarp() public {
    uint256 forkId = vm.createFork("https://eth.merkle.io");
    vm.selectFork(forkId);
    vm.warp(block.timestamp + 1 days);
    vm.roll(block.number + 100);
  }
  
  function test_ExpectRevert() public {
    vm.expectRevert(MyContract.Unauthorized.selector);
    target.restrictedFunction();
  }
  
  function test_ExpectEmit() public {
    vm.expectEmit(true, true, false, true);
    emit Transfer(from, to, amount);
    token.transfer(to, amount);
  }
  
  function testFuzz_Deposit(uint256 amount) public {
    amount = bound(amount, 1, 1e24); // clamp to valid range
    vault.deposit(amount);
    assertEq(vault.balance(), amount);
  }
  
  // ERC20 deal
  function test_DealTokens() public {
    deal(address(USDC), user, 1000e6);
    assertEq(USDC.balanceOf(user), 1000e6);
  }
  
  // Storage manipulation
  function test_StorageSlot() public {
    vm.store(contractAddr, bytes32(uint256(0)), bytes32(uint256(999)));
    assertEq(uint256(vm.load(contractAddr, bytes32(0))), 999);
  }
}

// Deployment script
contract DeployLegion is Script {
  function run() external {
    uint256 deployerKey = vm.envUint("PRIVATE_KEY");
    vm.startBroadcast(deployerKey);
    LegionCore core = new LegionCore();
    console.log("Deployed at:", address(core));
    vm.stopBroadcast();
  }
}
```

```bash
# CLI commands
forge build                          # compile
forge test -vvvv                     # run tests, verbose
forge test --match-test testFork     # run specific test
forge test --fork-url $ETH_RPC       # fork mode
forge snapshot                       # gas snapshot
forge script script/Deploy.s.sol --rpc-url $RPC --broadcast
cast call $CONTRACT "balanceOf(address)" $ADDRESS --rpc-url $RPC
cast send $CONTRACT "mint(address,uint256)" $TO $AMT --private-key $PK
cast abi-encode "transfer(address,uint256)" $TO $AMT
cast storage $CONTRACT 0            # read slot 0
anvil --fork-url $ETH_RPC --fork-block-number 20000000
```

## [LEGION USE CASES]
- Fork testing: `vm.createFork(mainnetRpc)` to test Legion strategies against live mainnet state
- Price manipulation tests: `vm.store` to override oracle slots and test slippage guards
- Gas benchmarking: `forge snapshot` on critical Legion paths (bundle submission, revert guards)
- Fuzz MEV paths: `testFuzz_profitExtraction(uint256 amount)` with `bound()` for realistic ranges
- Integration: deploy Legion stack with `forge script` + broadcast for atomic multi-contract deploy
