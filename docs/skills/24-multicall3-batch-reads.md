# SKILL-24: MULTICALL3 BATCH READS (mds1/multicall3)
## SOURCE: https://github.com/mds1/multicall3
## CATEGORY: DNA — Onchain Data Aggregation

## [STRICT_RULES]
- ALWAYS use Multicall3 at `0xcA11bde05977b3631167028862bE2a173976CA11` — deployed on 250+ chains
- `aggregate3` is preferred over `aggregate` — allows per-call failure (allowFailure flag)
- NEVER use `aggregate` (v1) for reads that might fail — one failure reverts entire batch
- `allowFailure: true` MUST be set when reading from contracts that might not exist on all chains
- Decode return data with exact ABI — mismatched decode causes silent garbage values, not reverts
- Block number in batch: include `getBlockNumber()` as first call to timestamp the batch atomically
- NEVER use multicall for writes (state-changing calls) — only reads via `eth_call`
- ethers v5: use `Multicall3__factory.connect(address, provider)` from typechain
- viem: use `multicall()` action which wraps multicall3 automatically

## [MENTAL_MODEL]
- Multicall3 = single eth_call that fans out to N contract calls and returns all results
- Reduces RPC round trips from N to 1 — critical for latency-sensitive MEV bots
- `Call3` struct: `{target, allowFailure, callData}` — result: `{success, returnData}`
- Atomic snapshot: all calls execute at same block height — consistent state
- Gas limit: aggregate3 has no inherent gas limit per call, but block gas limit applies

## [REAL_API]
```typescript
import { ethers } from 'ethers'

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'

// ABI (minimal)
const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)',
  'function getBlockNumber() view returns (uint256)',
  'function getEthBalance(address addr) view returns (uint256)',
]

// Batch read multiple token balances
async function batchBalances(tokens: string[], user: string, provider: ethers.Provider) {
  const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI, provider)
  const iface = new ethers.Interface(['function balanceOf(address) view returns (uint256)'])
  
  const calls = tokens.map(token => ({
    target: token,
    allowFailure: true,
    callData: iface.encodeFunctionData('balanceOf', [user]),
  }))
  
  const results = await mc.aggregate3(calls)
  
  return results.map((result: any, i: number) => ({
    token: tokens[i],
    balance: result.success
      ? iface.decodeFunctionResult('balanceOf', result.returnData)[0]
      : 0n,
  }))
}

// With block number for atomic snapshot
async function batchWithBlock(calls: any[], provider: ethers.Provider) {
  const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI, provider)
  const blockCall = {
    target: MULTICALL3,
    allowFailure: false,
    callData: mc.interface.encodeFunctionData('getBlockNumber'),
  }
  const results = await mc.aggregate3([blockCall, ...calls])
  const blockNum = mc.interface.decodeFunctionResult('getBlockNumber', results[0].returnData)[0]
  return { blockNum, results: results.slice(1) }
}

// viem pattern
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

const client = createPublicClient({ chain: mainnet, transport: http() })
const results = await client.multicall({
  contracts: tokens.map(token => ({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user],
  })),
  allowFailure: true,
})
// results[i].status === 'success' | 'failure'
// results[i].result
```

## [LEGION USE CASES]
- Pool state batch: fetch reserves/prices from 100+ pools in ONE rpc call — reduces latency by 99%
- Position scanner: batch `balanceOf(user)` across all whitelisted tokens for portfolio snapshot
- Mempool pre-check: batch read state before submitting bundle (nonce, balance, approvals)
- Block-atomic: include getBlockNumber() as first call — ensures all data is from same block
- Arbitrage opportunity check: batch price reads across DEXes to find profitable spreads instantly
