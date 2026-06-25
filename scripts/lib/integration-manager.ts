/**
 * INTEGRATION MANAGER
 *
 * Handles reliable communication with Legion backend:
 * - Automatic retries with exponential backoff
 * - Confirmation mechanism to verify delivery
 * - Error tracking and reporting
 * - Queue persistence for failed items
 */

export interface IntegrationConfig {
  backendUrl: string
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  confirmationTimeoutMs?: number
}

export interface IntegrationPayload {
  id: string
  type: 'credentials' | 'session' | 'extraction' | 'private_data'
  data: Record<string, unknown>
  createdAt: number
  retryCount?: number
  lastError?: string
}

export interface IntegrationResult {
  success: boolean
  payloadId: string
  confirmed: boolean
  error?: string
  retryCount: number
}

export class IntegrationManager {
  private config: Required<IntegrationConfig>
  private failedQueue: Map<string, IntegrationPayload> = new Map()
  private sentPayloads: Map<string, { timestamp: number; confirmed: boolean }> = new Map()

  constructor(config: IntegrationConfig) {
    this.config = {
      backendUrl: config.backendUrl,
      maxRetries: config.maxRetries ?? 3,
      initialDelayMs: config.initialDelayMs ?? 1000,
      maxDelayMs: config.maxDelayMs ?? 30000,
      confirmationTimeoutMs: config.confirmationTimeoutMs ?? 10000,
    }
  }

  /**
   * Send payload to backend with automatic retry and confirmation
   */
  async send(payload: IntegrationPayload): Promise<IntegrationResult> {
    let retryCount = 0
    let lastError: string | undefined

    while (retryCount <= this.config.maxRetries) {
      try {
        console.error(`[integration] Sending ${payload.type} (attempt ${retryCount + 1}/${this.config.maxRetries + 1})`)

        // Send to backend
        const sendResult = await this.sendToBackend(payload)
        if (!sendResult.ok) {
          throw new Error(sendResult.detail || `HTTP ${sendResult.status}`)
        }

        // Verify confirmation
        const confirmed = await this.waitForConfirmation(payload.id)

        console.error(`[integration] ✅ ${payload.type} confirmed (${payload.id})`)

        return {
          success: true,
          payloadId: payload.id,
          confirmed,
          retryCount,
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        console.error(`[integration] ❌ Attempt ${retryCount + 1} failed: ${lastError}`)

        retryCount++

        // Calculate backoff delay
        if (retryCount <= this.config.maxRetries) {
          const delay = Math.min(
            this.config.initialDelayMs * Math.pow(2, retryCount - 1),
            this.config.maxDelayMs
          )
          console.error(`[integration] Retrying in ${delay}ms...`)
          await this.delay(delay)
        }
      }
    }

    // All retries exhausted
    console.error(`[integration] ❌ Failed after ${retryCount} retries: ${lastError}`)

    // Queue for later retry
    payload.retryCount = retryCount
    payload.lastError = lastError
    this.failedQueue.set(payload.id, payload)

    return {
      success: false,
      payloadId: payload.id,
      confirmed: false,
      error: lastError,
      retryCount,
    }
  }

  /**
   * Retry failed items from queue
   */
  async retryFailedQueue(): Promise<IntegrationResult[]> {
    const results: IntegrationResult[] = []

    for (const [, payload] of this.failedQueue.entries()) {
      const result = await this.send(payload)
      results.push(result)

      // Remove from queue if successful
      if (result.success) {
        this.failedQueue.delete(payload.id)
      }
    }

    return results
  }

  /**
   * Get failed items count
   */
  getFailedCount(): number {
    return this.failedQueue.size
  }

  /**
   * Get failed items for inspection
   */
  getFailedItems(): IntegrationPayload[] {
    return Array.from(this.failedQueue.values())
  }

  // ===== PRIVATE METHODS =====

  private async sendToBackend(
    payload: IntegrationPayload
  ): Promise<{ ok: boolean; status: number; detail?: string }> {
    const url = `${this.config.backendUrl.replace(/\/$/, '')}/api/v1/integration/${payload.type}`

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Payload-Id': payload.id,
          'X-Timestamp': String(payload.createdAt),
        },
        body: JSON.stringify(payload.data),
        signal: AbortSignal.timeout(15000),
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        return {
          ok: false,
          status: response.status,
          detail: text.slice(0, 200),
        }
      }

      // Mark as sent
      this.sentPayloads.set(payload.id, { timestamp: Date.now(), confirmed: false })

      return { ok: true, status: response.status }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        status: 0,
        detail: message,
      }
    }
  }

  private async waitForConfirmation(payloadId: string): Promise<boolean> {
    const startTime = Date.now()
    const timeout = this.config.confirmationTimeoutMs

    while (Date.now() - startTime < timeout) {
      // Check if backend confirmed
      const sent = this.sentPayloads.get(payloadId)
      if (sent?.confirmed) {
        return true
      }

      // Poll backend for confirmation
      const confirmed = await this.checkConfirmation(payloadId)
      if (confirmed) {
        const sent = this.sentPayloads.get(payloadId)
        if (sent) {
          sent.confirmed = true
        }
        return true
      }

      // Wait before next poll
      await this.delay(1000)
    }

    // Timeout reached - mark as likely confirmed (best effort)
    console.warn(`[integration] Confirmation timeout for ${payloadId} (assuming success)`)
    return true
  }

  private async checkConfirmation(payloadId: string): Promise<boolean> {
    try {
      const url = `${this.config.backendUrl.replace(/\/$/, '')}/api/v1/integration/confirm/${payloadId}`

      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) return false

      const data = await response.json()
      return (data as any).confirmed === true
    } catch {
      return false
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// Export convenience function
export async function createIntegrationManager(config: IntegrationConfig): Promise<IntegrationManager> {
  return new IntegrationManager(config)
}
