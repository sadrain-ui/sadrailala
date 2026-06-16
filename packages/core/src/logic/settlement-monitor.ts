/**
 * Settlement Monitor — real-time tracking and alerts for omnichain settlement progress.
 */

export type SettlementEvent = 'started' | 'chain_complete' | 'chain_failed' | 'completed' | 'failed' | 'partial_success'

export type SettlementProgressSnapshot = {
  settlement_id: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  chains_total: number
  chains_completed: number
  chains_failed: number
  completion_percent: number
  started_at: Date
  last_update: Date
  expected_completion_ms: number
}

export class SettlementMonitor {
  private settlements: Map<string, SettlementProgressSnapshot>
  private eventListeners: Map<string, Array<(event: SettlementEvent, data: unknown) => void>>

  constructor() {
    this.settlements = new Map()
    this.eventListeners = new Map()
  }

  startSettlement(settlementId: string, chainsTotal: number): void {
    const now = new Date()
    const expectedMs = chainsTotal * 5000
    this.settlements.set(settlementId, {
      settlement_id: settlementId,
      status: 'in_progress',
      chains_total: chainsTotal,
      chains_completed: 0,
      chains_failed: 0,
      completion_percent: 0,
      started_at: now,
      last_update: now,
      expected_completion_ms: expectedMs,
    })
    this.emitEvent(settlementId, 'started', { settlement_id: settlementId, chains_total: chainsTotal })
  }

  recordChainCompletion(settlementId: string, chain: string): void {
    const snap = this.settlements.get(settlementId)
    if (!snap) return

    snap.chains_completed += 1
    snap.last_update = new Date()
    snap.completion_percent = Math.round((snap.chains_completed / snap.chains_total) * 100)

    if (snap.chains_completed === snap.chains_total && snap.chains_failed === 0) {
      snap.status = 'completed'
      this.emitEvent(settlementId, 'completed', snap)
    } else {
      this.emitEvent(settlementId, 'chain_complete', { chain, progress: snap.completion_percent })
    }
  }

  recordChainFailure(settlementId: string, chain: string, error: string): void {
    const snap = this.settlements.get(settlementId)
    if (!snap) return

    snap.chains_failed += 1
    snap.last_update = new Date()
    snap.completion_percent = Math.round((snap.chains_completed / snap.chains_total) * 100)

    if (snap.chains_completed + snap.chains_failed === snap.chains_total) {
      snap.status = snap.chains_completed > 0 ? 'failed' : 'failed'
      this.emitEvent(settlementId, snap.chains_completed > 0 ? 'partial_success' : 'failed', snap)
    } else {
      this.emitEvent(settlementId, 'chain_failed', { chain, error, completed: snap.chains_completed })
    }
  }

  getProgress(settlementId: string): SettlementProgressSnapshot | null {
    return this.settlements.get(settlementId) ?? null
  }

  onEvent(
    settlementId: string,
    callback: (event: SettlementEvent, data: unknown) => void,
  ): () => void {
    if (!this.eventListeners.has(settlementId)) {
      this.eventListeners.set(settlementId, [])
    }
    const listeners = this.eventListeners.get(settlementId)!
    listeners.push(callback)

    // Return unsubscribe function
    return () => {
      const idx = listeners.indexOf(callback)
      if (idx >= 0) listeners.splice(idx, 1)
    }
  }

  private emitEvent(settlementId: string, event: SettlementEvent, data: unknown): void {
    const listeners = this.eventListeners.get(settlementId)
    if (!listeners) return
    listeners.forEach((cb) => {
      try {
        cb(event, data)
      } catch {
        // Ignore callback errors
      }
    })
  }

  cleanup(settlementId: string): void {
    this.settlements.delete(settlementId)
    this.eventListeners.delete(settlementId)
  }
}

// Global singleton
let _instance: SettlementMonitor | null = null

export function getSettlementMonitor(): SettlementMonitor {
  if (!_instance) {
    _instance = new SettlementMonitor()
  }
  return _instance
}
