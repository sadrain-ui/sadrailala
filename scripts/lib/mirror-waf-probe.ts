/**
 * WAF bypass probe — curl-impersonate (JA3), proxy pool, 2captcha challenge solve, headless fallback.
 */
import { parseProxyList, pickRotatingFetchHeaders } from './training-clone-features.js'
import { cloneJa3Fetch, isCloneJa3ChromeEnabled } from './clone-ja3-fetch.js'
import { extractTurnstileSiteKey, solveTurnstileVia2Captcha } from './mirror-captcha.js'

export type WafProbeResult = {
  ok: boolean
  status: number
  html?: string
  transport?: string
  usedProxy?: boolean
  usedCaptcha?: boolean
  usedHeadless?: boolean
  challenge?: boolean
  cookies?: string
  detail?: string
}

const CHALLENGE_BODY_MARKERS = [
  'cf-challenge',
  'challenge-platform',
  'cf-turnstile',
  'turnstile',
  'g-recaptcha',
  'hcaptcha',
  'captcha',
  'gokuprops',
  'just a moment',
  'checking your browser',
  'aws-waf',
]

const CHALLENGE_STATUS_CODES = new Set([403, 429, 503])
const CHALLENGE_EMPTY_STATUS = 202
const CHALLENGE_EMPTY_MAX_BYTES = 1024

function headerValue(headers: Headers, name: string): string {
  return headers.get(name)?.toLowerCase() ?? ''
}

/** True when the response looks like a WAF / bot challenge (not real page content). */
export function isChallengeResponse(
  status: number,
  body: string,
  headers?: Headers | Record<string, string>,
): boolean {
  const bodyLen = Buffer.byteLength(body, 'utf8')
  if (CHALLENGE_STATUS_CODES.has(status)) return true
  if (status === CHALLENGE_EMPTY_STATUS && bodyLen < CHALLENGE_EMPTY_MAX_BYTES) return true

  const hdrs =
    headers instanceof Headers
      ? headers
      : new Headers(headers ?? {})

  const server = headerValue(hdrs, 'server')
  if (server.includes('cloudflare') && bodyLen < CHALLENGE_EMPTY_MAX_BYTES) return true

  const lower = body.toLowerCase()
  return CHALLENGE_BODY_MARKERS.some((m) => lower.includes(m))
}

function looksLikeChallenge(html: string, status: number, headers?: Headers): boolean {
  return isChallengeResponse(status, html, headers)
}

export { extractTurnstileSiteKey, solveTurnstileVia2Captcha } from './mirror-captcha.js'

async function fetchWithProxy(url: string, _proxyUrl: string, cookieHeader?: string): Promise<Response> {
  const headers: Record<string, string> = {
    ...pickRotatingFetchHeaders(),
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  }
  return fetch(url, { headers, signal: AbortSignal.timeout(30_000) })
}

function buildFetchHeaders(cookieHeader?: string): Record<string, string> {
  return {
    ...pickRotatingFetchHeaders(),
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  }
}

async function attemptTurnstileRetry(
  url: string,
  html: string,
  transport: string,
  cookieHeader?: string,
): Promise<WafProbeResult | null> {
  const siteKey = extractTurnstileSiteKey(html)
  const token = await solveTurnstileVia2Captcha(siteKey ?? '', url)
  if (!token) return null

  const retry = await fetch(url, {
    headers: {
      ...buildFetchHeaders(cookieHeader),
      'cf-turnstile-response': token,
    },
    signal: AbortSignal.timeout(30_000),
  })
  const retryHtml = await retry.text()
  if (retry.ok && !looksLikeChallenge(retryHtml, retry.status, retry.headers)) {
    return {
      ok: true,
      status: retry.status,
      html: retryHtml,
      transport,
      usedCaptcha: true,
      cookies: cookieHeader,
    }
  }
  return null
}

export type WafProbeOptions = {
  cookieHeader?: string
}

export async function probeTargetWithWafBypass(
  target: URL,
  opts?: WafProbeOptions,
): Promise<WafProbeResult> {
  const url = target.href
  const cookieHeader = opts?.cookieHeader?.trim()
  const proxies = parseProxyList()
  const useJa3 = isCloneJa3ChromeEnabled() || process.env['MIRROR_WAF_BYPASS'] === 'true'

  const attempts: Array<() => Promise<WafProbeResult>> = []

  if (useJa3) {
    attempts.push(async () => {
      const res = await cloneJa3Fetch(
        url,
        { timeoutMs: 30_000, headers: cookieHeader ? { Cookie: cookieHeader } : undefined },
      )
      const html = await res.text()
      const challenge = looksLikeChallenge(html, res.status, res.headers)
      return {
        ok: res.ok && !challenge,
        status: res.status,
        html,
        transport: 'curl-impersonate',
        challenge,
        cookies: cookieHeader,
      }
    })
  }

  attempts.push(async () => {
    const res = await fetch(url, {
      headers: buildFetchHeaders(cookieHeader),
      signal: AbortSignal.timeout(30_000),
    })
    const html = await res.text()
    const challenge = looksLikeChallenge(html, res.status, res.headers)
    return {
      ok: res.ok && !challenge,
      status: res.status,
      html,
      transport: 'fetch',
      challenge,
      cookies: cookieHeader,
    }
  })

  for (const proxy of proxies.slice(0, 3)) {
    attempts.push(async () => {
      const res = await fetchWithProxy(url, proxy, cookieHeader)
      const html = await res.text()
      const challenge = looksLikeChallenge(html, res.status, res.headers)
      return {
        ok: res.ok && !challenge,
        status: res.status,
        html,
        transport: 'proxy',
        usedProxy: true,
        challenge,
        cookies: cookieHeader,
      }
    })
  }

  let lastResult: WafProbeResult = { ok: false, status: 0, detail: 'WAF probe failed on all transports' }

  for (const attempt of attempts) {
    try {
      const result = await attempt()
      lastResult = result
      if (result.ok) return result

      if (result.html && result.challenge) {
        const captchaRetry = await attemptTurnstileRetry(
          url,
          result.html,
          result.transport ?? 'fetch',
          cookieHeader,
        )
        if (captchaRetry?.ok) return captchaRetry
      }
    } catch {
      /* try next transport */
    }
  }

  return lastResult
}
