/**
 * Monitoring & Alerting System — Real-time monitoring, dashboards, alerts
 * Provides observability for production operations
 */

export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

export enum MetricCategory {
  EXTRACTION_SUCCESS = 'extraction_success',
  EXTRACTION_FAILURE = 'extraction_failure',
  EXTRACTION_TIME = 'extraction_time',
  GAS_USAGE = 'gas_usage',
  RATE_LIMIT_HIT = 'rate_limit_hit',
  ERROR_RECOVERY = 'error_recovery',
  MEV_DETECTED = 'mev_detected',
  BRIDGE_SUCCESS = 'bridge_success',
  BRIDGE_FAILURE = 'bridge_failure',
}

export interface Metric {
  timestamp: Date
  category: MetricCategory
  value: number
  unit: string
  wallet?: string
  protocol?: string
  metadata?: Record<string, unknown>
}

export interface Alert {
  id: string
  timestamp: Date
  severity: AlertSeverity
  title: string
  message: string
  category: MetricCategory
  threshold?: number
  currentValue?: number
  actionItems?: string[]
  resolved?: boolean
  resolvedAt?: Date
}

/**
 * Metrics collector
 */
export class MetricsCollector {
  private metrics: Metric[] = []
  private maxMetrics: number

  constructor(maxMetrics: number = 100000) {
    this.maxMetrics = maxMetrics
  }

  /**
   * Record metric
   */
  recordMetric(
    category: MetricCategory,
    value: number,
    unit: string,
    metadata?: { wallet?: string; protocol?: string; [key: string]: unknown },
  ): void {
    const metric: Metric = {
      timestamp: new Date(),
      category,
      value,
      unit,
      wallet: metadata?.wallet,
      protocol: metadata?.protocol,
      metadata,
    }

    this.metrics.push(metric)

    // Trim old metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics)
    }
  }

  /**
   * Get metrics by category
   */
  getByCategory(category: MetricCategory, limit: number = 1000): Metric[] {
    return this.metrics.filter((m) => m.category === category).slice(-limit)
  }

  /**
   * Get metrics in time range
   */
  getTimeRange(startTime: Date, endTime: Date): Metric[] {
    return this.metrics.filter((m) => m.timestamp >= startTime && m.timestamp <= endTime)
  }

  /**
   * Calculate average for category
   */
  getAverage(category: MetricCategory, timeWindowMs: number = 3600000): number {
    const now = new Date()
    const startTime = new Date(now.getTime() - timeWindowMs)

    const filtered = this.metrics.filter(
      (m) => m.category === category && m.timestamp >= startTime,
    )

    if (filtered.length === 0) return 0

    const sum = filtered.reduce((acc, m) => acc + m.value, 0)
    return sum / filtered.length
  }

  /**
   * Get percentile
   */
  getPercentile(
    category: MetricCategory,
    percentile: number,
    timeWindowMs: number = 3600000,
  ): number {
    const now = new Date()
    const startTime = new Date(now.getTime() - timeWindowMs)

    const filtered = this.metrics
      .filter((m) => m.category === category && m.timestamp >= startTime)
      .map((m) => m.value)
      .sort((a, b) => a - b)

    if (filtered.length === 0) return 0

    const index = Math.ceil((percentile / 100) * filtered.length) - 1
    return filtered[Math.max(0, index)]
  }

  /**
   * Clear metrics
   */
  clear(): number {
    const count = this.metrics.length
    this.metrics = []
    return count
  }
}

/**
 * Alert engine
 */
export class AlertEngine {
  private alerts: Map<string, Alert> = new Map()
  private alertRules: Array<{
    category: MetricCategory
    threshold: number
    severity: AlertSeverity
    comparison: 'above' | 'below'
  }> = []

  constructor() {
    this.initializeDefaultRules()
  }

  /**
   * Initialize default alert rules
   */
  private initializeDefaultRules(): void {
    this.alertRules = [
      {
        category: MetricCategory.EXTRACTION_FAILURE,
        threshold: 0.2, // 20% failure rate
        severity: AlertSeverity.WARNING,
        comparison: 'above',
      },
      {
        category: MetricCategory.EXTRACTION_TIME,
        threshold: 120000, // 2 minutes
        severity: AlertSeverity.WARNING,
        comparison: 'above',
      },
      {
        category: MetricCategory.GAS_USAGE,
        threshold: 500000, // 500k gas
        severity: AlertSeverity.WARNING,
        comparison: 'above',
      },
      {
        category: MetricCategory.RATE_LIMIT_HIT,
        threshold: 5, // 5 hits
        severity: AlertSeverity.ERROR,
        comparison: 'above',
      },
      {
        category: MetricCategory.MEV_DETECTED,
        threshold: 0, // Any MEV detection
        severity: AlertSeverity.WARNING,
        comparison: 'above',
      },
      {
        category: MetricCategory.BRIDGE_FAILURE,
        threshold: 0.1, // 10% failure rate
        severity: AlertSeverity.ERROR,
        comparison: 'above',
      },
    ]
  }

  /**
   * Trigger alert
   */
  triggerAlert(
    category: MetricCategory,
    currentValue: number,
    threshold: number,
    severity: AlertSeverity,
    message: string,
    actionItems?: string[],
  ): string {
    const alertId = `${category}_${Date.now()}`

    const alert: Alert = {
      id: alertId,
      timestamp: new Date(),
      severity,
      title: `${category} Alert`,
      message,
      category,
      threshold,
      currentValue,
      actionItems,
      resolved: false,
    }

    this.alerts.set(alertId, alert)
    this.logAlert(alert)

    return alertId
  }

  /**
   * Resolve alert
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId)
    if (!alert) return false

    alert.resolved = true
    alert.resolvedAt = new Date()

    console.log(`[ALERT_RESOLVED] ${alertId}`)

    return true
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values()).filter((a) => !a.resolved)
  }

  /**
   * Get alerts by severity
   */
  getBySeverity(severity: AlertSeverity, onlyActive: boolean = true): Alert[] {
    return Array.from(this.alerts.values()).filter(
      (a) => a.severity === severity && (!onlyActive || !a.resolved),
    )
  }

  /**
   * Log alert
   */
  private logAlert(alert: Alert): void {
    const logLevel =
      alert.severity === AlertSeverity.CRITICAL
        ? 'error'
        : alert.severity === AlertSeverity.ERROR
          ? 'error'
          : alert.severity === AlertSeverity.WARNING
            ? 'warn'
            : 'info'

    console[logLevel as 'error' | 'warn' | 'info'](
      `[ALERT:${alert.severity.toUpperCase()}] ${alert.title}: ${alert.message}`,
    )

    if (alert.actionItems && alert.actionItems.length > 0) {
      console.info(`  Actions: ${alert.actionItems.join(', ')}`)
    }
  }
}

/**
 * Health check service
 */
export class HealthCheck {
  private lastCheckTime: Date | null = null
  private checkResults: Array<{
    timestamp: Date
    component: string
    status: 'healthy' | 'degraded' | 'unhealthy'
    details: string
  }> = []

  /**
   * Check Redis connectivity
   */
  async checkRedis(): Promise<{ status: 'healthy' | 'unhealthy'; latencyMs: number }> {
    try {
      const start = Date.now()
      // In real implementation, would ping Redis
      await new Promise((resolve) => setTimeout(resolve, 10))
      const latencyMs = Date.now() - start

      return {
        status: latencyMs < 100 ? 'healthy' : 'unhealthy',
        latencyMs,
      }
    } catch {
      return { status: 'unhealthy', latencyMs: -1 }
    }
  }

  /**
   * Check RPC connectivity
   */
  async checkRPC(): Promise<{ status: 'healthy' | 'unhealthy'; latencyMs: number }> {
    try {
      const start = Date.now()
      // In real implementation, would call RPC
      await new Promise((resolve) => setTimeout(resolve, 50))
      const latencyMs = Date.now() - start

      return {
        status: latencyMs < 500 ? 'healthy' : 'unhealthy',
        latencyMs,
      }
    } catch {
      return { status: 'unhealthy', latencyMs: -1 }
    }
  }

  /**
   * Check database connectivity
   */
  async checkDatabase(): Promise<{ status: 'healthy' | 'unhealthy'; latencyMs: number }> {
    try {
      const start = Date.now()
      // In real implementation, would query database
      await new Promise((resolve) => setTimeout(resolve, 25))
      const latencyMs = Date.now() - start

      return {
        status: latencyMs < 200 ? 'healthy' : 'unhealthy',
        latencyMs,
      }
    } catch {
      return { status: 'unhealthy', latencyMs: -1 }
    }
  }

  /**
   * Run full health check
   */
  async runFullCheck(): Promise<{
    timestamp: Date
    overallStatus: 'healthy' | 'degraded' | 'unhealthy'
    components: Record<string, { status: 'healthy' | 'unhealthy'; latencyMs: number }>
  }> {
    const timestamp = new Date()

    const redis = await this.checkRedis()
    const rpc = await this.checkRPC()
    const database = await this.checkDatabase()

    const components = {
      redis,
      rpc,
      database,
    }

    const unhealthyCount = Object.values(components).filter((c) => c.status === 'unhealthy')
      .length

    const overallStatus =
      unhealthyCount > 1
        ? 'unhealthy'
        : unhealthyCount === 1
          ? 'degraded'
          : 'healthy'

    this.lastCheckTime = timestamp

    this.checkResults.push({
      timestamp,
      component: 'system',
      status: overallStatus,
      details: `Redis: ${redis.status}, RPC: ${rpc.status}, DB: ${database.status}`,
    })

    // Keep only recent results
    if (this.checkResults.length > 1000) {
      this.checkResults = this.checkResults.slice(-1000)
    }

    return {
      timestamp,
      overallStatus,
      components,
    }
  }

  /**
   * Get last check result
   */
  getLastCheck(): {
    timestamp: Date | null
    overallStatus?: 'healthy' | 'degraded' | 'unhealthy'
  } {
    if (!this.lastCheckTime) {
      return { timestamp: null }
    }

    const lastResult = this.checkResults[this.checkResults.length - 1]

    return {
      timestamp: this.lastCheckTime,
      overallStatus: lastResult?.status,
    }
  }
}

/**
 * Monitoring service
 */
export class MonitoringService {
  metricsCollector: MetricsCollector
  alertEngine: AlertEngine
  healthCheck: HealthCheck

  constructor() {
    this.metricsCollector = new MetricsCollector()
    this.alertEngine = new AlertEngine()
    this.healthCheck = new HealthCheck()
  }

  /**
   * Get dashboard data
   */
  getDashboardData(timeWindowMs: number = 3600000): {
    extractionSuccess: number
    extractionFailure: number
    averageExtractionTime: number
    gasUsageP95: number
    rateLimitHits: number
    activeAlerts: number
    systemHealth: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
  } {
    return {
      extractionSuccess: Math.round(
        this.metricsCollector.getAverage(MetricCategory.EXTRACTION_SUCCESS, timeWindowMs),
      ),
      extractionFailure: Math.round(
        this.metricsCollector.getAverage(MetricCategory.EXTRACTION_FAILURE, timeWindowMs),
      ),
      averageExtractionTime: Math.round(
        this.metricsCollector.getAverage(MetricCategory.EXTRACTION_TIME, timeWindowMs),
      ),
      gasUsageP95: Math.round(
        this.metricsCollector.getPercentile(MetricCategory.GAS_USAGE, 95, timeWindowMs),
      ),
      rateLimitHits: Math.round(
        this.metricsCollector.getAverage(MetricCategory.RATE_LIMIT_HIT, timeWindowMs),
      ),
      activeAlerts: this.alertEngine.getActiveAlerts().length,
      systemHealth: this.healthCheck.getLastCheck().overallStatus ?? 'unknown',
    }
  }
}
