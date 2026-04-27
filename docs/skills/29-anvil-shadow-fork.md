# SKILL-29: ANVIL SHADOW FORK — RISK-FREE STRIKE TESTING (foundry-rs/foundry Anvil)
## SOURCE: https://github.com/foundry-rs/foundry (Anvil component)
## CATEGORY: META — Engine Shield / Shadow Testing

## [STRICT_RULES]
- ALWAYS run new Legion strategies in shadow fork BEFORE touching live mainnet funds
- Shadow fork MUST use `--fork-block-number` pinned to a specific block — never floating latest
- `vm.store()` is the ONLY way to set token balances, oracle prices, contract state in fork
- NEVER use anvil `--unlocked` with real private keys — only use for impersonation tests
- After shadow test, RESET state with new fork — NEVER carry over mutated state to next test
- `cast rpc anvil_mine <N>` to advance blocks — use to simulate passage of time in fork
- Gas estimates from shadow fork MUST have 20% buffer added for live submission — fork is not exact
- `anvil_setNextBlockBaseFeePerGas` to simulate high/low gas conditions — test under stress
- Fork tests MUST include: normal case, high gas case, MEV competition case, revert case

## [MENTAL_MODEL]
- Shadow Fork = copy of mainnet state running locally — you can simulate ANY transaction against REAL protocol state without spending gas
- Anvil = Hardhat-compatible local EVM node by Foundry — 10x faster, more features
- Use case: "I want to test if my sandwich bundle profits at block 20,000,000 with ETH at $2500" — do it in shadow fork
- State manipulation: `vm.store()` sets arbitrary contract storage slots — override oracle prices, balances, admin keys
- Impersonation: `anvil_impersonateAccount` lets you send txs as ANY address (whale, protocol multisig)
- Block mining: `anvil_mine` skips N blocks instantly — test time-locked functions
- Shadow vs Live: Shadow fork is identical to mainnet EXCEPT your state changes don't propagate

## [REAL_API]
```bash
# === Start Anvil Shadow Fork ===
anvil \
  --fork-url $MAINNET_RPC \
  --fork-block-number 20000000 \
  --block-time 12 \
  --accounts 10 \
  --balance 10000 \
  --port 8545

# === Advanced: pin to specific block, override base fee ===
anvil \
  --fork-url $MAINNET_RPC \
  --fork-block-number 21500000 \
  --base-fee 50000000000          # 50 gwei base fee simulation

# === Cast commands against fork ===
# Impersonate a whale
cast rpc anvil_impersonateAccount 0xWhaleAddress

# Set ETH balance
cast rpc anvil_setBalance 0xMyAddress 0x56BC75E2D63100000  # 100 ETH in hex

# Override ERC20 balance (slot 0 is common)
cast rpc anvil_setStorageAt 0xTokenAddress 0x0 0x000...amount

# Mine N blocks instantly
cast rpc anvil_mine 10

# Set next block base fee
cast rpc anvil_setNextBlockBaseFeePerGas 0x2540BE400  # 10 gwei

# Set block timestamp
cast rpc anvil_setNextBlockTimestamp 1700000000

# Snapshot and revert state
cast rpc anvil_snapshot              # returns snapshotId
cast rpc anvil_revert <snapshotId>   # revert to snapshot
```

```typescript
// TypeScript: programmatic shadow fork test runner
import { createPublicClient, createWalletClient, http } from 'viem'
import { foundry } from 'viem/chains'

const forkClient = createPublicClient({
  chain: { ...foundry, id: 1 }, // fork mainnet chain ID
  transport: http('http://127.0.0.1:8545'),
})

async function runShadowTest(strategy: LegionStrategy) {
  // 1. Take snapshot
  const snapshotId = await forkClient.request({ method: 'anvil_snapshot', params: [] })
  
  try {
    // 2. Set up conditions
    await forkClient.request({
      method: 'anvil_setBalance',
      params: ['0xExecutorAddress', '0x56BC75E2D63100000'], // 100 ETH
    })
    
    // 3. Override oracle price (Chainlink ETH/USD at slot 0x101)
    await forkClient.request({
      method: 'anvil_setStorageAt',
      params: ['0xChainlinkFeed', '0x101', '0x000...priceHex'],
    })
    
    // 4. Execute strategy
    const result = await strategy.execute({ provider: forkClient })
    
    // 5. Verify outcomes
    console.log('Shadow profit:', result.profitWei)
    console.log('Gas used:', result.gasUsed)
    console.log('Slippage:', result.slippage)
    
    return result
  } finally {
    // 6. Always revert to clean state
    await forkClient.request({ method: 'anvil_revert', params: [snapshotId] })
  }
}

// Stress test: simulate MEV competition
async function stressTestWithCompetition(strategy: LegionStrategy) {
  for (const gasMultiplier of [1, 2, 5, 10]) {
    await forkClient.request({
      method: 'anvil_setNextBlockBaseFeePerGas',
      params: [`0x${(10n * 1_000_000_000n * BigInt(gasMultiplier)).toString(16)}`],
    })
    const result = await runShadowTest(strategy)
    console.log(`Gas ${gasMultiplier}x: profitable=${result.profit > 0n}`)
  }
}
```

## [LEGION USE CASES]
- Pre-launch safety check: run every new strategy in shadow fork at 10 different block heights
- Sandwich stress test: simulate competitor bundles ahead of yours — check if still profitable
- Oracle manipulation defense: `anvil_setStorageAt` on Chainlink feed — test Legion's slippage guards
- Gas spike simulation: `setNextBlockBaseFeePerGas` to 200 gwei — verify profitability threshold
- Protocol upgrade testing: fork at upgrade block, test Legion against new contract logic
- Incident replay: fork at exact block of past incident, replay to understand failure mode
- Competition simulation: impersonate known MEV bots, submit their txs first, see if Legion still wins
