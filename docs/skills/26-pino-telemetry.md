# SKILL-26: PINO ULTRA-FAST TELEMETRY (pinojs/pino)
## SOURCE: https://github.com/pinojs/pino
## CATEGORY: META — Engine Shield / Observability

## [STRICT_RULES]
- ALWAYS use pino over console.log in Legion — pino is 5x faster with zero blocking
- NEVER use `sync: true` in production — use `pino.destination({sync: false})` for async async write
- ALWAYS use `logger.child({module: 'strategy', bundleId})` for contextual logging — never raw logger
- `redact` MUST cover: `['privateKey', 'authKey', 'mnemonic', '*.secret', 'headers.authorization']`
- NEVER log full transaction objects raw — use serializers to extract only needed fields
- Log LEVELS for Legion: trace=mempool events, debug=strategy logic, info=bundle submission, warn=near-threshold, error=failed execution, fatal=fund-at-risk
- `logger.flush()` MUST be called before process.exit() — async logs may be lost without it
- Transport targets (pino-pretty, file) MUST run in separate worker thread via `pino.transport()`
- NEVER use pino in hot-loop (per-tx) without child logger — binding context per-child is free

## [MENTAL_MODEL]
- Pino = JSON-first logger — outputs NDJSON, designed for log pipelines (Loki, Datadog, ELK)
- Architecture: logger writes to stream → transport worker processes async → zero main thread block
- Child loggers: inherit parent stream + level, add extra bindings (fields) to every log line
- Redaction: strips sensitive fields BEFORE writing — not post-process, built into serializer
- Levels (numeric): trace=10, debug=20, info=30, warn=40, error=50, fatal=60, silent=Infinity
- Legion telemetry: every bundle attempt, execution result, profit/loss tagged with metadata

## [REAL_API]
```typescript
import pino from 'pino'

// Base logger — async, with redaction
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: ['privateKey', 'authKey', '*.secret', 'headers.authorization', 'wallet.mnemonic'],
    censor: '[REDACTED]',
  },
  serializers: {
    bundle: (b: any) => ({ hash: b.hash, blockTarget: b.inclusion?.block, txCount: b.body?.length }),
    err: pino.stdSerializers.err,
  },
  transport: {
    targets: [
      { target: 'pino-pretty', level: 'debug', options: { colorize: true } },    // dev only
      { target: 'pino/file', level: 'info', options: { destination: '/var/log/legion.ndjson' } },
    ],
  },
})

// Child loggers for each Legion module
const strategyLog = logger.child({ module: 'strategy', version: '1.0' })
const bundleLog = logger.child({ module: 'bundle-submitter' })
const mevLog = logger.child({ module: 'mev-scanner' })

// Usage in Legion execution flow
strategyLog.debug({ poolAddress, reserve0, reserve1 }, 'Pool state fetched')
bundleLog.info({ bundle }, 'Bundle submitted to Flashbots')
bundleLog.warn({ bundleHash, missed: true, block: targetBlock }, 'Bundle missed target block')
bundleLog.error({ err, bundleHash }, 'Bundle submission failed')
bundleLog.fatal({ err, fundsAtRisk: true }, 'CRITICAL: executor wallet compromised')

// Structured profit tracking
bundleLog.info({
  event: 'PROFIT_CAPTURED',
  profitWei: profit.toString(),
  profitUsd: (Number(profit) / 1e18 * ethPrice).toFixed(2),
  gasUsed,
  blockNumber,
  strategy: 'sandwich',
}, 'Extraction successful')

// Async flush before shutdown
process.on('SIGTERM', async () => {
  logger.info('Shutting down Legion Engine')
  await new Promise(resolve => logger.flush(resolve))
  process.exit(0)
})

// Level check before expensive computation
if (logger.isLevelEnabled('trace')) {
  logger.trace({ mempoolTx: tx }, 'Raw mempool event') // skip if not trace
}

// Dynamic level change (e.g., debug mode toggle via signal)
process.on('SIGUSR2', () => {
  logger.level = logger.level === 'debug' ? 'info' : 'debug'
  logger.info({ newLevel: logger.level }, 'Log level toggled')
})
```

## [LEGION USE CASES]
- Bundle audit trail: log every `sendBundle` attempt with hash, target block, profit estimate
- Profit dashboard feed: pipe pino NDJSON to Grafana/Loki for real-time P&L visualization
- Debug mode: `SIGUSR2` to toggle debug without restart — capture strategy decisions on demand
- Sensitive data guard: redact private keys BEFORE any log write — zero leak risk
- Incident replay: structured JSON logs allow exact reconstruction of failed bundle sequence
- Performance: child loggers per-strategy add zero overhead vs raw logger — context is free
