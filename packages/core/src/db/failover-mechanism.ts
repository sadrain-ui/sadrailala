/**
 * FAILOVER MECHANISM
 * ==================
 * Manages automatic failover from primary to backup database
 *
 * Features:
 * - Primary → backup auto-switching
 * - Health monitoring
 * - Auto-recovery to primary
 * - Connection state tracking
 * - Failover notifications
 * - Statistics and metrics
 */

export type DatabaseRole = 'PRIMARY' | 'BACKUP'
export type FailoverState = 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'RECOVERING'

export interface DatabaseConfig {
  role: DatabaseRole
  host: string
  port: number
  database: string
  healthCheckIntervalMs: number // How often to check health
  failureThresholdMs: number // How long before failing over
  recoveryIntervalMs: number // How long before retrying primary
}

export interface HealthCheckResult {
  isHealthy: boolean
  latencyMs: number
  timestamp: Date
  error?: string
}

export interface FailoverEvent {
  timestamp: Date
  eventType: 'FAILOVER' | 'RECOVERY' | 'HEALTH_CHECK' | 'ERROR'
  fromRole: DatabaseRole
  toRole: DatabaseRole
  reason: string
  details?: Record<string, any>
}

export interface FailoverStats {
  totalFailovers: number
  totalRecoveries: number
  currentRole: DatabaseRole
  currentState: FailoverState
  primaryHealthScore: number
  backupHealthScore: number
  lastFailover?: Date
  lastRecovery?: Date
  uptime: {
    primary: string
    backup: string
  }
}

/**
 * FAILOVER MECHANISM CLASS
 */
export class FailoverMechanism {
  private primaryConfig: DatabaseConfig
  private backupConfig: DatabaseConfig
  private currentRole: DatabaseRole = 'PRIMARY'
  private currentState: FailoverState = 'HEALTHY'
  private healthChecks: Map<DatabaseRole, HealthCheckResult[]> = new Map()
  private failoverHistory: FailoverEvent[] = []
  private healthCheckInterval: NodeJS.Timeout | null = null
  private recoveryAttemptInterval: NodeJS.Timeout | null = null
  private lastFailoverTime: Date | null = null
  private lastRecoveryTime: Date | null = null
  private stats = {
    totalFailovers: 0,
    totalRecoveries: 0,
    totalHealthChecks: 0,
    totalErrors: 0,
  }

  constructor(primaryConfig: DatabaseConfig, backupConfig: DatabaseConfig) {
    this.primaryConfig = primaryConfig
    this.backupConfig = backupConfig

    // Initialize health check history
    this.healthChecks.set('PRIMARY', [])
    this.healthChecks.set('BACKUP', [])

    console.log(`[FAILOVER_MECHANISM] Initialized:`)
    console.log(`  Primary: ${primaryConfig.host}:${primaryConfig.port}/${primaryConfig.database}`)
    console.log(`  Backup: ${backupConfig.host}:${backupConfig.port}/${backupConfig.database}`)
    console.log(`  Health check interval: ${primaryConfig.healthCheckIntervalMs}ms`)
    console.log(`  Failure threshold: ${primaryConfig.failureThresholdMs}ms`)
    console.log(`  Recovery interval: ${primaryConfig.recoveryIntervalMs}ms`)
  }

  /**
   * Start health monitoring
   */
  startHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      console.log(`[FAILOVER_MECHANISM] Health monitoring already running`)
      return
    }

    console.log(`[FAILOVER_MECHANISM] Starting health monitoring...`)

    // Check health immediately
    this.performHealthCheck()

    // Then schedule recurring checks
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck()
    }, this.primaryConfig.healthCheckIntervalMs)

    // Start recovery attempts on backup
    this.startRecoveryAttempts()
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
      console.log(`[FAILOVER_MECHANISM] Health monitoring stopped`)
    }

    if (this.recoveryAttemptInterval) {
      clearInterval(this.recoveryAttemptInterval)
      this.recoveryAttemptInterval = null
    }
  }

  /**
   * Perform health check on both databases
   */
  private async performHealthCheck(): Promise<void> {
    const primaryHealth = await this.checkHealth(this.primaryConfig)
    const backupHealth = await this.checkHealth(this.backupConfig)

    this.recordHealthCheck('PRIMARY', primaryHealth)
    this.recordHealthCheck('BACKUP', backupHealth)

    this.stats.totalHealthChecks++

    console.log(`[FAILOVER_MECHANISM] Health check:`)
    console.log(`  PRIMARY: ${primaryHealth.isHealthy ? '✓ HEALTHY' : '✗ FAILED'} (${primaryHealth.latencyMs}ms)`)
    console.log(`  BACKUP: ${backupHealth.isHealthy ? '✓ HEALTHY' : '✗ FAILED'} (${backupHealth.latencyMs}ms)`)

    // Decide on failover
    await this.evaluateFailover(primaryHealth, backupHealth)
  }

  /**
   * Check database health
   */
  private async checkHealth(config: DatabaseConfig): Promise<HealthCheckResult> {
    const startTime = Date.now()

    try {
      // Simulate health check
      const latency = Math.random() * 100 + 10 // 10-110ms

      // Simulate occasional failures
      if (config.role === 'PRIMARY' && Math.random() < 0.05) {
        throw new Error('Simulated connection timeout')
      }

      return {
        isHealthy: true,
        latencyMs: Math.round(latency),
        timestamp: new Date(),
      }
    } catch (error) {
      this.stats.totalErrors++

      return {
        isHealthy: false,
        latencyMs: Date.now() - startTime,
        timestamp: new Date(),
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Record health check result
   */
  private recordHealthCheck(role: DatabaseRole, result: HealthCheckResult): void {
    const history = this.healthChecks.get(role)!
    history.push(result)

    // Keep only last 100 checks
    if (history.length > 100) {
      history.shift()
    }
  }

  /**
   * Evaluate whether to failover
   */
  private async evaluateFailover(primaryHealth: HealthCheckResult, backupHealth: HealthCheckResult): Promise<void> {
    if (!primaryHealth.isHealthy && backupHealth.isHealthy && this.currentRole === 'PRIMARY') {
      // Primary failed, backup is healthy → failover
      await this.performFailover('Primary database connection failed')
    }
  }

  /**
   * Perform failover to backup
   */
  private async performFailover(reason: string): Promise<void> {
    console.log(`[FAILOVER_MECHANISM] ⚠️  FAILOVER TRIGGERED: ${reason}`)

    const fromRole = this.currentRole
    this.currentRole = 'BACKUP'
    this.currentState = 'DEGRADED'
    this.lastFailoverTime = new Date()
    this.stats.totalFailovers++

    const event: FailoverEvent = {
      timestamp: new Date(),
      eventType: 'FAILOVER',
      fromRole,
      toRole: 'BACKUP',
      reason,
      details: {
        failoverNumber: this.stats.totalFailovers,
      },
    }

    this.failoverHistory.push(event)

    console.log(`[FAILOVER_MECHANISM] FAILOVER COMPLETED:`)
    console.log(`  From: ${fromRole}`)
    console.log(`  To: ${this.currentRole}`)
    console.log(`  Reason: ${reason}`)
    console.log(`  Timestamp: ${event.timestamp.toISOString()}`)

    // Notify system (in production: send alerts)
    this.notifyFailover(event)
  }

  /**
   * Start recovery attempts to primary
   */
  private startRecoveryAttempts(): void {
    if (this.recoveryAttemptInterval) {
      return
    }

    this.recoveryAttemptInterval = setInterval(async () => {
      if (this.currentRole === 'BACKUP') {
        const primaryHealth = await this.checkHealth(this.primaryConfig)

        if (primaryHealth.isHealthy) {
          await this.recoverToPrimary('Primary database recovered')
        }
      }
    }, this.primaryConfig.recoveryIntervalMs)
  }

  /**
   * Recover back to primary
   */
  private async recoverToPrimary(reason: string): Promise<void> {
    console.log(`[FAILOVER_MECHANISM] 🔄 RECOVERY INITIATED: ${reason}`)

    const fromRole = this.currentRole
    this.currentRole = 'PRIMARY'
    this.currentState = 'HEALTHY'
    this.lastRecoveryTime = new Date()
    this.stats.totalRecoveries++

    const event: FailoverEvent = {
      timestamp: new Date(),
      eventType: 'RECOVERY',
      fromRole,
      toRole: 'PRIMARY',
      reason,
      details: {
        recoveryNumber: this.stats.totalRecoveries,
      },
    }

    this.failoverHistory.push(event)

    console.log(`[FAILOVER_MECHANISM] RECOVERY COMPLETED:`)
    console.log(`  From: ${fromRole}`)
    console.log(`  To: ${this.currentRole}`)
    console.log(`  Reason: ${reason}`)
    console.log(`  Timestamp: ${event.timestamp.toISOString()}`)

    // Notify system (in production: send alerts)
    this.notifyRecovery(event)
  }

  /**
   * Get current role
   */
  getCurrentRole(): DatabaseRole {
    return this.currentRole
  }

  /**
   * Get current state
   */
  getCurrentState(): FailoverState {
    return this.currentState
  }

  /**
   * Get active database config
   */
  getActiveConfig(): DatabaseConfig {
    return this.currentRole === 'PRIMARY' ? this.primaryConfig : this.backupConfig
  }

  /**
   * Get failover statistics
   */
  getStats(): FailoverStats {
    const primaryChecks = this.healthChecks.get('PRIMARY') || []
    const backupChecks = this.healthChecks.get('BACKUP') || []

    const primaryHealthy = primaryChecks.filter((c) => c.isHealthy).length
    const backupHealthy = backupChecks.filter((c) => c.isHealthy).length

    const primaryHealthScore = primaryChecks.length > 0 ? (primaryHealthy / primaryChecks.length) * 100 : 100
    const backupHealthScore = backupChecks.length > 0 ? (backupHealthy / backupChecks.length) * 100 : 100

    const primaryUptime = this.lastFailoverTime
      ? `${Math.round((Date.now() - this.lastFailoverTime.getTime()) / 1000 / 60)} minutes down`
      : 'All up'
    const backupUptime = 'Standby'

    return {
      totalFailovers: this.stats.totalFailovers,
      totalRecoveries: this.stats.totalRecoveries,
      currentRole: this.currentRole,
      currentState: this.currentState,
      primaryHealthScore: Math.round(primaryHealthScore),
      backupHealthScore: Math.round(backupHealthScore),
      lastFailover: this.lastFailoverTime || undefined,
      lastRecovery: this.lastRecoveryTime || undefined,
      uptime: {
        primary: primaryUptime,
        backup: backupUptime,
      },
    }
  }

  /**
   * Print failover statistics
   */
  printStats(): void {
    const stats = this.getStats()

    console.log(`\n${'='.repeat(70)}`)
    console.log(`FAILOVER STATISTICS`)
    console.log(`${'='.repeat(70)}`)
    console.log(`Current role:                 ${stats.currentRole}`)
    console.log(`Current state:                ${stats.currentState}`)
    console.log(`\nFailover history:`)
    console.log(`  Total failovers:            ${stats.totalFailovers}`)
    console.log(`  Total recoveries:           ${stats.totalRecoveries}`)
    console.log(`  Last failover:              ${stats.lastFailover?.toISOString() || 'None'}`)
    console.log(`  Last recovery:              ${stats.lastRecovery?.toISOString() || 'None'}`)
    console.log(`\nHealth scores:`)
    console.log(`  Primary:                    ${stats.primaryHealthScore}%`)
    console.log(`  Backup:                     ${stats.backupHealthScore}%`)
    console.log(`\nUptime:`)
    console.log(`  Primary:                    ${stats.uptime.primary}`)
    console.log(`  Backup:                     ${stats.uptime.backup}`)
    console.log(`${'='.repeat(70)}\n`)
  }

  /**
   * Get failover history
   */
  getFailoverHistory(): FailoverEvent[] {
    return [...this.failoverHistory]
  }

  /**
   * Notify about failover (stub for production implementation)
   */
  private notifyFailover(event: FailoverEvent): void {
    // In production: send alerts to monitoring system, Slack, PagerDuty, etc.
    console.log(`[ALERT] Database failover: ${event.reason}`)
  }

  /**
   * Notify about recovery (stub for production implementation)
   */
  private notifyRecovery(event: FailoverEvent): void {
    // In production: send alerts to monitoring system, Slack, PagerDuty, etc.
    console.log(`[ALERT] Database recovery: ${event.reason}`)
  }
}

export default FailoverMechanism
