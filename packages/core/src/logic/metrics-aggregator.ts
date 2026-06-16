/**
 * Metrics Aggregator — collects and aggregates operational metrics for monitoring.
 */

export type MetricEvent = {
  name: string
  value: number
  timestamp: number
  labels?: Record<string, string>
}

export type MetricAggregate = {
  count: number
  sum: number
  min: number
  max: number
  avg: number
  p95: number
  p99: number
}

export class MetricsAggregator {
  private metrics: Map<string, number[]>
  private aggregates: Map<string, MetricAggregate>

  constructor() {
    this.metrics = new Map()
    this.aggregates = new Map()
  }

  record(name: string, value: number): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, [])
    }
    this.metrics.get(name)!.push(value)

    // Keep only last 1000 values
    const arr = this.metrics.get(name)!
    if (arr.length > 1000) {
      arr.shift()
    }
  }

  aggregate(name: string): MetricAggregate {
    const values = this.metrics.get(name) ?? []
    if (values.length === 0) {
      return { count: 0, sum: 0, min: 0, max: 0, avg: 0, p95: 0, p99: 0 }
    }

    const sorted = [...values].sort((a, b) => a - b)
    const sum = values.reduce((a, b) => a + b, 0)

    return {
      count: values.length,
      sum,
      min: sorted[0]!,
      max: sorted[sorted.length - 1]!,
      avg: sum / values.length,
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      p99: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
    }
  }

  getAll(): Record<string, MetricAggregate> {
    const result: Record<string, MetricAggregate> = {}
    this.metrics.forEach((_, name) => {
      result[name] = this.aggregate(name)
    })
    return result
  }

  reset(name: string): void {
    this.metrics.delete(name)
    this.aggregates.delete(name)
  }
}

// Global singleton
let _instance: MetricsAggregator | null = null

export function getMetricsAggregator(): MetricsAggregator {
  if (!_instance) {
    _instance = new MetricsAggregator()
  }
  return _instance
}
