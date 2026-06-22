// @ts-nocheck
/**
 * State Recovery — save and restore execution state for crash recovery.
 */

export type ExecutionCheckpoint = {
  id: string
  operation_id: string
  state: Record<string, unknown>
  timestamp: number
  expires_at: number
}

export class StateRecovery {
  private checkpoints: Map<string, ExecutionCheckpoint>
  private ttlMs: number

  constructor(ttlMs: number = 3600000) {
    this.checkpoints = new Map()
    this.ttlMs = ttlMs
  }

  saveCheckpoint(operationId: string, state: Record<string, unknown>): string {
    const now = Date.now()
    const id = `${operationId}_${now}`

    const checkpoint: ExecutionCheckpoint = {
      id,
      operation_id: operationId,
      state: { ...state },
      timestamp: now,
      expires_at: now + this.ttlMs,
    }

    this.checkpoints.set(id, checkpoint)
    return id
  }

  getCheckpoint(id: string): ExecutionCheckpoint | null {
    const checkpoint = this.checkpoints.get(id)
    if (!checkpoint) return null

    const now = Date.now()
    if (now > checkpoint.expires_at) {
      this.checkpoints.delete(id)
      return null
    }

    return checkpoint
  }

  getLatestCheckpoint(operationId: string): ExecutionCheckpoint | null {
    let latest: ExecutionCheckpoint | null = null

    for (const checkpoint of this.checkpoints.values()) {
      if (checkpoint.operation_id === operationId) {
        const now = Date.now()
        if (now > checkpoint.expires_at) {
          this.checkpoints.delete(checkpoint.id)
        } else if (!latest || checkpoint.timestamp > latest.timestamp) {
          latest = checkpoint
        }
      }
    }

    return latest
  }

  deleteCheckpoint(id: string): void {
    this.checkpoints.delete(id)
  }

  deleteAllCheckpoints(operationId: string): void {
    const toDelete: string[] = []
    for (const [id, checkpoint] of this.checkpoints) {
      if (checkpoint.operation_id === operationId) {
        toDelete.push(id)
      }
    }
    toDelete.forEach((id) => this.checkpoints.delete(id))
  }

  cleanup(): void {
    const now = Date.now()
    const toDelete: string[] = []

    for (const [id, checkpoint] of this.checkpoints) {
      if (now > checkpoint.expires_at) {
        toDelete.push(id)
      }
    }

    toDelete.forEach((id) => this.checkpoints.delete(id))
  }

  getStats(): { total_checkpoints: number } {
    this.cleanup()
    return { total_checkpoints: this.checkpoints.size }
  }
}

// Global singleton
let _instance: StateRecovery | null = null

export function getStateRecovery(): StateRecovery {
  if (!_instance) {
    _instance = new StateRecovery()
  }
  return _instance
}
