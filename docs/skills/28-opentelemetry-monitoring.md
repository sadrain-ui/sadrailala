# SKILL-28: OPENTELEMETRY INSTITUTIONAL MONITORING (open-telemetry/opentelemetry-js)
## SOURCE: https://github.com/open-telemetry/opentelemetry-js
## CATEGORY: META — Engine Shield / Institutional Observability

## [STRICT_RULES]
- ALWAYS initialize OTel SDK BEFORE importing any other Legion module — auto-instrumentation must load first
- `tracer.startSpan()` MUST always have matching `span.end()` — NEVER let spans leak (use try/finally)
- Span attributes MUST NOT contain private keys, mnemonics, or raw tx hex — redact before setAttribute
- `context.with(ctx, fn)` MUST wrap ALL async operations that should propagate trace context
- Span status: `SpanStatusCode.ERROR` on any exception — NEVER swallow errors silently
- NEVER add attributes AFTER `span.end()` — silently ignored, creates debugging confusion
- Use `SpanKind.CLIENT` for outbound RPC calls, `SpanKind.INTERNAL` for Legion internal ops
- Export to OTLP endpoint (Jaeger/Grafana Tempo) — NEVER export to console in production
- Metric counters for: bundlesSubmitted, bundlesMissed, profitCaptured, executionErrors

## [MENTAL_MODEL]
- OTel = vendor-neutral telemetry framework — traces + metrics + logs unified
- Traces: distributed request tracking — see full lifecycle of a Legion bundle attempt
- Span: single operation unit with start/end time, attributes, events, status
- Context propagation: pass trace context across async boundaries — parent-child span relationships
- Metrics: counters, gauges, histograms — feed to Prometheus/Grafana for dashboards
- Legion use: trace each MEV opportunity from detection → simulation → submission → result

## [REAL_API]
```typescript
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { trace, context, SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { metrics } from '@opentelemetry/api'

// === SDK Init (must run FIRST) ===
const sdk = new NodeSDK({
  serviceName: 'legion-engine',
  traceExporter: new OTLPTraceExporter({ url: 'http://jaeger:4318/v1/traces' }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: 'http://prometheus:4318/v1/metrics' }),
    exportIntervalMillis: 10_000,
  }),
})
sdk.start()
process.on('SIGTERM', () => sdk.shutdown())

// === Tracer & Meter ===
const tracer = trace.getTracer('legion-engine', '1.0.0')
const meter = metrics.getMeter('legion-engine')

// === Metrics ===
const bundlesSubmitted = meter.createCounter('legion.bundles.submitted')
const bundlesMissed = meter.createCounter('legion.bundles.missed')
const profitGauge = meter.createObservableGauge('legion.profit.total_eth')
const executionLatency = meter.createHistogram('legion.execution.latency_ms')

// === Tracing a full MEV extraction flow ===
async function executeStrategy(opportunity: Opportunity) {
  const span = tracer.startSpan('mev.execute', {
    kind: SpanKind.INTERNAL,
    attributes: {
      'mev.strategy': opportunity.type,           // 'sandwich' | 'backrun' | 'arb'
      'mev.pool': opportunity.pool,
      'mev.estimated_profit_wei': opportunity.estimatedProfit.toString(),
      'mev.target_block': opportunity.targetBlock,
    },
  })
  const ctx = trace.setSpan(context.active(), span)

  try {
    // Child span for simulation
    const simResult = await context.with(ctx, async () => {
      const simSpan = tracer.startSpan('mev.simulate', { kind: SpanKind.CLIENT })
      try {
        const result = await simulateBundle(opportunity.bundle)
        simSpan.setAttribute('sim.profit', result.profit.toString())
        simSpan.setAttribute('sim.mev_gas_price', result.mevGasPrice.toString())
        simSpan.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (err: any) {
        simSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
        simSpan.recordException(err)
        throw err
      } finally {
        simSpan.end()
      }
    })

    // Child span for bundle submission
    const submitResult = await context.with(ctx, async () => {
      const submitSpan = tracer.startSpan('mev.submit_bundle', { kind: SpanKind.CLIENT })
      try {
        const result = await mevshare.sendBundle(opportunity.bundle)
        submitSpan.setAttribute('bundle.hash', result.bundleHash)
        bundlesSubmitted.add(1, { strategy: opportunity.type })
        submitSpan.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (err: any) {
        submitSpan.recordException(err)
        submitSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
        throw err
      } finally {
        submitSpan.end()
      }
    })

    span.setAttribute('bundle.hash', submitResult.bundleHash)
    span.setStatus({ code: SpanStatusCode.OK })
  } catch (err: any) {
    span.recordException(err)
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
    bundlesMissed.add(1)
    throw err
  } finally {
    span.end() // ALWAYS in finally
  }
}

// Observable gauge for cumulative profit
let totalProfitEth = 0
profitGauge.addCallback((result) => {
  result.observe(totalProfitEth, { chain: 'mainnet' })
})
```

## [LEGION USE CASES]
- Full trace: MEV opportunity → simulation → bundle submit → inclusion check — visible in Jaeger
- Latency SLA: histogram on execution_latency_ms — alert if P99 > 200ms (miss next block)
- Profit dashboard: Grafana panel on `legion.profit.total_eth` gauge — real-time P&L
- Error attribution: span.recordException captures stack trace — know exactly where failures happen
- Multi-chain correlation: traceId propagates across Legion workers — correlate parallel strategies
- Institutional reporting: export to Datadog/New Relic for investor-grade monitoring dashboards
