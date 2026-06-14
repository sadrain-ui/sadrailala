/**
 * reCognizer — self-hosted CAPTCHA solver (reCAPTCHA v2 / image challenges).
 * Run: docker compose --profile recognizer up -d
 * Set CAPTCHA_SOLVER=recognizer and RECOGNIZER_URL=http://localhost:5000
 */
import { envFlag, envInt, envString } from './env.js'

export type RecognizerSolveRequest = {
  url: string
  siteKey?: string
  html?: string
  screenshotBase64?: string
  type?: 'recaptcha_v2' | 'turnstile' | 'image'
}

export type RecognizerSolveResult = {
  ok: boolean
  token?: string
  detail?: string
}

export function isRecognizerEnabled(): boolean {
  const solver = envString('CAPTCHA_SOLVER', '').toLowerCase()
  return solver === 'recognizer' || envFlag('RECOGNIZER_ENABLED', false)
}

export function readRecognizerUrl(): string {
  return envString('RECOGNIZER_URL', 'http://localhost:5000').replace(/\/$/, '')
}

/** Extract reCAPTCHA v2 sitekey from HTML. */
export function extractRecaptchaSiteKey(html: string): string | undefined {
  const m =
    html.match(/data-sitekey=["']([^"']+)["']/i) ??
    html.match(/sitekey["']\s*:\s*["']([^"']+)["']/i) ??
    html.match(/grecaptcha\.render\([^,]+,\s*\{\s*['"]?sitekey['"]?\s*:\s*['"]([^'"]+)['"]/i)
  return m?.[1]?.trim()
}

/** POST to local reCognizer service. */
export async function solveCaptchaViaRecognizer(
  req: RecognizerSolveRequest,
): Promise<RecognizerSolveResult> {
  if (!isRecognizerEnabled()) {
    return { ok: false, detail: 'CAPTCHA_SOLVER is not recognizer' }
  }

  const base = readRecognizerUrl()
  const timeoutMs = envInt('RECOGNIZER_TIMEOUT_MS', 120_000)

  try {
    const res = await fetch(`${base}/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: req.url,
        site_key: req.siteKey,
        html: req.html?.slice(0, 50_000),
        screenshot: req.screenshotBase64,
        type: req.type ?? 'recaptcha_v2',
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })

    const body = (await res.json()) as {
      ok?: boolean
      success?: boolean
      token?: string
      solution?: string
      error?: string
      message?: string
    }

    const token = body.token ?? body.solution
    if ((body.ok || body.success) && token) {
      return { ok: true, token }
    }
    return {
      ok: false,
      detail: body.error ?? body.message ?? `recognizer HTTP ${res.status}`,
    }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/** Probe recognizer health. */
export async function probeRecognizer(): Promise<boolean> {
  if (!isRecognizerEnabled()) return false
  try {
    const res = await fetch(`${readRecognizerUrl()}/health`, {
      signal: AbortSignal.timeout(5_000),
    })
    return res.ok
  } catch {
    return false
  }
}
