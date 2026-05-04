/**
 * Environment Fingerprinting — Gatekeeper surface scan for automation sandboxes,
 * headless runtimes, and institutional research tooling (Puppeteer / Playwright-class hosts).
 */

export type EnvironmentFingerprintSignal =
  | 'WEBDRIVER_SURFACE'
  | 'HEADLESS_USER_AGENT'
  | 'AUTOMATION_CHROME_GAP'
  | 'PLUGIN_SURFACE_ANOMALY'
  | 'PERMISSIONS_OVERRIDE_PROBE'
  | 'WEBGL_VENDOR_ANOMALY'
  | 'SERVER_INGRESS_AUTOMATION'

export type EnvironmentFingerprintResult = {
  /** True → render Institutional Landing Page (non-operational decoy). */
  requiresInstitutionalDecoy: boolean
  signals: EnvironmentFingerprintSignal[]
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined'
}

function uaLooksHeadlessOrAutomation(ua: string): boolean {
  const u = ua.toLowerCase()
  return (
    u.includes('headless') ||
    u.includes('puppeteer') ||
    u.includes('playwright') ||
    u.includes('phantomjs') ||
    u.includes('selenium') ||
    u.includes('webdriver')
  )
}

/**
 * Client-side Environment Fingerprinting — synchronous heuristics only.
 * Combine with `/api/environment-intel` for ingress-layer corroboration.
 */
export function runEnvironmentFingerprinting(): EnvironmentFingerprintResult {
  const signals: EnvironmentFingerprintSignal[] = []

  if (!isBrowser()) {
    return { requiresInstitutionalDecoy: false, signals }
  }

  const nav = navigator as Navigator & {
    webdriver?: boolean
    plugins?: { length: number }
    languages?: readonly string[]
  }

  if (nav.webdriver === true) {
    signals.push('WEBDRIVER_SURFACE')
  }

  const ua = typeof nav.userAgent === 'string' ? nav.userAgent : ''
  if (uaLooksHeadlessOrAutomation(ua)) {
    signals.push('HEADLESS_USER_AGENT')
  }

  // Chromium automation often lacks `window.chrome` while UA claims Chrome.
  const claimsChrome = /chrome/i.test(ua) && !/edg/i.test(ua)
  if (claimsChrome && typeof (window as unknown as { chrome?: unknown }).chrome === 'undefined') {
    signals.push('AUTOMATION_CHROME_GAP')
  }

  try {
    const plugins = nav.plugins?.length ?? 0
    if (claimsChrome && plugins === 0 && ua.length > 0 && nav.webdriver === true) {
      signals.push('PLUGIN_SURFACE_ANOMALY')
    }
  } catch {
    /* non-fatal */
  }

  try {
    const canvas = document.createElement('canvas')
    const glRaw = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl')
    const gl = glRaw as WebGLRenderingContext | null
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    if (ext && gl) {
      const vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)
      const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      const bundle = `${vendor} ${renderer}`.toLowerCase()
      if (bundle.includes('swiftshader') || bundle.includes('llvmpipe') || bundle.includes('mesa')) {
        signals.push('WEBGL_VENDOR_ANOMALY')
      }
    }
  } catch {
    /* non-fatal */
  }

  return {
    requiresInstitutionalDecoy: signals.length > 0,
    signals,
  }
}

function headerLooksAutomation(ua: string | null): boolean {
  if (ua == null || ua.trim() === '') return true
  return uaLooksHeadlessOrAutomation(ua)
}

/**
 * Server-side Environment Fingerprinting — Request ingress automation / research tooling sweep.
 * Hybrid Layer: complements client {@link runEnvironmentFingerprinting}.
 */
export function assessServerSideEnvironmentFingerprint(req: Request): EnvironmentFingerprintResult {
  const signals: EnvironmentFingerprintSignal[] = []
  const ua = req.headers.get('user-agent')
  if (headerLooksAutomation(ua)) {
    signals.push('SERVER_INGRESS_AUTOMATION')
  }
  return {
    requiresInstitutionalDecoy: signals.length > 0,
    signals,
  }
}
