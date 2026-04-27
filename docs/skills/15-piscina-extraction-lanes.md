# SKILL-15: PISCINA EXTRACTION LANES (SKILL Layer — 100+ Parallel Workers)
# Source: github.com/piscinajs/piscina (README.md — API reference)
# Scanned: Real constructor options from Piscina docs — NOT generic
# Priority: SKILL-1 (every vacuum lane = 1 Piscina worker thread)

## [STRICT_RULES]
```
RULE-15-A: maxThreads = CPU_COUNT * 2 for I/O-bound extraction lanes.
            Piscina default = os.availableParallelism() * 1.5. For Legion: set explicitly.
            Source: Piscina constructor option: maxThreads (number)

RULE-15-B: maxQueue = 'auto' for burst-handling. Never set to a fixed small number.
            'auto' = maxThreads^2. Prevents queue overflow during block-event spikes.
            Source: Piscina constructor option: maxQueue ('auto' | number)

RULE-15-C: concurrentTasksPerWorker = 1 for CPU-heavy EVM math. = 4 for I/O ops.
            CPU tasks block. I/O tasks await. Set per task type, not globally.
            Source: Piscina constructor option: concurrentTasksPerWorker (number)

RULE-15-D: Monitor pool.queueSize BEFORE submitting new tasks.
            queueSize >= maxQueue = new task throws QueuedError. Check first or catch.
            Source: Piscina.queueSize (readonly number)

RULE-15-E: Use workerData for static config (chain RPC, contract addresses).
            workerData is cloned once at init. NEVER pass large state via task args.
            Source: Piscina constructor option: workerData (any cloneable value)
```

## [MENTAL_MODEL]
```
Legion Extraction Lane architecture with Piscina:

  Main Thread
    |
  BlockWatcher emits block event
    |
  OpportunityDetector finds N opportunities
    |
  for each op: pool.run(extractionTask, op) -> Worker Thread
    |
  Worker Thread (isolated):
    - Reads chain state (RPC call)
    - Calculates profit (EVM math)
    - Builds tx calldata
    - Returns { tx, profit, gasEstimate }
    |
  Main Thread: collect results, rank by profit, submit top-K bundles

Max parallelism: 100+ simultaneous extraction lanes (limited by RPC rate limits)
```

## [REAL API — from Piscina README source scan]
```typescript
import Piscina from 'piscina'
import { resolve } from 'path'

// RULE-15-A, 15-B, 15-C, 15-E: proper pool config for Legion
const extractionPool = new Piscina({
  filename: resolve(__dirname, 'workers/extraction-worker.js'),
  maxThreads: Math.max(4, require('os').availableParallelism() * 2), // RULE-15-A
  minThreads: 4, // keep 4 threads warm always
  maxQueue: 'auto', // RULE-15-B: auto = maxThreads^2
  concurrentTasksPerWorker: 1, // RULE-15-C: EVM math = CPU bound
  workerData: { // RULE-15-E: static config
    rpcUrl: process.env.ETH_RPC_URL,
    chainId: 1,
    contractAddresses: {
      uniswapV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984'
    }
  }
})

// RULE-15-D: check queue before submitting
async function submitExtractionTask(
  opportunity: OpportunityData
): Promise<ExtractionResult | null> {
  if (extractionPool.queueSize >= (extractionPool.options.maxQueue as number)) {
    console.warn('Pool queue full — dropping opportunity')
    return null
  }
  return extractionPool.run(opportunity)
}

// Batch submit with queue pressure check
async function submitBatch(
  opportunities: OpportunityData[]
): Promise<ExtractionResult[]> {
  const tasks = opportunities.map(op => submitExtractionTask(op))
  const results = await Promise.allSettled(tasks)
  return results
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => (r as PromiseFulfilledResult<ExtractionResult>).value)
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  await extractionPool.destroy()
})

// Types
interface OpportunityData {
  type: 'arb' | 'liquidation' | 'backrun'
  chainId: number
  params: Record<string, unknown>
}

interface ExtractionResult {
  profit: bigint
  gasEstimate: bigint
  calldata: string
  success: boolean
}
```

## [LEGION USE CASES]
```
- 100 DEX pairs monitoring: 100 workers, each watching 1 pair
- Batch liquidation checks: concurrentTasksPerWorker=4 (I/O bound RPC calls)
- EVM profit calc: concurrentTasksPerWorker=1 (CPU bound)
- Block event burst: maxQueue='auto' absorbs 10x normal load spikes
```
