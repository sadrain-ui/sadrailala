/**
 * DASHBOARD METRICS
 * =================
 * Aggregates metrics for operational dashboard
 *
 * Metrics Tracked:
 * - Connection pool utilization
 * - Backup completion rates
 * - Encryption throughput
 * - Archive progress
 * - Failover events
 * - System performance
 */

export interface MetricPoint {
  timestamp: Date
  value: number
  labels?: Record<string, string>
}

export interface MetricSeries {
  name: string
  unit: string
  dataPoints: MetricPoint[]
}

export interface DashboardSnapshot {
  timestamp: Date
  connectionPoolMetrics: {
    totalConnections: number
    activeConnections: number
    idleConnections: number
    utilizationPercent: number
    healthScore: number
  }
  backupMetrics: {
    lastBackupTime: Date | null
    lastBackupDuration: number
    totalBackups: number
    successfulBackups: number
    failureRate: number
  }
  encryptionMetrics: {
    encryptionsPerSecond: number
    averageEncryptionTime: number
    keyVersion: number
    daysUntilRotation: number
  }
  archivalMetrics: {
    recordsArchived: number
    recordsInArchive: number
    pendingArchival: number
    archivalRate: number // records/sec
  }
  failoverMetrics: {
    currentRole: string
    currentState: string
    totalFailovers: number
    lastFailover: Date | null
    primaryHealthScore: number
    backupHealthScore: number
  }
  systemMetrics: {
    uptime: number // minutes
    uptimePercent: number
    errorCount: number
    warningCount: number
    criticalAlerts: number
  }
}

/**
 * DASHBOARD METRICS CLASS
 */
export class DashboardMetrics {
  private metrics: Map<string, MetricSeries> = new Map()
  private maxDataPoints: number = 1440 // 24 hours of 1-minute metrics

  constructor() {
    this.initializeMetrics()
    console.log(`[DASHBOARD_METRICS] Initialized`)
  }

  /**
   * Initialize standard metrics
   */
  private initializeMetrics(): void {
    const metricNames = [
      // Connection pool
      'connection_pool_active',
      'connection_pool_idle',
      'connection_pool_utilization',
      'connection_pool_health_score',

      // Backups
      'backup_duration',
      'backup_size',
      'backup_completion_rate',
      'backup_verification_rate',

      // Encryption
      'encryption_throughput',
      'encryption_latency',
      'encryption_key_version',

      // Archival
      'archival_rate',
      'archive_size',
      'archive_records_pending',

      // Failover
      'failover_count',
      'failover_time',
      'primary_health_score',
      'backup_health_score',

      // System
      'system_uptime',
      'system_error_count',
      'system_alert_count',
    ]

    for (const name of metricNames) {
      this.metrics.set(name, {
        name,
        unit: this.getMetricUnit(name),
        dataPoints: [],
      })
    }

    console.log(`[DASHBOARD_METRICS] Initialized ${metricNames.length} metrics`)
  }

  /**
   * Get metric unit
   */
  private getMetricUnit(metricName: string): string {
    const units: Record<string, string> = {
      'connection_pool_utilization': '%',
      'connection_pool_health_score': '%',
      'backup_duration': 'ms',
      'backup_size': 'bytes',
      'backup_completion_rate': '%',
      'backup_verification_rate': '%',
      'encryption_throughput': 'ops/sec',
      'encryption_latency': 'ms',
      'archival_rate': 'records/sec',
      'archive_size': 'bytes',
      'failover_time': 'ms',
      'primary_health_score': '%',
      'backup_health_score': '%',
      'system_uptime': 'minutes',
    }

    return units[metricName] || ''
  }

  /**
   * Record metric value
   */
  recordMetric(name: string, value: number, labels?: Record<string, string>): void {
    let series = this.metrics.get(name)

    if (!series) {
      series = {
        name,
        unit: '',
        dataPoints: [],
      }
      this.metrics.set(name, series)
    }

    const point: MetricPoint = {
      timestamp: new Date(),
      value,
      labels,
    }

    series.dataPoints.push(point)

    // Keep only last N data points
    if (series.dataPoints.length > this.maxDataPoints) {
      series.dataPoints.shift()
    }
  }

  /**
   * Get metric series
   */
  getMetricSeries(name: string, timeWindowMinutes: number = 60): MetricSeries | undefined {
    const series = this.metrics.get(name)
    if (!series) return undefined

    const cutoffTime = Date.now() - timeWindowMinutes * 60 * 1000

    return {
      name: series.name,
      unit: series.unit,
      dataPoints: series.dataPoints.filter((p) => p.timestamp.getTime() > cutoffTime),
    }
  }

  /**
   * Get all metrics for current window
   */
  getAllMetrics(timeWindowMinutes: number = 60): Record<string, MetricSeries> {
    const result: Record<string, MetricSeries> = {}

    for (const [name, series] of this.metrics.entries()) {
      const windowed = this.getMetricSeries(name, timeWindowMinutes)
      if (windowed) {
        result[name] = windowed
      }
    }

    return result
  }

  /**
   * Get dashboard snapshot
   */
  getDashboardSnapshot(
    connectionPool?: any,
    backup?: any,
    encryption?: any,
    archival?: any,
    failover?: any,
  ): DashboardSnapshot {
    return {
      timestamp: new Date(),

      connectionPoolMetrics: {
        totalConnections: connectionPool?.totalConnections || 0,
        activeConnections: connectionPool?.activeConnections || 0,
        idleConnections: connectionPool?.idleConnections || 0,
        utilizationPercent: connectionPool?.utilizationPercent || 0,
        healthScore: connectionPool?.healthScore || 100,
      },

      backupMetrics: {
        lastBackupTime: backup?.lastBackupTime || null,
        lastBackupDuration: backup?.lastBackupDuration || 0,
        totalBackups: backup?.totalBackups || 0,
        successfulBackups: backup?.successfulBackups || 0,
        failureRate: backup?.failureRate || 0,
      },

      encryptionMetrics: {
        encryptionsPerSecond: encryption?.encryptionsPerSecond || 0,
        averageEncryptionTime: encryption?.averageEncryptionTime || 0,
        keyVersion: encryption?.keyVersion || 1,
        daysUntilRotation: encryption?.daysUntilRotation || 30,
      },

      archivalMetrics: {
        recordsArchived: archival?.recordsArchived || 0,
        recordsInArchive: archival?.recordsInArchive || 0,
        pendingArchival: archival?.pendingArchival || 0,
        archivalRate: archival?.archivalRate || 0,
      },

      failoverMetrics: {
        currentRole: failover?.currentRole || 'PRIMARY',
        currentState: failover?.currentState || 'HEALTHY',
        totalFailovers: failover?.totalFailovers || 0,
        lastFailover: failover?.lastFailover || null,
        primaryHealthScore: failover?.primaryHealthScore || 100,
        backupHealthScore: failover?.backupHealthScore || 100,
      },

      systemMetrics: {
        uptime: 0,
        uptimePercent: 99.9,
        errorCount: 0,
        warningCount: 0,
        criticalAlerts: 0,
      },
    }
  }

  /**
   * Calculate average metric
   */
  getMetricAverage(name: string, timeWindowMinutes: number = 60): number {
    const series = this.getMetricSeries(name, timeWindowMinutes)
    if (!series || series.dataPoints.length === 0) return 0

    const sum = series.dataPoints.reduce((acc, p) => acc + p.value, 0)
    return sum / series.dataPoints.length
  }

  /**
   * Calculate metric percentile
   */
  getMetricPercentile(name: string, percentile: number, timeWindowMinutes: number = 60): number {
    const series = this.getMetricSeries(name, timeWindowMinutes)
    if (!series || series.dataPoints.length === 0) return 0

    const sorted = series.dataPoints.map((p) => p.value).sort((a, b) => a - b)
    const index = Math.ceil((percentile / 100) * sorted.length) - 1

    return sorted[Math.max(0, index)]
  }

  /**
   * Get metric statistics
   */
  getMetricStats(name: string, timeWindowMinutes: number = 60): {
    min: number
    max: number
    avg: number
    p50: number
    p95: number
    p99: number
  } {
    const series = this.getMetricSeries(name, timeWindowMinutes)
    if (!series || series.dataPoints.length === 0) {
      return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 }
    }

    const values = series.dataPoints.map((p) => p.value).sort((a, b) => a - b)

    return {
      min: values[0],
      max: values[values.length - 1],
      avg: values.reduce((a, b) => a + b) / values.length,
      p50: values[Math.floor(values.length * 0.5)],
      p95: values[Math.floor(values.length * 0.95)],
      p99: values[Math.floor(values.length * 0.99)],
    }
  }

  /**
   * Print dashboard
   */
  printDashboard(): void {
    console.log(`\n${'='.repeat(70)}`)
    console.log(`OPERATIONAL DASHBOARD`)
    console.log(`${'='.repeat(70)}`)

    // Connection Pool
    if (this.metrics.get('connection_pool_utilization')) {
      const util = this.getMetricAverage('connection_pool_utilization')
      const health = this.getMetricAverage('connection_pool_health_score')
      console.log(`\nConnection Pool:`)
      console.log(`  Utilization: ${util.toFixed(1)}%`)
      console.log(`  Health Score: ${health.toFixed(0)}/100`)
    }

    // Backup
    if (this.metrics.get('backup_completion_rate')) {
      const completion = this.getMetricAverage('backup_completion_rate')
      const verification = this.getMetricAverage('backup_verification_rate')
      console.log(`\nBackup Status:`)
      console.log(`  Completion Rate: ${completion.toFixed(1)}%`)
      console.log(`  Verification Rate: ${verification.toFixed(1)}%`)
    }

    // Encryption
    if (this.metrics.get('encryption_throughput')) {
      const throughput = this.getMetricAverage('encryption_throughput')
      const latency = this.getMetricAverage('encryption_latency')
      console.log(`\nEncryption:`)
      console.log(`  Throughput: ${throughput.toFixed(0)} ops/sec`)
      console.log(`  Latency: ${latency.toFixed(2)}ms`)
    }

    // Failover
    if (this.metrics.get('primary_health_score')) {
      const primary = this.getMetricAverage('primary_health_score')
      const backup = this.getMetricAverage('backup_health_score')
      console.log(`\nFailover Status:`)
      console.log(`  Primary Health: ${primary.toFixed(0)}%`)
      console.log(`  Backup Health: ${backup.toFixed(0)}%`)
    }

    console.log(`${'='.repeat(70)}\n`)
  }

  /**
   * Export metrics to JSON
   */
  exportMetrics(format: 'json' | 'csv' = 'json'): string {
    if (format === 'json') {
      const exported: Record<string, any> = {}

      for (const [name, series] of this.metrics.entries()) {
        exported[name] = {
          unit: series.unit,
          dataPoints: series.dataPoints.map((p) => ({
            timestamp: p.timestamp.toISOString(),
            value: p.value,
          })),
        }
      }

      return JSON.stringify(exported, null, 2)
    } else {
      // CSV format
      let csv = 'metric,timestamp,value,unit\n'

      for (const [name, series] of this.metrics.entries()) {
        for (const point of series.dataPoints) {
          csv += `${name},${point.timestamp.toISOString()},${point.value},${series.unit}\n`
        }
      }

      return csv
    }
  }
}

export default DashboardMetrics
