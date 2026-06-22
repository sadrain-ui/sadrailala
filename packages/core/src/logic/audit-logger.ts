// @ts-nocheck
/**
 * Audit Logger — comprehensive audit trail for all critical operations.
 */

export type AuditEntry = {
  id: string
  timestamp: number
  action: string
  actor?: string
  resource?: string
  result: 'success' | 'failure'
  details?: Record<string, unknown>
  error?: string
}

export class AuditLogger {
  private entries: AuditEntry[]
  private maxSize: number

  constructor(maxSize: number = 50000) {
    this.entries = []
    this.maxSize = maxSize
  }

  log(action: string, details: { actor?: string; resource?: string; result: 'success' | 'failure'; error?: string; data?: Record<string, unknown> }): string {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    const entry: AuditEntry = {
      id,
      timestamp: Date.now(),
      action,
      actor: details.actor,
      resource: details.resource,
      result: details.result,
      details: details.data,
      error: details.error,
    }

    this.entries.push(entry)

    if (this.entries.length > this.maxSize) {
      this.entries = this.entries.slice(-this.maxSize)
    }

    return id
  }

  logSuccess(action: string, actor?: string, resource?: string, data?: Record<string, unknown>): string {
    return this.log(action, { actor, resource, result: 'success', data })
  }

  logFailure(action: string, error: string, actor?: string, resource?: string): string {
    return this.log(action, { actor, resource, result: 'failure', error })
  }

  getEntries(filter?: { action?: string; result?: string; actor?: string }): AuditEntry[] {
    return this.entries.filter((entry) => {
      if (filter?.action && entry.action !== filter.action) return false
      if (filter?.result && entry.result !== filter.result) return false
      if (filter?.actor && entry.actor !== filter.actor) return false
      return true
    })
  }

  getEntry(id: string): AuditEntry | null {
    return this.entries.find((e) => e.id === id) ?? null
  }

  export(): AuditEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
  }
}

// Global singleton
let _instance: AuditLogger | null = null

export function getAuditLogger(): AuditLogger {
  if (!_instance) {
    _instance = new AuditLogger()
  }
  return _instance
}
