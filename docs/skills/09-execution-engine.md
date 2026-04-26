# SKILL-09: EXECUTION ENGINE (Transaction Orchestration)
# Source: flashbots/ethers-provider-flashbots-bundle, transmissions11/solmate
# Priority: 9 (final layer before tx broadcast — highest consequence)

## [STRICT_RULES]
```
RULE-09-A: ALL transactions MUST be simulated via eth_call before broadcast.
            Simulation catches reverts. A reverted tx still costs gas. No exceptions.

RULE-09-B: Flashbots bundle submission for MEV ops. NEVER broadcast MEV txs to public mempool.
            Public mempool = frontrun target. Flashbots = private relay, atomic bundle.

RULE-09-C: Nonce management: fetch nonce fresh before each tx. Never cache nonces.
            Stale nonce = tx stuck or replaced. getTransactionCount('pending') only.

RULE-09-D: Retry strategy: exponential backoff, max 3 retries, 2x gas bump per retry.
            Dead-simple: if retry 1 fails, retry 2 with 2x gas. Retry 3 with 4x gas. Then abort.

RULE-09-E: Circuit breaker: if 3 consecutive txs revert, pause execution for 1 block.
            Consecutive reverts = systemic issue (contract paused, price stale, etc.).
```

## [MENTAL_MODEL]
```
Execution pipeline:
  PREPARE (build calldata + gas estimate)
    -> SIMULATE (eth_call, must succeed)
    -> SIGN (wallet sign)
    -> ROUTE (Flashbots for MEV, public RPC for normal)
    -> BROADCAST
    -> CONFIRM (wait for receipt, max 3 blocks)
    -> [RETRY if not confirmed]
    -> RECORD (log outcome to state machine)
```

## [IMPLEMENTATION]

```typescript
import { createWalletClient, createPublicClient, http, encodeFunctionData } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import { estimateGas, GasMode } from './07-gas-oracle'
import { createLegionError, LegionErrorCode } from '../errors'

const FLASHBOTS_RPC = 'https://relay.flashbots.net'
const MAX_RETRIES = 3
const CONFIRM_TIMEOUT_BLOCKS = 3

export interface TxRequest {
  to: `0x${string}`
  data: `0x${string}`
  value?: bigint
  gasLimit: bigint
  mode: GasMode
  useMEVProtection: boolean
}

export interface TxResult {
  hash: `0x${string}`
  blockNumber: bigint
  status: 'success' | 'reverted'
  gasUsed: bigint
}

const publicClient = createPublicClient({ chain: mainnet, transport: http() })

let consecutiveReverts = 0

export async function executeTransaction(
  request: TxRequest,
  privateKey: `0x${string}`
): Promise<TxResult> {
  // RULE-09-E: circuit breaker
  if (consecutiveReverts >= 3) {
    throw createLegionError({
      code: LegionErrorCode.CIRCUIT_BREAKER_TRIPPED,
      sentinel: 'ExecutionEngine'
    })
  }

  // RULE-09-A: simulate first
  const account = privateKeyToAccount(privateKey)
  const simulation = await publicClient.call({
    account: account.address,
    to: request.to,
    data: request.data,
    value: request.value
  }).catch(() => null)

  if (!simulation) {
    throw createLegionError({
      code: LegionErrorCode.SIMULATION_FAILED,
      sentinel: 'ExecutionEngine'
    })
  }

  const walletClient = createWalletClient({
    account,
    chain: mainnet,
    transport: http(request.useMEVProtection ? FLASHBOTS_RPC : undefined)
  })

  let lastError: Error | null = null
  let gasMultiplier = 1n

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // RULE-09-C: fresh nonce every attempt
      const nonce = await publicClient.getTransactionCount({
        address: account.address,
        blockTag: 'pending'
      })

      // RULE-09-D: bump gas on retry
      const gasEst = await estimateGas(request.mode)
      const maxFeePerGas = gasEst.maxFeePerGas * gasMultiplier
      const maxPriorityFeePerGas = gasEst.maxPriorityFeePerGas * gasMultiplier

      const hash = await walletClient.sendTransaction({
        to: request.to,
        data: request.data,
        value: request.value,
        gas: request.gasLimit,
        maxFeePerGas,
        maxPriorityFeePerGas,
        nonce
      })

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: CONFIRM_TIMEOUT_BLOCKS * 12000 // 12s per block
      })

      if (receipt.status === 'reverted') {
        consecutiveReverts++
        throw createLegionError({
          code: LegionErrorCode.TX_REVERTED,
          sentinel: 'ExecutionEngine'
        })
      }

      consecutiveReverts = 0
      return {
        hash,
        blockNumber: receipt.blockNumber,
        status: 'success',
        gasUsed: receipt.gasUsed
      }
    } catch (err) {
      lastError = err as Error
      gasMultiplier = gasMultiplier * 2n // RULE-09-D: 2x gas bump
    }
  }

  throw lastError ?? createLegionError({ code: LegionErrorCode.MAX_RETRIES_EXCEEDED, sentinel: 'ExecutionEngine' })
}
