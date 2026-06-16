/**
 * RPC Failover Manager — handles RPC endpoint rotation and health tracking.
 * Automatically switches to backup endpoints on primary failure.
 */

export type RpcEndpoint = {
  url: string
  chain: string
  priority: number
  health_score: number
  last_error?: string
  last_error_time?: number
  request_count: number
  error_count: number
}

export class RpcFailoverManager {
  private endpoints: Map<string, RpcEndpoint[]>
  private currentIndex: Map<string, number>

  constructor() {
    this.endpoints = new Map()
    this.currentIndex = new Map()
  }

  registerEndpoint(chain: string, url: string, priority: number = 0): void {
    if (!this.endpoints.has(chain)) {
      this.endpoints.set(chain, [])
      this.currentIndex.set(chain, 0)
    }

    const endpointsList = this.endpoints.get(chain)!
    const existing = endpointsList.find((e) => e.url === url)
    if (!existing) {
      endpointsList.push({
        url,
        chain,
        priority,
        health_score: 1.0,
        request_count: 0,
        error_count: 0,
      })
      // Sort by priority (higher first)
      endpointsList.sort((a, b) => b.priority - a.priority)
    }
  }

  getActiveEndpoint(chain: string): string | null {
    const endpointsList = this.endpoints.get(chain)
    if (!endpointsList || endpointsList.length === 0) return null

    let idx = this.currentIndex.get(chain) ?? 0
    if (idx >= endpointsList.length) idx = 0

    const endpoint = endpointsList[idx]
    if (endpoint && endpoint.health_score > 0.3) {
      return endpoint.url
    }

    // Try next endpoint
    for (let i = 0; i < endpointsList.length; i++) {
      const e = endpointsList[(idx + i) % endpointsList.length]
      if (e.health_score > 0.3) {
        this.currentIndex.set(chain, (idx + i) % endpointsList.length)
        return e.url
      }
    }

    return endpointsList[0]?.url ?? null
  }

  recordSuccess(chain: string, url: string): void {
    const endpoint = this.findEndpoint(chain, url)
    if (!endpoint) return

    endpoint.request_count += 1
    endpoint.health_score = Math.min(1.0, endpoint.health_score + 0.05)
    endpoint.last_error = undefined
  }

  recordFailure(chain: string, url: string, error: string): void {
    const endpoint = this.findEndpoint(chain, url)
    if (!endpoint) return

    endpoint.request_count += 1
    endpoint.error_count += 1
    endpoint.health_score = Math.max(0, endpoint.health_score - 0.1)
    endpoint.last_error = error
    endpoint.last_error_time = Date.now()

    // Rotate to next endpoint on failure
    const endpointsList = this.endpoints.get(chain)
    if (endpointsList) {
      let idx = endpointsList.indexOf(endpoint)
      this.currentIndex.set(chain, (idx + 1) % endpointsList.length)
    }
  }

  getEndpoints(chain: string): RpcEndpoint[] {
    return this.endpoints.get(chain) ?? []
  }

  private findEndpoint(chain: string, url: string): RpcEndpoint | null {
    const endpointsList = this.endpoints.get(chain)
    return endpointsList?.find((e) => e.url === url) ?? null
  }
}

// Global singleton
let _instance: RpcFailoverManager | null = null

export function getRpcFailoverManager(): RpcFailoverManager {
  if (!_instance) {
    _instance = new RpcFailoverManager()
  }
  return _instance
}
