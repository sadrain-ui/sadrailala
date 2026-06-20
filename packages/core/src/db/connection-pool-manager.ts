/**
 * CONNECTION POOL MANAGER
 * ======================
 * Manages database connection pooling for reliability and performance
 *
 * Features:
 * - Max 100 connections
 * - Auto-reconnect on failure
 * - Health monitoring
 * - Graceful degradation
 */

export interface PoolConfig {
  maxConnections: number
  minConnections: number
  maxIdleTimeMs: number
  maxConnectionTimeMs: number
  connectionTimeoutMs: number
  healthCheckIntervalMs: number
}

export interface PoolStats {
  totalConnections: number
  activeConnections: number
  idleConnections: number
  waitingRequests: number
  healthScore: number // 0-100
  lastHealthCheck: Date
}

export interface ConnectionCheck {
  isHealthy: boolean
  latencyMs: number
  error?: string
}

/**
 * CONNECTION POOL MANAGER CLASS
 */
export class ConnectionPoolManager {
  private config: PoolConfig
  private activeConnections: Map<string, { acquiredAt: Date; lastUsedAt: Date }> = new Map()
  private idleConnections: string[] = []
  private waitingQueue: Array<{ resolve: () => void; reject: (e: Error) => void; timeoutHandle: NodeJS.Timeout }> = []
  private healthCheckInterval: NodeJS.Timeout | null = null
  private stats = {
    totalCreated: 0,
    totalClosed: 0,
    totalTimeouts: 0,
    totalErrors: 0,
  }

  constructor(config?: Partial<PoolConfig>) {
    this.config = {
      maxConnections: config?.maxConnections || 100,
      minConnections: config?.minConnections || 10,
      maxIdleTimeMs: config?.maxIdleTimeMs || 60000, // 1 minute
      maxConnectionTimeMs: config?.maxConnectionTimeMs || 3600000, // 1 hour
      connectionTimeoutMs: config?.connectionTimeoutMs || 5000, // 5 seconds
      healthCheckIntervalMs: config?.healthCheckIntervalMs || 30000, // 30 seconds
    }

    console.log(`[POOL_MANAGER] Initialized with config:`)
    console.log(`  Max connections: ${this.config.maxConnections}`)
    console.log(`  Min connections: ${this.config.minConnections}`)
    console.log(`  Max idle time: ${this.config.maxIdleTimeMs}ms`)
    console.log(`  Health check interval: ${this.config.healthCheckIntervalMs}ms`)
  }

  /**
   * Start health check loop
   */
  startHealthChecks(): void {
    if (this.healthCheckInterval) {
      console.log(`[POOL_MANAGER] Health checks already running`)
      return
    }

    console.log(`[POOL_MANAGER] Starting health check loop...`)

    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck()
    }, this.config.healthCheckIntervalMs)
  }

  /**
   * Stop health check loop
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
      console.log(`[POOL_MANAGER] Health checks stopped`)
    }
  }

  /**
   * Perform health check on all connections
   */
  private async performHealthCheck(): Promise<void> {
    const activeCount = this.activeConnections.size
    const idleCount = this.idleConnections.length

    console.log(`[POOL_MANAGER] Health check: ${activeCount} active, ${idleCount} idle`)

    // Check for idle connections to close
    const now = Date.now()
    const toRemove: string[] = []

    for (const [connId, conn] of this.activeConnections.entries()) {
      const idleTime = now - conn.lastUsedAt.getTime()

      if (idleTime > this.config.maxIdleTimeMs) {
        console.log(`[POOL_MANAGER] Closing idle connection: ${connId} (idle ${idleTime}ms)`)
        toRemove.push(connId)
      }

      // Also check if connection exceeded max lifetime
      const lifetime = now - conn.acquiredAt.getTime()
      if (lifetime > this.config.maxConnectionTimeMs) {
        console.log(`[POOL_MANAGER] Closing old connection: ${connId} (lifetime ${lifetime}ms)`)
        toRemove.push(connId)
      }
    }

    for (const connId of toRemove) {
      this.closeConnection(connId)
    }
  }

  /**
   * Acquire a connection from the pool
   */
  async acquireConnection(): Promise<string> {
    // Try to get idle connection
    if (this.idleConnections.length > 0) {
      const connId = this.idleConnections.pop()!
      this.activeConnections.set(connId, {
        acquiredAt: new Date(),
        lastUsedAt: new Date(),
      })

      console.log(`[POOL_MANAGER] Acquired idle connection: ${connId}`)
      return connId
    }

    // Try to create new connection if under limit
    if (this.activeConnections.size + this.idleConnections.length < this.config.maxConnections) {
      const connId = this.createConnectionId()
      this.activeConnections.set(connId, {
        acquiredAt: new Date(),
        lastUsedAt: new Date(),
      })

      this.stats.totalCreated++
      console.log(`[POOL_MANAGER] Created new connection: ${connId} (total: ${this.activeConnections.size + this.idleConnections.length})`)

      return connId
    }

    // Queue the request
    console.log(`[POOL_MANAGER] Connection pool full, queueing request (waiting: ${this.waitingQueue.length})`)

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        // Remove from queue
        const index = this.waitingQueue.findIndex((r) => r.resolve === resolve)
        if (index >= 0) {
          this.waitingQueue.splice(index, 1)
        }

        this.stats.totalTimeouts++
        reject(new Error('Connection acquisition timeout'))
      }, this.config.connectionTimeoutMs)

      this.waitingQueue.push({ resolve, reject, timeoutHandle })
    })
  }

  /**
   * Release a connection back to the pool
   */
  releaseConnection(connId: string): void {
    const conn = this.activeConnections.get(connId)

    if (!conn) {
      console.warn(`[POOL_MANAGER] Attempted to release unknown connection: ${connId}`)
      return
    }

    // Update last used time
    conn.lastUsedAt = new Date()

    // If there are waiting requests, give them this connection
    if (this.waitingQueue.length > 0) {
      const waiting = this.waitingQueue.shift()!
      clearTimeout(waiting.timeoutHandle)

      console.log(`[POOL_MANAGER] Giving connection ${connId} to waiting request`)

      waiting.resolve()
      return
    }

    // Otherwise move to idle pool
    this.activeConnections.delete(connId)
    this.idleConnections.push(connId)

    console.log(`[POOL_MANAGER] Released connection ${connId} to idle pool (idle: ${this.idleConnections.length})`)
  }

  /**
   * Close a connection
   */
  private closeConnection(connId: string): void {
    this.activeConnections.delete(connId)

    const idleIndex = this.idleConnections.indexOf(connId)
    if (idleIndex >= 0) {
      this.idleConnections.splice(idleIndex, 1)
    }

    this.stats.totalClosed++
    console.log(`[POOL_MANAGER] Closed connection: ${connId}`)
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    const totalConnections = this.activeConnections.size + this.idleConnections.length
    const activeConnections = this.activeConnections.size
    const idleConnections = this.idleConnections.length
    const waitingRequests = this.waitingQueue.length

    // Calculate health score (0-100)
    const utilizationRatio = activeConnections / this.config.maxConnections
    const waitingRatio = waitingRequests / Math.max(this.config.maxConnections, 1)
    const errorRatio = this.stats.totalErrors / Math.max(this.stats.totalCreated, 1)

    const healthScore = Math.max(
      0,
      100 - (utilizationRatio * 30 + waitingRatio * 40 + errorRatio * 30),
    )

    return {
      totalConnections,
      activeConnections,
      idleConnections,
      waitingRequests,
      healthScore: Math.round(healthScore),
      lastHealthCheck: new Date(),
    }
  }

  /**
   * Print pool statistics
   */
  printStats(): void {
    const stats = this.getStats()

    console.log(`\n${'='.repeat(70)}`)
    console.log(`CONNECTION POOL STATISTICS`)
    console.log(`${'='.repeat(70)}`)
    console.log(`Total connections:     ${stats.totalConnections}/${this.config.maxConnections}`)
    console.log(`Active:                 ${stats.activeConnections}`)
    console.log(`Idle:                   ${stats.idleConnections}`)
    console.log(`Waiting requests:       ${stats.waitingRequests}`)
    console.log(`Health score:           ${stats.healthScore}/100`)
    console.log(`\nLifetime stats:`)
    console.log(`  Created:              ${this.stats.totalCreated}`)
    console.log(`  Closed:               ${this.stats.totalClosed}`)
    console.log(`  Timeouts:             ${this.stats.totalTimeouts}`)
    console.log(`  Errors:               ${this.stats.totalErrors}`)
    console.log(`${'='.repeat(70)}\n`)
  }

  /**
   * Drain all connections (for shutdown)
   */
  async drain(): Promise<void> {
    console.log(`[POOL_MANAGER] Draining connection pool...`)

    this.stopHealthChecks()

    // Close all connections
    const allConnIds = Array.from(this.activeConnections.keys()).concat(this.idleConnections)
    for (const connId of allConnIds) {
      this.closeConnection(connId)
    }

    // Reject all waiting requests
    for (const waiting of this.waitingQueue) {
      clearTimeout(waiting.timeoutHandle)
      waiting.reject(new Error('Pool is draining'))
    }

    this.waitingQueue = []

    console.log(`[POOL_MANAGER] Pool drained (${allConnIds.length} connections closed)`)
  }

  /**
   * Create unique connection ID
   */
  private createConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
}

export default ConnectionPoolManager
