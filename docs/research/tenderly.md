# Tenderly Logic-Map — Legion Engine Integration

## 1. Role in Legion Engine
- **Primary Sentinel**: Shadow (simulation defense layer)
- **Function**: Transaction simulation, debugging, and monitoring platform; fork-based state simulation
- **Legion Use-Case**: Shadow sentinel calls Tenderly Simulation API before every Dispatcher broadcast; any revert = lane abort; Tenderly forks used for pre-production extraction testing

---

## 2. Core Architecture

### 2.1 Tenderly API Surfaces
```
Tenderly REST API
├── POST /simulate              → single tx simulation
├── POST /simulate-bundle       → multi-tx atomic simulation
├── POST /fork                  → create state fork
├── POST /fork/{id}/simulate    → simulate on fork (stateful)
└── GET  /transaction/{hash}    → decode/explain historical tx

Tenderly Viem Extension (tenderly/viem)
├── createTenderlyPublicClient()  → drop-in PublicClient with simulate
└── tenderly.simulate()           → wraps REST API calls
```

### 2.2 Shadow Sentinel Flow
```
Dispatcher prepares tx
  └── Shadow.simulate(tx)
        └── POST /simulate → Tenderly
              ├── success → Dispatcher.send(tx)
              └── revert  → abort lane, log revert reason
                              Gatekeeper records lethality event
```

---

## 3. Key Data Models

### 3.1 Simulation Request
```typescript
type TenderlySimRequest = {
  network_id: string       // chain ID as string '1', '137', etc.
  from: Address
  to: Address
  input: Hex               // calldata
  value?: string           // decimal string in wei
  gas?: number
  gas_price?: string
  save?: boolean           // save to Tenderly dashboard
  save_if_fails?: boolean  // save even if reverts (for debugging)
  simulation_type?: 'quick' | 'full' | 'abi'  // 'full' for traces
  state_objects?: Record<Address, StateOverride>  // override state
  block_number?: number    // simulate at historical block
}
```

### 3.2 Simulation Result
```typescript
type TenderlySimResult = {
  transaction: {
    hash: Hex
    status: boolean        // true = success, false = revert
    gas_used: number
    error_message?: string // revert reason
    error_info?: {
      address: Address
      error_code: string
    }
  }
  simulation: {
    id: string             // Tenderly simulation ID
    status: boolean
    decoded_input?: any[]  // ABI-decoded calldata
  }
  contracts?: ContractInfo[]
  generated_access_list?: AccessListEntry[]
  call_trace?: CallTrace   // full execution trace
}
```

### 3.3 State Override (for custom state simulation)
```typescript
type StateOverride = {
  balance?: string         // override ETH balance in hex wei
  nonce?: number
  storage?: Record<Hex, Hex>  // slot → value
  code?: Hex               // override contract bytecode
}
```

---

## 4. Critical Integration Patterns

### 4.1 Shadow Simulation (Core Pattern)
```typescript
const TENDERLY_API = `https://api.tenderly.co/api/v1/account/${TENDERLY_USER}/project/${TENDERLY_PROJECT}`

async function shadowSimulate(
  tx: { from: Address; to: Address; data: Hex; value?: bigint },
  chainId: number
): Promise<{ success: boolean; revertReason?: string; gasUsed: number }> {
  const res = await fetch(`${TENDERLY_API}/simulate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Access-Key': process.env.TENDERLY_ACCESS_KEY!
    },
    body: JSON.stringify({
      network_id: chainId.toString(),
      from: tx.from,
      to: tx.to,
      input: tx.data,
      value: tx.value?.toString() ?? '0',
      simulation_type: 'full',
      save_if_fails: true  // save reverts for debugging
    })
  })

  const { transaction } = (await res.json()).simulation
  
  return {
    success: transaction.status,
    revertReason: transaction.error_message,
    gasUsed: transaction.gas_used
  }
}
```

### 4.2 Multi-Tx Bundle Simulation
```typescript
async function shadowSimulateBundle(
  txs: Array<{ from: Address; to: Address; data: Hex; value?: bigint }>,
  chainId: number
): Promise<{ allSuccess: boolean; firstRevert?: string }> {
  const simulations = txs.map(tx => ({
    network_id: chainId.toString(),
    from: tx.from,
    to: tx.to,
    input: tx.data,
    value: tx.value?.toString() ?? '0',
    simulation_type: 'full'
  }))

  const res = await fetch(`${TENDERLY_API}/simulate-bundle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Access-Key': TENDERLY_KEY },
    body: JSON.stringify({ simulations })
  })

  const results = (await res.json()).simulation_results
  const firstFail = results.find((r: any) => !r.transaction.status)
  
  return {
    allSuccess: !firstFail,
    firstRevert: firstFail?.transaction.error_message
  }
}
```

### 4.3 Fork-Based State Testing
```typescript
// Create a fork at current block for stateful testing
async function createTenderlyFork(chainId: number): Promise<string> {
  const res = await fetch(`${TENDERLY_API}/fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Access-Key': TENDERLY_KEY },
    body: JSON.stringify({
      network_id: chainId.toString(),
      block_number: undefined  // latest
    })
  })
  const { simulation_fork } = await res.json()
  return simulation_fork.id  // fork ID
}

// Simulate on fork (state carries over between calls)
async function simulateOnFork(forkId: string, tx: SimRequest): Promise<SimResult> {
  const res = await fetch(`${TENDERLY_API}/fork/${forkId}/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Access-Key': TENDERLY_KEY },
    body: JSON.stringify(tx)
  })
  return (await res.json()).simulation
}
```

### 4.4 Viem PublicClient Integration
```typescript
import { createPublicClient, http } from 'viem'

// Tenderly as RPC provider — supports eth_call with state overrides
const tenderlyRpc = `https://rpc.tenderly.co/fork/${FORK_ID}`

const shadowClient = createPublicClient({
  chain: mainnet,
  transport: http(tenderlyRpc)
})

// eth_call on fork — no actual tx broadcast
const result = await shadowClient.call({
  to: contractAddress,
  data: calldata,
  account: fromAddress
})
```

---

## 5. Legion Sentinel Matrix

| Sentinel | Tenderly Usage |
|---|---|
| Shadow | `POST /simulate` before every Dispatcher tx; abort on revert |
| Shadow | `POST /simulate-bundle` for Flashbots bundles before `eth_sendBundle` |
| Gatekeeper | check `gas_used` from simulation vs profitability ceiling |
| Scout | fork simulation to test swap routes in isolated state |
| Dispatcher | only sends if Shadow simulation returns `success: true` |
| Mask | simulate with state override of `from` balance to test insufficient funds |

---

## 6. State Override Patterns

```typescript
// Simulate as if account has more ETH (test extraction without real funds)
const stateOverrides = {
  [userAddress]: {
    balance: '0x56BC75E2D63100000'  // 100 ETH in hex wei
  },
  [tokenAddress]: {
    storage: {
      // Override ERC-20 balance slot for userAddress
      [getBalanceSlot(userAddress)]: toHex(parseEther('1000'))
    }
  }
}

const simResult = await fetch(`${TENDERLY_API}/simulate`, {
  body: JSON.stringify({ ...txParams, state_objects: stateOverrides })
})
```

---

## 7. Key Patterns to Copy

1. Always use `simulation_type: 'full'` for traces + revert reasons; 'quick' skips traces
2. Set `save_if_fails: true` — failed simulations saved to Tenderly dashboard for debugging
3. Use `state_objects` to simulate with sufficient balance without real funds
4. Fork ID is reusable across multiple sequential simulations — state accumulates
5. `generated_access_list` from simulation can optimize gas by pre-declaring storage slots
6. Bundle simulation order matters — state from tx[0] feeds into tx[1] simulation
7. Tenderly RPC as Viem transport = eth_call with overrides — no API key in tx header

---

## 8. Supported Chains

```
Ethereum     ✅  Polygon     ✅  Optimism  ✅
Arbitrum     ✅  Avalanche   ✅  Base      ✅
BNB Chain    ✅  Gnosis      ✅  Fantom    ✅
Sepolia      ✅  Mumbai      ✅  (testnets)
```

---

## 9. Error Handling

```typescript
async function robustSimulate(tx: TxParams, chainId: number) {
  try {
    const result = await shadowSimulate(tx, chainId)
    
    if (!result.success) {
      // Parse common revert reasons
      if (result.revertReason?.includes('insufficient allowance')) {
        // Closer missed approval — re-run Closer sentinel
        throw new LegionError('APPROVAL_MISSING', result.revertReason)
      }
      if (result.revertReason?.includes('slippage')) {
        // Market moved — re-fetch Scout quote
        throw new LegionError('SLIPPAGE_EXCEEDED', result.revertReason)
      }
      throw new LegionError('SIMULATION_REVERT', result.revertReason ?? 'unknown')
    }
    
    return result
  } catch (err) {
    if (err instanceof LegionError) throw err
    // Tenderly API down — fallback to eth_call simulation
    return fallbackEthCall(tx, chainId)
  }
}

// Fallback: use Viem publicClient.call() when Tenderly is unavailable
async function fallbackEthCall(tx: TxParams, chainId: number) {
  const result = await publicClient.call({ to: tx.to, data: tx.data, account: tx.from })
  return { success: true, gasUsed: 0, result }
}
```
