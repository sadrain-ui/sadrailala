/**
 * HEALTH MONITOR
 * ==============
 * Real-time health monitoring for all database components
 *
 * Monitors:
 * - Connection pool health
 * - Backup success rates
 * - Encryption operations
 * - Data archival progress
 * - Failover status
 * - System-wide metrics
 */

export interface ComponentHealth {
  name: string
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'
  healthScore: number // 0-100
  lastCheck: Date
  metrics: Record<string, number | string>
  errorCount: number
  warningCount: number
}

export interface SystemHealth {
  timestamp: Date
  overallStatus: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'
  overallScore: number
  components: ComponentHealth[]
  alerts: AlertEvent[]
  uptimePercentage: number
}

export interface AlertEvent {
  timestamp: Date
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  component: string
  message: string
  details?: Record<string, any>
  resolved?: boolean
}

export interface AlertRule {
  id: string
  component: string
  metric: string
  condition: 'ABOVE' | 'BELOW' | 'EQUALS' | 'CHANGED'
  threshold: number
  severity: 'WARNING' | 'CRITICAL'
  enabled: boolean
}

/**
 * HEALTH MONITOR CLASS
 */
export class HealthMonitor {
  private components: Map<string, ComponentHealth> = new Map()
  private alerts: AlertEvent[] = []
  private alertRules: Map<string, AlertRule> = new Map()
  private startTime: Date = new Date()
  private checkInterval: NodeJS.Timeout | null = null
  private stats = {
    totalChecks: 0,
    healthyChecks: 0,
    degradedChecks: 0,
    unhealthyChecks: 0,
    totalAlerts: 0,
  }

  constructor() {
    console.log(`[HEALTH_MONITOR] Initialized`)
  }

  /**
   * Register a component for monitoring
   */
  registerComponent(name: string): void {
    const component: ComponentHealth = {
      name,
      status: 'HEALTHY',
      healthScore: 100,
      lastCheck: new Date(),
      metrics: {},
      errorCount: 0,
      warningCount: 0,
    }

    this.components.set(name, component)
    console.log(`[HEALTH_MONITOR] Registered component: ${name}`)
  }

  /**
   * Update component health
   */
  updateComponentHealth(
    name: string,
    healthScore: number,
    metrics: Record<string, number | string> = {},
  ): void {
    let component = this.components.get(name)

    if (!component) {
      this.registerComponent(name)
      component = this.components.get(name)!
    }

    component.healthScore = Math.max(0, Math.min(100, healthScore))
    component.lastCheck = new Date()
    component.metrics = metrics

    // Determine status
    if (healthScore >= 80) {
      component.status = 'HEALTHY'
    } else if (healthScore >= 50) {
      component.status = 'DEGRADED'
      component.warningCount++
    } else {
      component.status = 'UNHEALTHY'
      component.errorCount++
    }

    this.stats.totalChecks++

    if (component.status === 'HEALTHY') {
      this.stats.healthyChecks++
    } else if (component.status === 'DEGRADED') {
      this.stats.degradedChecks++
    } else {
      this.stats.unhealthyChecks++
    }

    // Check alert rules
    this.evaluateAlertRules(component)
  }

  /**
   * Record an error
   */
  recordError(component: string, message: string, details?: Record<string, any>): void {
    const comp = this.components.get(component)
    if (comp) {
      comp.errorCount++
    }

    const alert: AlertEvent = {
      timestamp: new Date(),
      severity: 'CRITICAL',
      component,
      message,
      details,
      resolved: false,
    }

    this.alerts.push(alert)
    this.stats.totalAlerts++

    console.log(`[HEALTH_MONITOR] ERROR in ${component}: ${message}`)
  }

  /**
   * Record a warning
   */
  recordWarning(component: string, message: string, details?: Record<string, any>): void {
    const comp = this.components.get(component)
    if (comp) {
      comp.warningCount++
    }

    const alert: AlertEvent = {
      timestamp: new Date(),
      severity: 'WARNING',
      component,
      message,
      details,
      resolved: false,
    }

    this.alerts.push(alert)
    this.stats.totalAlerts++

    console.log(`[HEALTH_MONITOR] WARNING in ${component}: ${message}`)
  }

  /**
   * Add alert rule
   */
  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule)
    console.log(`[HEALTH_MONITOR] Added alert rule: ${rule.id}`)
  }

  /**
   * Evaluate alert rules
   */
  private evaluateAlertRules(component: ComponentHealth): void {
    for (const rule of this.alertRules.values()) {
      if (!rule.enabled || rule.component !== component.name) {
        continue
      }

      const metricValue = component.metrics[rule.metric]
      if (metricValue === undefined) {
        continue
      }

      const numValue = typeof metricValue === 'number' ? metricValue : parseFloat(String(metricValue))

      let triggered = false

      switch (rule.condition) {
        case 'ABOVE':
          triggered = numValue > rule.threshold
          break
        case 'BELOW':
          triggered = numValue < rule.threshold
          break
        case 'EQUALS':
          triggered = numValue === rule.threshold
          break
        case 'CHANGED':
          triggered = true
          break
      }

      if (triggered) {
        this.recordAlert(rule, component, numValue)
      }
    }
  }

  /**
   * Record alert from rule
   */
  private recordAlert(rule: AlertRule, component: ComponentHealth, value: number): void {
    const alert: AlertEvent = {
      timestamp: new Date(),
      severity: rule.severity,
      component: component.name,
      message: `Alert rule triggered: ${rule.id}`,
      details: {
        rule: rule.id,
        metric: rule.metric,
        condition: rule.condition,
        threshold: rule.threshold,
        actualValue: value,
      },
    }

    this.alerts.push(alert)
    this.stats.totalAlerts++
  }

  /**
   * Get system health
   */
  getSystemHealth(): SystemHealth {
    const components = Array.from(this.components.values())

    let totalScore = 0
    let healthyCount = 0

    for (const comp of components) {
      totalScore += comp.healthScore
      if (comp.status === 'HEALTHY') {
        healthyCount++
      }
    }

    const overallScore = components.length > 0 ? totalScore / components.length : 100

    let overallStatus: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' = 'HEALTHY'
    if (overallScore < 50) {
      overallStatus = 'UNHEALTHY'
    } else if (overallScore < 80) {
      overallStatus = 'DEGRADED'
    }

    // Calculate uptime
    const uptime = ((Date.now() - this.startTime.getTime()) / 1000 / 60) // minutes
    const downtime = Array.from(this.components.values()).reduce((sum, c) => sum + c.errorCount, 0)
    const uptimePercentage = Math.max(0, 100 - (downtime / Math.max(1, this.stats.totalChecks)) * 100)

    // Recent alerts (last 100)
    const recentAlerts = this.alerts.slice(-100)

    return {
      timestamp: new Date(),
      overallStatus,
      overallScore: Math.round(overallScore),
      components,
      alerts: recentAlerts,
      uptimePercentage: Math.round(uptimePercentage * 100) / 100,
    }
  }

  /**
   * Get component health
   */
  getComponentHealth(name: string): ComponentHealth | undefined {
    return this.components.get(name)
  }

  /**
   * Get all components
   */
  getAllComponents(): ComponentHealth[] {
    return Array.from(this.components.values())
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(limit: number = 50): AlertEvent[] {
    return this.alerts.slice(-limit)
  }

  /**
   * Get critical alerts
   */
  getCriticalAlerts(): AlertEvent[] {
    return this.alerts.filter((a) => a.severity === 'CRITICAL' && !a.resolved)
  }

  /**
   * Resolve alert
   */
  resolveAlert(index: number): void {
    if (index >= 0 && index < this.alerts.length) {
      this.alerts[index].resolved = true
      console.log(`[HEALTH_MONITOR] Resolved alert: ${this.alerts[index].message}`)
    }
  }

  /**
   * Print health report
   */
  printHealthReport(): void {
    const health = this.getSystemHealth()

    console.log(`\n${'='.repeat(70)}`)
    console.log(`SYSTEM HEALTH REPORT`)
    console.log(`${'='.repeat(70)}`)
    console.log(`Timestamp:           ${health.timestamp.toISOString()}`)
    console.log(`Overall Status:      ${health.overallStatus}`)
    console.log(`Overall Score:       ${health.overallScore}/100`)
    console.log(`Uptime:              ${health.uptimePercentage.toFixed(2)}%`)

    console.log(`\nComponent Health:`)
    for (const comp of health.components) {
      const status = comp.status === 'HEALTHY' ? '✓' : comp.status === 'DEGRADED' ? '⚠' : '✗'
      console.log(
        `  ${status} ${comp.name.padEnd(20)} ${comp.healthScore}/100 (${comp.status})`,
      )
    }

    const criticalAlerts = health.alerts.filter((a) => a.severity === 'CRITICAL')
    if (criticalAlerts.length > 0) {
      console.log(`\n⚠️  CRITICAL ALERTS (${criticalAlerts.length})`)
      for (const alert of criticalAlerts.slice(0, 5)) {
        console.log(`  - [${alert.component}] ${alert.message}`)
      }
    }

    console.log(`\nStatistics:`)
    console.log(`  Total checks:        ${this.stats.totalChecks}`)
    console.log(`  Healthy checks:      ${this.stats.healthyChecks}`)
    console.log(`  Degraded checks:     ${this.stats.degradedChecks}`)
    console.log(`  Unhealthy checks:    ${this.stats.unhealthyChecks}`)
    console.log(`  Total alerts:        ${this.stats.totalAlerts}`)

    console.log(`${'='.repeat(70)}\n`)
  }

  /**
   * Start periodic health checks
   */
  startPeriodicChecks(intervalMs: number = 30000): void {
    if (this.checkInterval) {
      return
    }

    console.log(`[HEALTH_MONITOR] Starting periodic health checks (every ${intervalMs}ms)`)

    this.checkInterval = setInterval(() => {
      // Simulate health check polling from all components
      // In production, this would aggregate metrics from real components
    }, intervalMs)
  }

  /**
   * Stop periodic health checks
   */
  stopPeriodicChecks(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
      console.log(`[HEALTH_MONITOR] Stopped periodic health checks`)
    }
  }
}

export default HealthMonitor
