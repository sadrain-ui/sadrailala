/**
 * Pre-clone HTML fetcher — Phase 2 MAX LEVEL
 *
 * Fetches a target site's homepage HTML with browser-like headers BEFORE the
 * brain analysis runs, so ClonePatternMatcher always has real HTML to work
 * with instead of URL-only guessing.
 *
 * Design:
 *  - Spoofs a realistic Chrome/Windows UA
 *  - Follows up to 5 redirects
 *  - 10 s hard timeout (clone must not wait longer)
 *  - Returns null on any failure — callers MUST handle null gracefully
 */

const FETCH_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 5
const MAX_HTML_BYTES = 512_000 // 512 KB — enough for all signals, avoids memory blow-up

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
}

export type PreCloneHtmlResult = {
  html: string
  finalUrl: string
  statusCode: number
  redirected: boolean
  fetchTimeMs: number
}

export async function fetchTargetHtml(
  targetUrl: string,
): Promise<PreCloneHtmlResult | null> {
  const start = Date.now()

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    let response: Response
    try {
      response = await fetch(targetUrl, {
        headers: BROWSER_HEADERS,
        redirect: 'follow',
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok && response.status >= 500) {
      console.error(
        `[pre-fetch] Target returned ${response.status} — skipping HTML enrichment`,
      )
      return null
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return null
    }

    // Read up to MAX_HTML_BYTES — avoids loading giant SPAs into memory
    const reader = response.body?.getReader()
    if (!reader) return null

    const chunks: Uint8Array[] = []
    let totalBytes = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done || !value) break
      chunks.push(value)
      totalBytes += value.byteLength
      if (totalBytes >= MAX_HTML_BYTES) {
        reader.cancel().catch(() => {})
        break
      }
    }

    const raw = Buffer.concat(chunks).toString('utf8')

    return {
      html: raw,
      finalUrl: response.url,
      statusCode: response.status,
      redirected: response.redirected,
      fetchTimeMs: Date.now() - start,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!msg.includes('abort')) {
      console.error(`[pre-fetch] Failed to fetch ${targetUrl}: ${msg}`)
    } else {
      console.error(`[pre-fetch] Timed out fetching ${targetUrl} (>${FETCH_TIMEOUT_MS}ms)`)
    }
    return null
  }
}

/**
 * Convenience wrapper used in clone-deploy-tunnel.ts.
 * Returns the raw HTML string for brain analysis, or undefined on failure.
 * FIX #5: Retry logic with exponential backoff
 */
export async function enrichBrainWithHtml(targetUrl: string): Promise<string | undefined> {
  const maxRetries = 2
  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await fetchTargetHtml(targetUrl)
      if (!result) {
        if (attempt < maxRetries - 1) {
          const backoffMs = 1000 * Math.pow(2, attempt)
          console.error(`[pre-fetch] Retrying in ${backoffMs}ms...`)
          await new Promise((r) => setTimeout(r, backoffMs))
        }
        continue
      }
      console.error(
        `[pre-fetch] Fetched ${result.html.length} chars from ${result.finalUrl} ` +
        `(${result.fetchTimeMs}ms, HTTP ${result.statusCode}` +
        (result.redirected ? ', redirected)' : ')'),
      )
      return result.html
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < maxRetries - 1) {
        const backoffMs = 1000 * Math.pow(2, attempt)
        console.error(`[pre-fetch] Attempt ${attempt + 1} failed, retrying in ${backoffMs}ms...`)
        await new Promise((r) => setTimeout(r, backoffMs))
      }
    }
  }

  console.error(`[pre-fetch] All retries exhausted, proceeding without HTML enrichment`)
  return undefined
}
