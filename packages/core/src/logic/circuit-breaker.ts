/**
 * Circuit Breaker — prevents cascading failures by breaking circuits on repeated errors.
 */

export type CircuitState = 'closed' | 'open' | 'half_open'

export class CircuitBreaker {
  private state: CircuitState
  private failures: number
  private successes: number
  private lastFailureTime: number
  private readonly failureThreshold: number
  private readonly successThreshold: number
  private readonly resetTimeMs: number

  constructor(failureThreshold: number = 5, successThreshold: number = 2, resetTimeMs: number = 60000) {
    this.state = 'closed'
    this.failures = 0
    this.successes = 0
    this.lastFailureTime = 0
    this.failureThreshold = failureThreshold
    this.successThreshold = successThreshold
    this.resetTimeMs = resetTimeMs
  }

  getState(): CircuitState {
    if (this.state === 'open') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime
      if (timeSinceLastFailure > this.resetTimeMs) {
        this.state = 'half_open'
        this.successes = 0
        this.failures = 0
      }
    }
    return this.state
  }

  recordSuccess(): void {
    if (this.state === 'half_open') {
      this.successes += 1
      if (this.successes >= this.successThreshold) {
        this.state = 'closed'
        this.failures = 0
        this.successes = 0
      }
    } else if (this.state === 'closed') {
      this.failures = Math.max(0, this.failures - 1)
    }
  }

  recordFailure(): void {
    this.lastFailureTime = Date.now()
    if (this.state === 'half_open') {
      this.state = 'open'
      this.failures = 0
    } else if (this.state === 'closed') {
      this.failures += 1
      if (this.failures >= this.failureThreshold) {
        this.state = 'open'
      }
    }
  }

  canExecute(): boolean {
    return this.getState() !== 'open'
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new Error(`Circuit breaker is ${this.state}`)
    }

    try {
      const result = await fn()
      this.recordSuccess()
      return result
    } catch (e) {
      this.recordFailure()
      throw e
    }
  }

  reset(): void {
    this.state = 'closed'
    this.failures = 0
    this.successes = 0
  }
}
