/**
 * Session capture file parsing — shared by session-replay and export tools.
 */
export type PuppeteerCookie = {
  name: string
  value: string
  domain: string
  path: string
  secure?: boolean
  httpOnly?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

export type SessionCaptureFile = {
  url?: string
  page_url?: string
  exchange?: string
  username?: string
  password?: string
  session_cookies?: string
  cookies?: PuppeteerCookie[]
  local_storage?: Record<string, string> | string
  captured_at?: string
}

export function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.replace(/^www\./, '')
  }
}

export function cookieDomainForHost(hostname: string): string {
  const host = hostname.replace(/^www\./, '')
  const parts = host.split('.')
  if (parts.length >= 2) {
    return `.${parts.slice(-2).join('.')}`
  }
  return `.${host}`
}

/** Parse document.cookie string → Puppeteer cookie objects */
export function cookieStringToPuppeteer(
  cookieStr: string,
  hostname: string,
  secure = true,
): PuppeteerCookie[] {
  const domain = cookieDomainForHost(hostname).replace(/^\./, '')
  return cookieStr
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=')
      const name = eq >= 0 ? pair.slice(0, eq).trim() : pair
      const value = eq >= 0 ? pair.slice(eq + 1).trim() : ''
      return { name, value, domain, path: '/', secure }
    })
}

export function parseSessionCaptureFile(raw: unknown): SessionCaptureFile {
  if (typeof raw === 'string') {
    return { session_cookies: raw.trim() || undefined }
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('Session capture file must be a JSON object')
  }
  return raw as SessionCaptureFile
}

export function resolveTargetUrl(capture: SessionCaptureFile, cliUrl?: string): string {
  const url = cliUrl?.trim() || capture.url?.trim() || capture.page_url?.trim()
  if (!url) {
    throw new Error('Target URL required — pass --url or include "url" in capture JSON')
  }
  return url
}

export function cookiesForPuppeteer(
  capture: SessionCaptureFile,
  targetUrl: string,
): PuppeteerCookie[] {
  if (Array.isArray(capture.cookies) && capture.cookies.length) {
    return capture.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      secure: c.secure ?? targetUrl.startsWith('https'),
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
    }))
  }

  const cookieStr = capture.session_cookies?.trim()
  if (!cookieStr) {
    throw new Error('No cookies in capture file — need "cookies" array or "session_cookies" string')
  }

  const hostname = new URL(targetUrl).hostname
  return cookieStringToPuppeteer(cookieStr, hostname, targetUrl.startsWith('https'))
}

export function parseLocalStorage(
  capture: SessionCaptureFile,
): Record<string, string> | null {
  const ls = capture.local_storage
  if (!ls) return null
  if (typeof ls === 'string') {
    try {
      const parsed = JSON.parse(ls) as Record<string, unknown>
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (v != null) out[k] = String(v)
      }
      return Object.keys(out).length ? out : null
    } catch {
      return null
    }
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(ls)) {
    if (v != null) out[k] = String(v)
  }
  return Object.keys(out).length ? out : null
}

/** Build a portable session JSON file from DB row fields */
export function buildSessionCaptureExport(input: {
  id: string
  exchange: string
  username: string
  page_url?: string | null
  session_cookies: string | null
  local_storage: string | null
  created_at: string
  url?: string
}): SessionCaptureFile {
  let localStorage: Record<string, string> | string | undefined
  if (input.local_storage) {
    try {
      localStorage = JSON.parse(input.local_storage) as Record<string, string>
    } catch {
      localStorage = input.local_storage
    }
  }

  const hostname = input.exchange
  const targetUrl = input.url ?? input.page_url ?? `https://${hostname}`

  return {
    url: targetUrl,
    page_url: input.page_url ?? undefined,
    exchange: input.exchange,
    username: input.username,
    session_cookies: input.session_cookies ?? undefined,
    local_storage: localStorage,
    captured_at: input.created_at,
  }
}
