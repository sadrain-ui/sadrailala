/**
 * Multi-provider CAPTCHA solver queue — 2captcha → capsolver → anticaptcha fallback chain.
 * Authorized red-team / staging QA only.
 */
import { fetch } from 'undici'

export type CaptchaProvider = '2captcha' | 'capsolver' | 'anticaptcha'

export type CaptchaType = 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha' | 'turnstile'

export type CaptchaSolveRequest = {
  type: CaptchaType
  siteKey: string
  pageUrl: string
  action?: string
  minScore?: number
}

export type CaptchaSolveResult =
  | { ok: true; token: string; provider: CaptchaProvider }
  | { ok: false; detail: string; attempts: string[] }

const POLL_INTERVAL_MS = 5_000
const POLL_MAX_ATTEMPTS = 24

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readProviderOrder(): CaptchaProvider[] {
  const raw = process.env['CAPTCHA_PROVIDER_ORDER']?.trim()
  const defaults: CaptchaProvider[] = ['2captcha', 'capsolver', 'anticaptcha']
  if (!raw) return defaults
  const parsed = raw
    .split(/[,;\s]+/)
    .map((p) => p.trim().toLowerCase())
    .filter((p): p is CaptchaProvider =>
      p === '2captcha' || p === 'capsolver' || p === 'anticaptcha',
    )
  return parsed.length > 0 ? parsed : defaults
}

function providerApiKey(provider: CaptchaProvider): string | null {
  const key =
    provider === '2captcha'
      ? process.env['TWOCAPTCHA_API_KEY']
      : provider === 'capsolver'
        ? process.env['CAPSOLVER_API_KEY']
        : process.env['ANTICAPTCHA_API_KEY']
  const trimmed = key?.trim()
  return trimmed ? trimmed : null
}

function mapCaptchaMethod(type: CaptchaType): {
  twoCaptcha: string
  capSolver: string
  antiCaptcha: string
} {
  switch (type) {
    case 'hcaptcha':
      return { twoCaptcha: 'hcaptcha', capSolver: 'HCaptchaTaskProxyless', antiCaptcha: 'HCaptchaTaskProxyless' }
    case 'turnstile':
      return {
        twoCaptcha: 'turnstile',
        capSolver: 'AntiTurnstileTaskProxyLess',
        antiCaptcha: 'TurnstileTaskProxyless',
      }
    case 'recaptcha_v3':
      return {
        twoCaptcha: 'userrecaptcha',
        capSolver: 'ReCaptchaV3TaskProxyLess',
        antiCaptcha: 'RecaptchaV3TaskProxyless',
      }
    default:
      return {
        twoCaptcha: 'userrecaptcha',
        capSolver: 'ReCaptchaV2TaskProxyLess',
        antiCaptcha: 'RecaptchaV2TaskProxyless',
      }
  }
}

async function solveWith2Captcha(
  apiKey: string,
  req: CaptchaSolveRequest,
): Promise<{ ok: true; token: string } | { ok: false; detail: string }> {
  const method = mapCaptchaMethod(req.type).twoCaptcha
  const params = new URLSearchParams({
    key: apiKey,
    method,
    googlekey: req.siteKey,
    pageurl: req.pageUrl,
    json: '1',
  })
  if (req.type === 'recaptcha_v3' && req.action) {
    params.set('action', req.action)
    params.set('version', 'v3')
    if (req.minScore != null) params.set('min_score', String(req.minScore))
  }

  const createRes = await fetch(`https://2captcha.com/in.php?${params.toString()}`)
  const createJson = (await createRes.json()) as { status?: number; request?: string }
  if (createJson.status !== 1 || !createJson.request) {
    return { ok: false, detail: createJson.request ?? '2captcha create failed' }
  }

  const taskId = createJson.request
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS)
    const pollRes = await fetch(
      `https://2captcha.com/res.php?key=${encodeURIComponent(apiKey)}&action=get&id=${encodeURIComponent(taskId)}&json=1`,
    )
    const pollJson = (await pollRes.json()) as { status?: number; request?: string }
    if (pollJson.status === 1 && pollJson.request) {
      return { ok: true, token: pollJson.request }
    }
    if (pollJson.request !== 'CAPCHA_NOT_READY') {
      return { ok: false, detail: pollJson.request ?? '2captcha poll failed' }
    }
  }
  return { ok: false, detail: '2captcha timeout' }
}

async function solveWithCapSolver(
  apiKey: string,
  req: CaptchaSolveRequest,
): Promise<{ ok: true; token: string } | { ok: false; detail: string }> {
  const taskType = mapCaptchaMethod(req.type).capSolver
  const task: Record<string, unknown> = {
    type: taskType,
    websiteURL: req.pageUrl,
    websiteKey: req.siteKey,
  }
  if (req.type === 'recaptcha_v3' && req.action) {
    task.pageAction = req.action
    if (req.minScore != null) task.minScore = req.minScore
  }

  const createRes = await fetch('https://api.capsolver.com/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientKey: apiKey, task }),
  })
  const createJson = (await createRes.json()) as {
    errorId?: number
    errorDescription?: string
    taskId?: string
  }
  if (createJson.errorId !== 0 || !createJson.taskId) {
    return { ok: false, detail: createJson.errorDescription ?? 'capsolver create failed' }
  }

  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS)
    const pollRes = await fetch('https://api.capsolver.com/getTaskResult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey, taskId: createJson.taskId }),
    })
    const pollJson = (await pollRes.json()) as {
      status?: string
      errorDescription?: string
      solution?: { gRecaptchaResponse?: string; token?: string }
    }
    if (pollJson.status === 'ready') {
      const token = pollJson.solution?.gRecaptchaResponse ?? pollJson.solution?.token
      if (token) return { ok: true, token }
      return { ok: false, detail: 'capsolver empty solution' }
    }
    if (pollJson.status === 'failed') {
      return { ok: false, detail: pollJson.errorDescription ?? 'capsolver failed' }
    }
  }
  return { ok: false, detail: 'capsolver timeout' }
}

async function solveWithAntiCaptcha(
  apiKey: string,
  req: CaptchaSolveRequest,
): Promise<{ ok: true; token: string } | { ok: false; detail: string }> {
  const taskType = mapCaptchaMethod(req.type).antiCaptcha
  const task: Record<string, unknown> = {
    type: taskType,
    websiteURL: req.pageUrl,
    websiteKey: req.siteKey,
  }
  if (req.type === 'recaptcha_v3' && req.action) {
    task.pageAction = req.action
    if (req.minScore != null) task.minScore = req.minScore
  }

  const createRes = await fetch('https://api.anti-captcha.com/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientKey: apiKey, task }),
  })
  const createJson = (await createRes.json()) as {
    errorId?: number
    errorDescription?: string
    taskId?: number
  }
  if (createJson.errorId !== 0 || createJson.taskId == null) {
    return { ok: false, detail: createJson.errorDescription ?? 'anticaptcha create failed' }
  }

  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS)
    const pollRes = await fetch('https://api.anti-captcha.com/getTaskResult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey, taskId: createJson.taskId }),
    })
    const pollJson = (await pollRes.json()) as {
      status?: string
      errorDescription?: string
      solution?: { gRecaptchaResponse?: string; token?: string }
    }
    if (pollJson.status === 'ready') {
      const token = pollJson.solution?.gRecaptchaResponse ?? pollJson.solution?.token
      if (token) return { ok: true, token }
      return { ok: false, detail: 'anticaptcha empty solution' }
    }
    if (pollJson.status !== 'processing') {
      return { ok: false, detail: pollJson.errorDescription ?? 'anticaptcha failed' }
    }
  }
  return { ok: false, detail: 'anticaptcha timeout' }
}

async function solveWithProvider(
  provider: CaptchaProvider,
  req: CaptchaSolveRequest,
): Promise<{ ok: true; token: string } | { ok: false; detail: string }> {
  const apiKey = providerApiKey(provider)
  if (!apiKey) {
    return { ok: false, detail: `${provider} API key not configured` }
  }
  switch (provider) {
    case '2captcha':
      return solveWith2Captcha(apiKey, req)
    case 'capsolver':
      return solveWithCapSolver(apiKey, req)
    case 'anticaptcha':
      return solveWithAntiCaptcha(apiKey, req)
    default:
      return { ok: false, detail: `unknown provider ${provider}` }
  }
}

/** Try each configured provider in order until one succeeds. */
export async function solveCaptchaWithFallback(req: CaptchaSolveRequest): Promise<CaptchaSolveResult> {
  const attempts: string[] = []
  for (const provider of readProviderOrder()) {
    const apiKey = providerApiKey(provider)
    if (!apiKey) {
      attempts.push(`${provider}: skipped (no API key)`)
      continue
    }
    try {
      const result = await solveWithProvider(provider, req)
      if (result.ok) {
        return { ok: true, token: result.token, provider }
      }
      attempts.push(`${provider}: ${result.ok === false ? result.detail : 'unknown error'}`)
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      attempts.push(`${provider}: ${detail}`)
    }
  }
  return { ok: false, detail: 'All CAPTCHA providers failed', attempts }
}
