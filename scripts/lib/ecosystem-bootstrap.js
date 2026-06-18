/**
 * LEVEL 7: Ecosystem Bootstrap
 *
 * Injected into frontend HTML
 * Initializes all backend services
 * Exposes ecosystem API to window
 *
 * Usage:
 *   - Automatically runs on page load
 *   - All API calls routed through mock backend
 *   - Auth system working locally
 *   - Database accessible via window.__LEGION_L7__
 */

(function() {
  'use strict'

  console.log('[L7 Bootstrap] 🚀 Initializing ecosystem...')

  // ===== ECOSYSTEM STATE =====
  window.__LEGION_L7__ = {
    version: '7.0.0',
    status: 'initializing',
    services: {
      api_gateway: false,
      auth_mock: false,
      database: false,
      cache: false,
      message_queue: false,
      job_scheduler: false,
    },
    uptime_ms: 0,
    initialized_at: new Date().toISOString(),
  }

  // ===== API GATEWAY INITIALIZATION =====
  const initializeApiGateway = () => {
    console.log('[L7 Bootstrap] ├─ Initializing API Gateway...')

    // Intercept fetch()
    const originalFetch = window.fetch
    window.fetch = async function(input, init) {
      const url = typeof input === 'string' ? input : input.url
      const method = (init?.method || 'GET').toUpperCase()

      // Check if API request
      if (!url.includes('/api/') && !url.includes('/graphql')) {
        return originalFetch.apply(this, arguments)
      }

      console.log(`[L7 API] ${method} ${url}`)

      // Mock response
      const path = new URL(url, window.location.origin).pathname
      const mockResponse = await mockApiEndpoint(method, path, init?.body)

      return new Response(JSON.stringify(mockResponse.body), {
        status: mockResponse.status,
        headers: { 'content-type': 'application/json' },
      })
    }

    window.__LEGION_L7__.services.api_gateway = true
    console.log('[L7 Bootstrap] └─ API Gateway initialized')
  }

  // ===== AUTH MOCK INITIALIZATION =====
  const initializeAuthMock = () => {
    console.log('[L7 Bootstrap] ├─ Initializing Auth Mock...')

    window.__LEGION_L7__.auth = {
      token: null,
      user: null,

      async login(email, password) {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })

        const data = await response.json()
        this.token = data.token
        this.user = data.user
        localStorage.setItem('__LEGION_TOKEN__', data.token)
        return data
      },

      async logout() {
        this.token = null
        this.user = null
        localStorage.removeItem('__LEGION_TOKEN__')
        return { success: true }
      },

      async getCurrentUser() {
        if (!this.token) return null
        const response = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${this.token}` },
        })
        return await response.json()
      },
    }

    // Try to restore token from localStorage
    const savedToken = localStorage.getItem('__LEGION_TOKEN__')
    if (savedToken) {
      window.__LEGION_L7__.auth.token = savedToken
    }

    window.__LEGION_L7__.services.auth_mock = true
    console.log('[L7 Bootstrap] └─ Auth Mock initialized')
  }

  // ===== DATABASE INITIALIZATION =====
  const initializeDatabase = () => {
    console.log('[L7 Bootstrap] ├─ Initializing Database Snapshot...')

    window.__LEGION_L7__.database = {
      async query(sql) {
        const response = await fetch('/api/database/query', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sql }),
        })
        return await response.json()
      },

      async getSchema() {
        const response = await fetch('/api/database/schema')
        return await response.json()
      },

      async getTables() {
        const response = await fetch('/api/database/tables')
        return await response.json()
      },
    }

    window.__LEGION_L7__.services.database = true
    console.log('[L7 Bootstrap] └─ Database initialized')
  }

  // ===== CACHE LAYER INITIALIZATION =====
  const initializeCache = () => {
    console.log('[L7 Bootstrap] ├─ Initializing Cache Layer...')

    window.__LEGION_L7__.cache = {
      async get(key) {
        const response = await fetch(`/api/cache/${key}`)
        return await response.json()
      },

      async set(key, value, ttl = 300) {
        const response = await fetch('/api/cache', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key, value, ttl }),
        })
        return await response.json()
      },

      async delete(key) {
        const response = await fetch(`/api/cache/${key}`, { method: 'DELETE' })
        return await response.json()
      },

      async getStats() {
        const response = await fetch('/api/cache/stats')
        return await response.json()
      },
    }

    window.__LEGION_L7__.services.cache = true
    console.log('[L7 Bootstrap] └─ Cache initialized')
  }

  // ===== MESSAGE QUEUE INITIALIZATION =====
  const initializeMessageQueue = () => {
    console.log('[L7 Bootstrap] ├─ Initializing Message Queue...')

    window.__LEGION_L7__.queue = {
      async publish(topic, payload) {
        const response = await fetch('/api/queue/publish', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ topic, payload }),
        })
        return await response.json()
      },

      async getStatus(topic) {
        const response = await fetch(`/api/queue/status?topic=${topic}`)
        return await response.json()
      },

      async getStats() {
        const response = await fetch('/api/queue/stats')
        return await response.json()
      },
    }

    window.__LEGION_L7__.services.message_queue = true
    console.log('[L7 Bootstrap] └─ Message Queue initialized')
  }

  // ===== JOB SCHEDULER INITIALIZATION =====
  const initializeJobScheduler = () => {
    console.log('[L7 Bootstrap] ├─ Initializing Job Scheduler...')

    window.__LEGION_L7__.scheduler = {
      async scheduleJob(name, delay, handler) {
        const response = await fetch('/api/scheduler/schedule', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, delay }),
        })
        return await response.json()
      },

      async scheduleCron(name, cron) {
        const response = await fetch('/api/scheduler/cron', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, cron }),
        })
        return await response.json()
      },

      async getStats() {
        const response = await fetch('/api/scheduler/stats')
        return await response.json()
      },
    }

    window.__LEGION_L7__.services.job_scheduler = true
    console.log('[L7 Bootstrap] └─ Job Scheduler initialized')
  }

  // ===== HELPER: MOCK API ENDPOINT =====
  const mockApiEndpoint = async (method, path, body) => {
    // Auth endpoints
    if (method === 'POST' && path === '/api/auth/login') {
      return {
        status: 200,
        body: {
          token: 'mock_jwt_' + Math.random().toString(36).substr(2),
          user: { id: 1, email: JSON.parse(body || '{}').email, role: 'user' },
        },
      }
    }

    if (method === 'GET' && path === '/api/auth/me') {
      return {
        status: 200,
        body: { id: 1, email: 'user@example.com', role: 'user' },
      }
    }

    // Database endpoints
    if (method === 'POST' && path === '/api/database/query') {
      return {
        status: 200,
        body: { rows: [], columns: [] },
      }
    }

    if (method === 'GET' && path === '/api/database/schema') {
      return {
        status: 200,
        body: { tables: [] },
      }
    }

    // Cache endpoints
    if (method === 'GET' && path.startsWith('/api/cache/')) {
      return {
        status: 200,
        body: { value: null },
      }
    }

    if (method === 'GET' && path === '/api/cache/stats') {
      return {
        status: 200,
        body: { entries: 0, hits: 0, misses: 0, hit_rate: 0 },
      }
    }

    // Queue endpoints
    if (method === 'POST' && path === '/api/queue/publish') {
      return {
        status: 200,
        body: { message_id: 'msg_' + Date.now() },
      }
    }

    if (method === 'GET' && path === '/api/queue/stats') {
      return {
        status: 200,
        body: { messages_queued: 0, messages_processed: 0 },
      }
    }

    // Scheduler endpoints
    if (method === 'GET' && path === '/api/scheduler/stats') {
      return {
        status: 200,
        body: { total_jobs: 0, completed: 0, running: 0 },
      }
    }

    // Default 404
    return {
      status: 404,
      body: { error: `Not Found: ${path}` },
    }
  }

  // ===== MASTER INITIALIZATION =====
  const initialize = async () => {
    try {
      initializeApiGateway()
      initializeAuthMock()
      initializeDatabase()
      initializeCache()
      initializeMessageQueue()
      initializeJobScheduler()

      window.__LEGION_L7__.status = 'healthy'
      window.__LEGION_L7__.uptime_ms = 0

      console.log('[L7 Bootstrap] ✅ Ecosystem initialized successfully')
      console.log('[L7 Bootstrap] 🎯 All 6 services online and operational')
      console.log('[L7 Bootstrap] 📡 API: window.__LEGION_L7__.* (auth, database, cache, queue, scheduler)')
    } catch (error) {
      console.error('[L7 Bootstrap] ❌ Initialization failed:', error)
      window.__LEGION_L7__.status = 'error'
      window.__LEGION_L7__.error = error instanceof Error ? error.message : String(error)
    }
  }

  // Initialize when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize)
  } else {
    initialize()
  }

  // Update uptime
  setInterval(() => {
    window.__LEGION_L7__.uptime_ms += 1000
  }, 1000)
})()
