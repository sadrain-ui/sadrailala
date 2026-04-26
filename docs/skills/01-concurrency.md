# SKILL-01: HIGH-SPEED CONCURRENCY
# Source Repos: piscina, fast-json-stringify, undici
# Priority: 8 (lowest — applied after all safety/stealth rules)

## [STRICT_RULES]
```
RULE-01-A: ALL CPU-bound work (address derivation, batch signing, route math)
           MUST run in a Piscina worker pool. NEVER in the main thread.
           Violation = blocking the event loop = missed blocks = failed extraction.

RULE-01-B: ALL HTTP calls in @packages/core MUST use undici.Pool or undici.fetch.
           NEVER use axios, node-fetch, or native fetch.
           Reason: undici uses HTTP/1.1 pipelining + connection reuse = 3x faster.

RULE-01-C: JSON serialization of response payloads >1KB in hot paths
           MUST use fast-json-stringify with a pre-compiled schema.
           NEVER JSON.stringify() in loops or telemetry pipelines.

RULE-01-D: Parallel RPC calls (multi-chain price quotes) MUST use
           Promise.all() with pre-warmed undici Pool, NOT sequential awaits.

RULE-01-E: Worker pool size = Math.max(2, os.cpus().length - 1)
           Never hardcode pool size. Never use 1 worker.
```

---

## 1. Piscina Worker Pool Pattern

```typescript
import Piscina from 'piscina'
import { cpus } from 'os'

// Factory: createWorkerPool — never new Piscina() globally
export function createWorkerPool(workerFile: string): Piscina {
  return new Piscina({
    filename: workerFile,
    minThreads: 2,
    maxThreads: Math.max(2, cpus().length - 1),
    idleTimeout: 30_000,        // recycle idle workers after 30s
    resourceLimits: {
      maxOldGenerationSizeMb: 256  // prevent memory leaks per worker
    }
  })
}

// Usage: batch sign transactions in workers
const signingPool = createWorkerPool('./workers/signing.worker.ts')

async function batchSignTxs(txs: UnsignedTx[]): Promise<SignedTx[]> {
  // Split into chunks = worker count
  const chunkSize = Math.ceil(txs.length / signingPool.threads)
  const chunks = chunk(txs, chunkSize)
  
  const results = await Promise.all(
    chunks.map(chunk => signingPool.run({ txs: chunk }))
  )
  return results.flat()
}
```

## 2. undici Connection Pool Pattern

```typescript
import { Pool, fetch as undiciFetch } from 'undici'

// Factory: createRpcPool — one pool per chain RPC endpoint
export function createRpcPool(rpcUrl: string): Pool {
  return new Pool(rpcUrl, {
    connections: 10,           // 10 concurrent connections per RPC
    pipelining: 1,             // HTTP/1.1 pipelining
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
    connect: {
      timeout: 5_000           // 5s connect timeout
    }
  })
}

// Usage: batch RPC calls with single pool
async function multiChainQuote(
  pools: Map<number, Pool>,
  params: QuoteParams[]
): Promise<Quote[]> {
  return Promise.all(
    params.map(async p => {
      const pool = pools.get(p.chainId)!
      const res = await pool.request({
        path: '/',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'eth_call', params: [p] })
      })
      return res.body.json()
    })
  )
}
```

## 3. fast-json-stringify Pattern

```typescript
import fastJson from 'fast-json-stringify'

// Compile schema ONCE at startup — never inside a function
const serializeExtractionEvent = fastJson({
  type: 'object',
  properties: {
    laneId:    { type: 'string' },
    chainId:   { type: 'integer' },
    token:     { type: 'string' },
    amount:    { type: 'string' },
    sentinel:  { type: 'string' },
    timestamp: { type: 'integer' },
    status:    { type: 'string', enum: ['pending','active','settled','failed'] }
  },
  required: ['laneId','chainId','token','amount','sentinel','timestamp','status']
})

// Use compiled serializer in hot path
function emitLaneEvent(event: ExtractionEvent): string {
  return serializeExtractionEvent(event)  // 10x faster than JSON.stringify
}
```

## 4. Parallel Multi-Chain Scout Pattern

```typescript
// Scout: quote all chains simultaneously — never sequential
async function scoutAllChains(
  token: Address,
  pools: Map<number, UndiciPool>,
  chains: number[]
): Promise<ChainQuote[]> {
  const TIMEOUT_MS = 2000  // 2s max for scout phase
  
  const quotes = await Promise.allSettled(
    chains.map(chainId =>
      Promise.race([
        fetchQuote(token, chainId, pools.get(chainId)!),
        sleep(TIMEOUT_MS).then(() => { throw new Error('SCOUT_TIMEOUT') })
      ])
    )
  )
  
  // Filter: only fulfilled quotes pass to Gatekeeper
  return quotes
    .filter((r): r is PromiseFulfilledResult<ChainQuote> => r.status === 'fulfilled')
    .map(r => r.value)
}
```

## 5. Performance Targets

```
Metric                    | Target    | How
Scout quote (1 chain)     | <200ms    | undici Pool + cached connection
Scout quote (8 chains)    | <500ms    | Promise.allSettled parallel
Batch sign (100 txs)      | <100ms    | Piscina 4 workers
JSON serialize (1KB)      | <0.1ms    | fast-json-stringify compiled
Redis write (lane state)  | <5ms      | ioredis pipeline
Postgres advisory lock    | <10ms     | direct TCP connection pool
```
