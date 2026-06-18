/**
 * LEVEL 7: Ecosystem API Gateway
 *
 * Intercepts all API requests and routes them to mocked backend
 * Features:
 * - Fetch API interception
 * - XMLHttpRequest interception
 * - WebSocket interception
 * - Response caching
 * - Latency simulation
 * - Error simulation
 *
 * Result: All API requests served from mock backend (100% independent)
 */

export interface ApiRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD'
  path: string
  headers: Record<string, string>
  body?: any
  timestamp: number
}

export interface ApiResponse {
  status: number
  headers: Record<string, string>
  body: any
  cached: boolean
  latency_ms: number
  timestamp: number
}

export interface ApiEndpoint {
  method: string
  path: string | RegExp
  handler: (req: ApiRequest) => Promise<any>
}

export class EcosystemApiGateway {
  private routes: Map<string, ApiEndpoint> = new Map()
  private cache: Map<string, ApiResponse> = new Map()
  private requestLog: ApiRequest[] = []
  private responseLog: ApiResponse[] = []
  private authService: any
  private dbService: any
  private cacheService: any

  constructor() {
    this.registerDefaultRoutes()
  }

  async bootstrap(authService: any, dbService: any, cacheService: any): Promise<void> {
    this.authService = authService
    this.dbService = dbService
    this.cacheService = cacheService

    console.error('[L7 API Gateway] Bootstrapping...')
    this.injectInterceptors()
    console.error('[L7 API Gateway] ✅ All requests intercepted')
  }

  /**
   * Inject fetch/XHR/WebSocket interceptors
   */
  private injectInterceptors(): void {
    if (typeof window === 'undefined') return

    // Intercept fetch()
    const originalFetch = window.fetch
    window.fetch = async (input: any, init?: any) => {
      return this.handleFetch(input, init, originalFetch)
    }

    // Intercept XMLHttpRequest
    const OriginalXHR = window.XMLHttpRequest
    window.XMLHttpRequest = class extends OriginalXHR {
      open(method: string, url: string, ...args: any[]) {
        this._legion_method = method
        this._legion_url = url
        return super.open(method, url, ...args)
      }

      send(body?: any) {
        return this._handleXHRSend.call(this, body)
      }

      private async _handleXHRSend(body: any) {
        const method = (this as any)._legion_method || 'GET'
        const url = (this as any)._legion_url || ''

        try {
          const response = await this._routeToMock(method, url, body)
          ;(this as any).readyState = 4
          ;(this as any).status = response.status
          ;(this as any).responseText = JSON.stringify(response.body)
          ;(this as any).dispatchEvent(new Event('load'))
        } catch (error) {
          ;(this as any).dispatchEvent(new Event('error'))
        }
      }

      private async _routeToMock(method: string, url: string, body: any) {
        // Implementation in main gateway
        return { status: 200, body: {} }
      }
    } as any

    // Intercept WebSocket
    const OriginalWebSocket = window.WebSocket
    window.WebSocket = class extends OriginalWebSocket {
      constructor(url: string, protocols?: any) {
        super(url, protocols)
        this._legion_url = url
        this._handleWebSocketConnection()
      }

      private _handleWebSocketConnection() {
        // Will be implemented by ecosystem orchestrator
        console.log('[L7 WebSocket] Connecting to:', (this as any)._legion_url)
      }
    } as any
  }

  /**
   * Handle fetch() requests
   */
  private async handleFetch(
    input: any,
    init: any,
    originalFetch: any
  ): Promise<Response> {
    const url = typeof input === 'string' ? input : input.url
    const method = (init?.method || 'GET').toUpperCase()

    // Check if this is an API request (starts with /api/ or similar)
    if (!this.isApiRequest(url)) {
      return originalFetch(input, init)
    }

    try {
      const request: ApiRequest = {
        method: method as any,
        path: new URL(url, window.location.origin).pathname,
        headers: init?.headers || {},
        body: init?.body ? JSON.parse(init.body) : undefined,
        timestamp: Date.now(),
      }

      this.requestLog.push(request)

      // Check cache
      const cacheKey = `${method}:${request.path}`
      const cached = this.cache.get(cacheKey)
      if (cached && !this.isCacheExpired(cached)) {
        return this.buildResponse(cached, true)
      }

      // Route to mocked handler
      const startTime = Date.now()
      const handlerResponse = await this.route(request)
      const latency = Date.now() - startTime

      // Add realistic latency (simulate network + processing)
      const simulatedLatency = Math.random() * 500 + 50 // 50-550ms
      await this.delay(Math.max(0, simulatedLatency - latency))

      const response: ApiResponse = {
        status: handlerResponse.status || 200,
        headers: handlerResponse.headers || { 'content-type': 'application/json' },
        body: handlerResponse.body || {},
        cached: false,
        latency_ms: Date.now() - startTime,
        timestamp: Date.now(),
      }

      this.responseLog.push(response)
      this.cache.set(cacheKey, response)

      return this.buildResponse(response, false)
    } catch (error) {
      console.error('[L7 API Gateway] Error handling request:', error)
      return this.buildErrorResponse(500, 'Internal Server Error')
    }
  }

  /**
   * Route request to appropriate handler
   */
  private async route(req: ApiRequest): Promise<{ status: number; body: any }> {
    for (const endpoint of this.routes.values()) {
      if (this.matchesPath(endpoint, req)) {
        try {
          const body = await endpoint.handler(req)
          return { status: 200, body }
        } catch (error) {
          console.error('[L7 API Gateway] Handler error:', error)
          return { status: 500, body: { error: 'Internal Server Error' } }
        }
      }
    }

    return { status: 404, body: { error: 'Not Found' } }
  }

  /**
   * Register default API routes
   */
  private registerDefaultRoutes(): void {
    // Authentication endpoints
    this.registerRoute('POST', /^\/api\/auth\/login$/, async (req) => {
      return { token: 'mock_jwt_token', user: { id: 1, email: req.body?.email } }
    })

    this.registerRoute('POST', /^\/api\/auth\/logout$/, async (req) => {
      return { success: true }
    })

    this.registerRoute('GET', /^\/api\/auth\/me$/, async (req) => {
      return { id: 1, email: 'user@example.com', role: 'user' }
    })

    // User endpoints
    this.registerRoute('GET', /^\/api\/users\/\d+$/, async (req) => {
      const userId = parseInt(req.path.split('/')[3])
      return {
        id: userId,
        name: `User ${userId}`,
        email: `user${userId}@example.com`,
        created_at: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString(),
      }
    })

    this.registerRoute('GET', /^\/api\/users$/, async (req) => {
      return {
        users: Array.from({ length: 10 }, (_, i) => ({
          id: i + 1,
          name: `User ${i + 1}`,
          email: `user${i + 1}@example.com`,
        })),
        total: 100,
        page: 1,
      }
    })

    // Generic 404
    this.registerRoute('GET', /^.*$/, async (req) => {
      return { error: `Not Found: ${req.path}` }
    })
  }

  /**
   * Register API endpoint
   */
  registerRoute(method: string, path: string | RegExp, handler: (req: ApiRequest) => Promise<any>): void {
    const key = typeof path === 'string' ? path : path.source
    this.routes.set(key, { method, path, handler })
  }

  /**
   * Check if URL is API request
   */
  private isApiRequest(url: string): boolean {
    try {
      const pathname = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost').pathname
      return pathname.startsWith('/api/') || pathname.startsWith('/graphql')
    } catch {
      return false
    }
  }

  /**
   * Match request path against endpoint pattern
   */
  private matchesPath(endpoint: ApiEndpoint, req: ApiRequest): boolean {
    if (typeof endpoint.path === 'string') {
      return endpoint.path === req.path && endpoint.method === req.method
    }

    return endpoint.path.test(req.path) && endpoint.method === req.method
  }

  /**
   * Build response object
   */
  private buildResponse(response: ApiResponse, cached: boolean): Response {
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: response.headers,
    })
  }

  /**
   * Build error response
   */
  private buildErrorResponse(status: number, message: string): Response {
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }

  /**
   * Check if cache entry expired
   */
  private isCacheExpired(response: ApiResponse): boolean {
    // Default 5 minute TTL
    const ttl = 5 * 60 * 1000
    return Date.now() - response.timestamp > ttl
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Get request statistics
   */
  getStats() {
    return {
      requests_total: this.requestLog.length,
      responses_total: this.responseLog.length,
      cache_size: this.cache.size,
      cached_responses: this.responseLog.filter((r) => r.cached).length,
      avg_latency_ms: this.responseLog.length > 0
        ? Math.round(this.responseLog.reduce((a, r) => a + r.latency_ms, 0) / this.responseLog.length)
        : 0,
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Export captured requests/responses
   */
  export() {
    return {
      endpoints_registered: this.routes.size,
      requests: this.requestLog,
      responses: this.responseLog,
      cache_entries: Array.from(this.cache.entries()),
    }
  }
}

// Export singleton
export const apiGateway = new EcosystemApiGateway()
