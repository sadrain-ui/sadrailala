/**
 * FlareSolverr — Cloudflare / DDoS-Guard challenge bypass via HTTP API.
 * Docker: ghcr.io/flaresolverr/flaresolverr:latest (port 8191)
 */
import { envFlag, envInt, envString } from './env.js'

export type FlareSolverrResult = {
  ok: boolean
  html?: string
  cookies?: string
  userAgent?: string
  status?: number
  detail?: string
}

export function isFlareSolverrEnabled(): boolean {
  return envFlag('FLARESOLVERR_ENABLED', false)
}

export function readFlareSolverrApiUrl(): string {
  const base = envString('FLARESOLVERR_URL', 'http://localhost:8191').replace(/\/$/, '')
  return base.endsWith('/v1') ? base : `${base}/v1`
}

function cookiesToHeader(cookies: unknown): string | undefined {
  if (!Array.isArray(cookies)) return undefined
  const parts: string[] = []
  for (const c of cookies) {
    if (c && typeof c === 'object' && 'name' in c && 'value' in c) {
      const name = String((c as { name: unknown }).name)
      const value = String((c as { value: unknown }).value)
      if (name) parts.push(`${name}=${value}`)
    }
  }
  return parts.length ? parts.join('; ') : undefined
}

/** Apply FlareSolverr cookies/UA to process env for nginx/static generation. */
export function applyFlareSolverrContext(result: FlareSolverrResult): void {
  if (result.cookies) process.env['MIRROR_PROXY_COOKIES'] = result.cookies
  if (result.userAgent) process.env['MIRROR_PROXY_USER_AGENT'] = result.userAgent
}

/** Pre-fetch target via FlareSolverr (used before reverse proxy). */
export async function prefetchTargetViaFlareSolverr(
  targetUrl: string,
): Promise<FlareSolverrResult> {
  if (!isFlareSolverrEnabled()) {
    return { ok: false, detail: 'FLARESOLVERR_ENABLED is false' }
  }
  console.error('[clone-tunnel] [flare] Prefetch via FlareSolverr…')
  const result = await fetchViaFlareSolverr(targetUrl)
  if (result.ok) applyFlareSolverrContext(result)
  else console.error(`[clone-tunnel] [flare] Prefetch failed: ${result.detail ?? 'unknown'}`)
  return result
}

export async function probeFlareSolverr(): Promise<boolean> {
  if (!isFlareSolverrEnabled()) return false
  try {
    const res = await fetch(readFlareSolverrApiUrl(), {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Fetch target URL through FlareSolverr request.get. */
export async function fetchViaFlareSolverr(url: string): Promise<FlareSolverrResult> {
  if (!isFlareSolverrEnabled()) {
    return { ok: false, detail: 'FLARESOLVERR_ENABLED is false' }
  }

  const apiUrl = readFlareSolverrApiUrl()
  const maxTimeout = envInt('FLARESOLVERR_MAX_TIMEOUT_MS', 60_000)

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cmd: 'request.get',
        url,
        maxTimeout,
      }),
      signal: AbortSignal.timeout(maxTimeout + 15_000),
    })

    const body = (await res.json()) as {
      status?: string
      message?: string
      solution?: {
        status?: number
        response?: string
        cookies?: unknown[]
        userAgent?: string
        url?: string
      }
    }

    if (body.status !== 'ok' || !body.solution) {
      return {
        ok: false,
        detail: body.message ?? `FlareSolverr status=${String(body.status)}`,
      }
    }

    const html = body.solution.response
    if (!html || typeof html !== 'string') {
      return { ok: false, detail: 'FlareSolverr returned empty HTML' }
    }

    return {
      ok: true,
      html,
      cookies: cookiesToHeader(body.solution.cookies),
      userAgent: body.solution.userAgent,
      status: body.solution.status ?? 200,
    }
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}
