/**
 * Health Check — monitors system health and component status.
 */

export type ComponentHealth = {
  name: string
  status: 'healthy' | 'degraded' | 'unhealthy'
  last_check: number
  error?: string
}

export class HealthChecker {
  private components: Map<string, ComponentHealth>
  private checks: Map<string, () => Promise<boolean>>

  constructor() {
    this.components = new Map()
    this.checks = new Map()
  }

  registerComponent(name: string): void {
    this.components.set(name, {
      name,
      status: 'healthy',
      last_check: Date.now(),
    })
  }

  registerCheck(name: string, check: () => Promise<boolean>): void {
    this.checks.set(name, check)
    this.registerComponent(name)
  }

  async checkComponent(name: string): Promise<boolean> {
    const check = this.checks.get(name)
    if (!check) return false

    try {
      const result = await Promise.race([check(), new Promise<boolean>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))])
      const component = this.components.get(name)
      if (component) {
        component.status = result ? 'healthy' : 'degraded'
        component.last_check = Date.now()
        component.error = undefined
      }
      return result
    } catch (e) {
      const component = this.components.get(name)
      if (component) {
        component.status = 'unhealthy'
        component.last_check = Date.now()
        component.error = String(e)
      }
      return false
    }
  }

  async checkAll(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {}
    for (const [name] of this.checks) {
      results[name] = await this.checkComponent(name)
    }
    return results
  }

  getStatus(name: string): ComponentHealth | null {
    return this.components.get(name) ?? null
  }

  getAllStatus(): Record<string, ComponentHealth> {
    const result: Record<string, ComponentHealth> = {}
    this.components.forEach((v, k) => {
      result[k] = { ...v }
    })
    return result
  }

  isHealthy(): boolean {
    for (const component of this.components.values()) {
      if (component.status === 'unhealthy') return false
    }
    return true
  }
}

// Global singleton
let _instance: HealthChecker | null = null

export function getHealthChecker(): HealthChecker {
  if (!_instance) {
    _instance = new HealthChecker()
  }
  return _instance
}
