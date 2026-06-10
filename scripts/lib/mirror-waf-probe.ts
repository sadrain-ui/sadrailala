/**
 * WAF bypass probe — curl-impersonate (JA3), proxy pool, 2captcha challenge solve.
 */
import { parseProxyList, pickRotatingFetchHeaders } from './training-clone-features.js'
import { cloneJa3Fetch, isCloneJa3ChromeEnabled } from './clone-ja3-fetch.js'

export type WafProbeResult = {
  ok: boolean
  status: number
  html?: string
  transport?: string
  usedProxy?: boolean
  usedCaptcha?: boolean
  detail?: string
}

const CHALLENGE_MARKERS = [
  'cf-challenge',
  'challenge-platform',
  'cf-turnstile',
  'g-recaptcha',
  'hcaptcha',
  'just a moment',
  'checking your browser',
]

function looksLikeChallenge(html: string, status: number): boolean {
  if (status === 403 || status === 503) return true
  const lower = html.toLowerCase()
  return CHALLENGE_MARKERS.some((m) => lower.includes(m))
}

async function solveTurnstileVia2Captcha(siteKey: string, pageUrl: string): Promise<string | null> {
  const apiKey = process.env['TWOCAPTCHA_API_KEY']?.trim()
  if (!apiKey || !siteKey) return null

  const createRes = await fetch('https://2captcha.com/in.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      key: apiKey,
      method: 'turnstile',
      sitekey: siteKey,
      pageurl: pageUrl,
      json: '1',
    }),
  })
  const createJson = (await createRes.json()) as { status?: number; request?: string }
  if (createJson.status !== 1 || !createJson.request) return null
  const taskId = createJson.request

  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5_000))
    const pollRes = await fetch(
      `https://2captcha.com/res.php?key=${encodeURIComponent(apiKey)}&action=get&id=${encodeURIComponent(taskId)}&json=1`,
    )
    const pollJson = (await pollRes.json()) as { status?: number; request?: string }
    if (pollJson.status === 1 && pollJson.request) return pollJson.request
    if (pollJson.request && pollJson.request !== 'CAPCHA_NOT_READY') break
  }
  return null
}

function extractTurnstileSiteKey(html: string): string | null {
  const m =
    html.match(/data-sitekey=["']([^"']+)["']/i) ||
    html.match(/sitekey["']?\s*[:=]\s*["']([^"']+)["']/i)
  return m?.[1]?.trim() ?? null
}

async function fetchWithProxy(url: string, proxyUrl: string): Promise<Response> {
  const headers = pickRotatingFetchHeaders()
  return fetch(url, { headers, signal: AbortSignal.timeout(30_000) })
}

export async function probeTargetWithWafBypass(target: URL): Promise<WafProbeResult> {
  const url = target.href
  const proxies = parseProxyList()
  const useJa3 = isCloneJa3ChromeEnabled() || process.env['MIRROR_WAF_BYPASS'] === 'true'

  const attempts: Array<() => Promise<WafProbeResult>> = []

  if (useJa3) {
    attempts.push(async () => {
      const res = await cloneJa3Fetch(url, { timeoutMs: 30_000 })
      const html = await res.text()
      return {
        ok: res.ok && !looksLikeChallenge(html, res.status),
        status: res.status,
        html,
        transport: 'curl-impersonate',
      }
    })
  }

  attempts.push(async () => {
    const headers = pickRotatingFetchHeaders()
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) })
    const html = await res.text()
    return { ok: res.ok && !looksLikeChallenge(html, res.status), status: res.status, html, transport: 'fetch' }
  })

  for (const proxy of proxies.slice(0, 3)) {
    attempts.push(async () => {
      const res = await fetchWithProxy(url, proxy)
      const html = await res.text()
      return {
        ok: res.ok && !looksLikeChallenge(html, res.status),
        status: res.status,
        html,
        transport: 'proxy',
        usedProxy: true,
      }
    })
  }

  for (const attempt of attempts) {
    try {
      const result = await attempt()
      if (result.ok) return result

      if (result.html && looksLikeChallenge(result.html, result.status)) {
        const siteKey = extractTurnstileSiteKey(result.html)
        const token = await solveTurnstileVia2Captcha(siteKey ?? '', url)
        if (token) {
          const retry = await fetch(url, {
            headers: {
              ...pickRotatingFetchHeaders(),
              'cf-turnstile-response': token,
            },
            signal: AbortSignal.timeout(30_000),
          })
          const html = await retry.text()
          if (retry.ok && !looksLikeChallenge(html, retry.status)) {
            return {
              ok: true,
              status: retry.status,
              html,
              transport: result.transport,
              usedCaptcha: true,
            }
          }
        }
      }
    } catch (e) {
      /* try next transport */
    }
  }

  return { ok: false, status: 0, detail: 'WAF probe failed on all transports' }
}
