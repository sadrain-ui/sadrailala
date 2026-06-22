// @ts-nocheck
/**
 * Operational Monitoring — real-time operational visibility and alerts.
 */

export type OperationalAlert = {
  id: string
  severity: 'info' | 'warning' | 'critical'
  message: string
  timestamp: number
  resolved_at?: number
  context?: Record<string, unknown>
}

export type OperationalMetric = {
  name: string
  value: number
  unit: string
  timestamp: number
  threshold_warning?: number
  threshold_critical?: number
}

export class OperationalMonitor {
  private alerts: OperationalAlert[]
  private metrics: OperationalMetric[]
  private maxAlertsSize: number
  private maxMetricsSize: number

  constructor(maxAlertsSize: number = 5000, maxMetricsSize: number = 100000) {
    this.alerts = []
    this.metrics = []
    this.maxAlertsSize = maxAlertsSize
    this.maxMetricsSize = maxMetricsSize
  }

  recordAlert(severity: OperationalAlert['severity'], message: string, context?: Record<string, unknown>): string {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    const alert: OperationalAlert = {
      id,
      severity,
      message,
      timestamp: Date.now(),
      context,
    }

    this.alerts.push(alert)

    if (this.alerts.length > this.maxAlertsSize) {
      this.alerts = this.alerts.slice(-this.maxAlertsSize)
    }

    // Log critical alerts
    if (severity === 'critical') {
      console.error(`[CRITICAL ALERT] ${message}`, context)
    }

    return id
  }

  resolveAlert(alertId: string): void {
    const alert = this.alerts.find((a) => a.id === alertId)
    if (alert) {
      alert.resolved_at = Date.now()
    }
  }

  recordMetric(name: string, value: number, unit: string, thresholds?: { warning?: number; critical?: number }): void {
    const metric: OperationalMetric = {
      name,
      value,
      unit,
      timestamp: Date.now(),
      threshold_warning: thresholds?.warning,
      threshold_critical: thresholds?.critical,
    }

    this.metrics.push(metric)

    if (this.metrics.length > this.maxMetricsSize) {
      this.metrics = this.metrics.slice(-this.maxMetricsSize)
    }

    // Check thresholds
    if (thresholds?.critical && value >= thresholds.critical) {
      this.recordAlert('critical', `Metric ${name} exceeded critical threshold: ${value} ${unit}`, { metric_name: name, value })
    } else if (thresholds?.warning && value >= thresholds.warning) {
      this.recordAlert('warning', `Metric ${name} exceeded warning threshold: ${value} ${unit}`, { metric_name: name, value })
    }
  }

  getActiveAlerts(): OperationalAlert[] {
    return this.alerts.filter((a) => !a.resolved_at)
  }

  getAlertsByLevel(severity: OperationalAlert['severity']): OperationalAlert[] {
    return this.alerts.filter((a) => a.severity === severity)
  }

  getMetrics(name?: string): OperationalMetric[] {
    if (!name) return [...this.metrics]
    return this.metrics.filter((m) => m.name === name)
  }

  getLatestMetric(name: string): OperationalMetric | null {
    const metrics = this.getMetrics(name)
    return metrics.length > 0 ? metrics[metrics.length - 1]! : null
  }

  getAlertStats(): Record<string, number> {
    const stats = { info: 0, warning: 0, critical: 0 }
    for (const alert of this.alerts) {
      stats[alert.severity] = (stats[alert.severity] || 0) + 1
    }
    return stats
  }

  clear(): void {
    this.alerts = []
    this.metrics = []
  }
}

// Global singleton
let _instance: OperationalMonitor | null = null

export function getOperationalMonitor(): OperationalMonitor {
  if (!_instance) {
    _instance = new OperationalMonitor()
  }
  return _instance
}
