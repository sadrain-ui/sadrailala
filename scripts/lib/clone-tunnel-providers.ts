/**
 * Multi-provider public tunnel — cloudflared → ngrok → localtunnel → localhost.run → bore (+ DuckDNS).
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  readTunnelMaxRestarts,
  verifyPublicTunnelUrl,
} from './clone-tunnel-resilience.js'
import { hasDuckDnsConfig, resolveDuckDnsMirrorUrl } from './clone-tunnel-dns.js'

export type QuickTunnelProvider =
  | 'cloudflared'
  | 'ngrok'
  | 'localtunnel'
  | 'localhost.run'
  | 'bore'

export type MirrorUrlCache = {
  url: string
  provider: string
  port: number
  createdAt: string
}

const TUNNEL_TIMEOUT_MS = 45_000
const NGROK_API = 'http://127.0.0.1:4040/api/tunnels'

const TRYCF_URL_PRIMARY = /(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/i
const NGROK_URL_RE =
  /(https:\/\/[a-z0-9][-a-z0-9]*\.(?:ngrok-free\.app|ngrok\.io|ngrok-free\.dev|ngrok\.app))/i
const LOCALTUNNEL_URL_RE =
  /(https:\/\/[a-z0-9][-a-z0-9]*\.(?:loca\.lt|localtunnel\.me))/i
const LOCALHOST_RUN_URL_RE =
  /(https:\/\/[a-z0-9][-a-z0-9]*\.(?:lhr\.life|localhost\.run))/gi
const BORE_URL_RE = /(https?:\/\/bore\.pub:\d+)/i
const BORE_LISTEN_RE = /listening at bore\.pub:(\d+)/i

const NGROK_DOWNLOAD: Record<string, { url: string; archive: 'zip' | 'tgz'; binary: string }> = {
  win32: {
    url: 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip',
    archive: 'zip',
    binary: 'ngrok.exe',
  },
  linux: {
    url: 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz',
    archive: 'tgz',
    binary: 'ngrok',
  },
  darwin: {
    url: 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-darwin-amd64.zip',
    archive: 'zip',
    binary: 'ngrok',
  },
}

const BORE_DOWNLOAD: Record<string, { url: string; archive: 'zip' | 'tgz'; binary: string }> = {
  win32: {
    url: 'https://github.com/ekzhang/bore/releases/download/v0.6.0/bore-v0.6.0-x86_64-pc-windows-msvc.zip',
    archive: 'zip',
    binary: 'bore.exe',
  },
  linux: {
    url: 'https://github.com/ekzhang/bore/releases/download/v0.6.0/bore-v0.6.0-x86_64-unknown-linux-musl.tar.gz',
    archive: 'tgz',
    binary: 'bore',
  },
  darwin: {
    url: 'https://github.com/ekzhang/bore/releases/download/v0.6.0/bore-v0.6.0-x86_64-apple-darwin.tar.gz',
    archive: 'tgz',
    binary: 'bore',
  },
}

const ALL_PROVIDERS = new Set<QuickTunnelProvider>([
  'cloudflared',
  'ngrok',
  'localtunnel',
  'localhost.run',
  'bore',
])

let activeTunnelPid: number | undefined
let activeTunnelKind: QuickTunnelProvider | undefined

export function resolveQuickTunnelProviders(): QuickTunnelProvider[] {
  const raw = process.env['CLONE_TUNNEL_PROVIDERS']?.trim()
  const defaultOrder: QuickTunnelProvider[] = [
    'cloudflared',
    'ngrok',
    'localtunnel',
    'localhost.run',
    'bore',
  ]
  if (!raw) return defaultOrder
  const parsed = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is QuickTunnelProvider => ALL_PROVIDERS.has(s as QuickTunnelProvider))
  return parsed.length > 0 ? parsed : defaultOrder
}

export function mirrorUrlCachePath(outDir: string): string {
  return path.join(outDir, '.mirror-url')
}

export async function readCachedMirrorUrl(
  outDir: string,
  port: number,
): Promise<MirrorUrlCache | null> {
  const cachePath = mirrorUrlCachePath(outDir)
  if (!existsSync(cachePath)) return null
  try {
    const raw = await readFile(cachePath, 'utf8')
    const parsed = JSON.parse(raw) as MirrorUrlCache
    if (!parsed.url || parsed.port !== port) return null
    const verify = await verifyPublicTunnelUrl(parsed.url, 12_000)
    if (!verify.ok) return null
    console.error(`[clone-tunnel] Reusing cached tunnel URL (${parsed.provider}): ${parsed.url}`)
    return parsed
  } catch {
    return null
  }
}

export async function writeCachedMirrorUrl(
  outDir: string,
  url: string,
  provider: string,
  port: number,
): Promise<void> {
  const record: MirrorUrlCache = {
    url: url.replace(/\/$/, ''),
    provider,
    port,
    createdAt: new Date().toISOString(),
  }
  await writeFile(mirrorUrlCachePath(outDir), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  console.error(`[clone-tunnel] Cached tunnel URL → ${mirrorUrlCachePath(outDir)}`)
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '')
}

export function killActiveTunnelProcess(): void {
  if (activeTunnelPid == null) return
  try {
    process.kill(activeTunnelPid, 'SIGTERM')
  } catch {
    /* already exited */
  }
  activeTunnelPid = undefined
  activeTunnelKind = undefined
}

function runCommand(
  command: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts?.cwd,
      env: opts?.env ?? process.env,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer =
      opts?.timeoutMs != null
        ? setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs)
        : null
    child.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString()
    })
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString()
    })
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error((stderr || stdout).trim().slice(0, 800) || `exit ${code}`))
    })
  })
}

export async function ensureCloudflaredAvailable(): Promise<boolean> {
  try {
    await runCommand('cloudflared', ['--version'], { timeoutMs: 10_000 })
    return true
  } catch (e) {
    console.error(
      `[clone-tunnel] cloudflared --version failed: ${e instanceof Error ? e.message : String(e)}`,
    )
    return false
  }
}

async function fetchCloudflaredMetricsUrl(): Promise<string | null> {
  const metricsPort = process.env['CLOUDFLARED_METRICS_PORT']?.trim() || '4040'
  try {
    const res = await fetch(`http://127.0.0.1:${metricsPort}/api/tunnels`, {
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      tunnels?: Array<{ public_url?: string; url?: string }>
    }
    for (const t of json.tunnels ?? []) {
      const raw = t.public_url ?? t.url
      if (raw?.includes('trycloudflare.com')) return raw.replace(/\/$/, '')
    }
  } catch {
    /* unavailable */
  }
  return null
}

function extractTrycloudflareUrl(output: string): string | null {
  const clean = stripAnsi(output)
  const primary = clean.match(TRYCF_URL_PRIMARY)
  if (primary?.[1]) return primary[1].replace(/\/$/, '')
  const loose = clean.match(/https:\/\/[^\s]+trycloudflare\.com[^\s]*/i)
  return loose?.[0]?.replace(/[|)\]},.;]+$/, '').replace(/\/$/, '') ?? null
}

function extractNgrokUrl(output: string): string | null {
  const clean = stripAnsi(output)
  const m = clean.match(NGROK_URL_RE)
  if (m?.[1]) return m[1].replace(/\/$/, '')
  const urlField = clean.match(/url=(https:\/\/[^\s]+)/i)
  if (urlField?.[1]) return urlField[1].replace(/\/$/, '')
  return null
}

function extractLocaltunnelUrl(output: string): string | null {
  const clean = stripAnsi(output)
  const m = clean.match(LOCALTUNNEL_URL_RE)
  if (m?.[1]) return m[1].replace(/\/$/, '')
  const labeled = clean.match(/your url is:\s*(https:\/\/\S+)/i)
  if (labeled?.[1]) return labeled[1].replace(/\/$/, '')
  return null
}

function extractLocalhostRunUrl(output: string): string | null {
  const clean = stripAnsi(output)
  const tlsLine = clean.match(/tunneled with tls termination,\s*(https:\/\/\S+)/i)
  if (tlsLine?.[1]) return tlsLine[1].replace(/\/$/, '')
  const all = [...clean.matchAll(LOCALHOST_RUN_URL_RE)]
  for (const m of all) {
    const url = m[1]?.replace(/\/$/, '')
    if (!url) continue
    if (/admin\.localhost\.run|docs\.localhost\.run/i.test(url)) continue
    if (/\.lhr\.life$/i.test(url) || /^https:\/\/[a-z0-9-]+\.localhost\.run$/i.test(url)) {
      return url
    }
  }
  return null
}

function extractBoreUrl(output: string): string | null {
  const clean = stripAnsi(output)
  const direct = clean.match(BORE_URL_RE)
  if (direct?.[1]) return direct[1].replace(/\/$/, '')
  const listen = clean.match(BORE_LISTEN_RE)
  if (listen?.[1]) return `http://bore.pub:${listen[1]}`
  return null
}

async function fetchNgrokApiUrl(): Promise<string | null> {
  try {
    const res = await fetch(NGROK_API, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return null
    const json = (await res.json()) as {
      tunnels?: Array<{ public_url?: string; proto?: string }>
    }
    for (const t of json.tunnels ?? []) {
      if (t.public_url?.startsWith('https://')) return t.public_url.replace(/\/$/, '')
    }
  } catch {
    /* api down */
  }
  return null
}

function spawnTunnelProcess(
  command: string,
  args: string[],
  kind: QuickTunnelProvider,
  env?: NodeJS.ProcessEnv,
): ReturnType<typeof spawn> {
  const child = spawn(command, args, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32' && (command === 'npx' || command === 'pnpm'),
    windowsHide: true,
    env: env ?? process.env,
  })
  if (child.pid) {
    activeTunnelPid = child.pid
    activeTunnelKind = kind
  }
  return child
}

function waitForUrlFromProcess(
  child: ReturnType<typeof spawn>,
  extract: (output: string) => string | null,
  pollApi?: () => Promise<string | null>,
  timeoutMs = TUNNEL_TIMEOUT_MS,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let combined = ''
    let settled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let hardTimer: ReturnType<typeof setTimeout> | null = null

    const finish = (url: string) => {
      if (settled) return
      settled = true
      if (pollTimer) clearInterval(pollTimer)
      if (hardTimer) clearTimeout(hardTimer)
      child.unref()
      resolve(url.replace(/\/$/, ''))
    }

    const fail = (detail: string) => {
      if (settled) return
      settled = true
      if (pollTimer) clearInterval(pollTimer)
      if (hardTimer) clearTimeout(hardTimer)
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      reject(new Error(detail))
    }

    const onData = (chunk: Buffer) => {
      combined += chunk.toString('utf8')
      const url = extract(combined)
      if (url) finish(url)
    }

    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', (err) => fail(err.message))

    const tryPoll = async () => {
      const fromOutput = extract(combined)
      if (fromOutput) {
        finish(fromOutput)
        return true
      }
      if (pollApi) {
        const apiUrl = await pollApi()
        if (apiUrl) {
          finish(apiUrl)
          return true
        }
      }
      return false
    }

    pollTimer = setInterval(() => {
      void tryPoll()
    }, 2_000)

    hardTimer = setTimeout(() => {
      void (async () => {
        if (await tryPoll()) return
        const tail = stripAnsi(combined).trim().slice(-600)
        fail(tail ? `timeout — output tail:\n${tail}` : 'timeout waiting for tunnel URL')
      })()
    }, timeoutMs)
  })
}

export async function startCloudflaredQuickTunnel(
  localPort: number,
  hostname?: string,
): Promise<string> {
  const available = await ensureCloudflaredAvailable()
  if (!available) {
    throw new Error('cloudflared not available (cloudflared --version failed)')
  }

  const metricsPort = process.env['CLOUDFLARED_METRICS_PORT']?.trim() || '4040'
  const args = [
    'tunnel',
    '--no-autoupdate',
    '--loglevel',
    'debug',
    '--metrics',
    `127.0.0.1:${metricsPort}`,
    '--url',
    `http://127.0.0.1:${localPort}`,
  ]

  if (hostname) args.push('--hostname', hostname)

  killActiveTunnelProcess()
  const child = spawnTunnelProcess('cloudflared', args, 'cloudflared')

  if (hostname) {
    child.unref()
    const url = `https://${hostname}`.replace(/\/$/, '')
    await new Promise((r) => setTimeout(r, 3_000))
    return url
  }

  return waitForUrlFromProcess(
    child,
    extractTrycloudflareUrl,
    fetchCloudflaredMetricsUrl,
    60_000,
  )
}

async function ensureNgrokBinary(repoRoot: string): Promise<string> {
  const toolsDir = path.join(repoRoot, 'tools')
  const platform = process.platform
  const spec = NGROK_DOWNLOAD[platform]
  if (!spec) {
    throw new Error(`ngrok auto-download not supported on platform: ${platform}`)
  }

  const binaryPath = path.join(toolsDir, spec.binary)
  if (existsSync(binaryPath)) return binaryPath

  await mkdir(toolsDir, { recursive: true })
  const archivePath = path.join(toolsDir, `ngrok-download.${spec.archive === 'zip' ? 'zip' : 'tgz'}`)

  console.error(`[clone-tunnel] Downloading ngrok from ${spec.url}`)
  const res = await fetch(spec.url, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) {
    throw new Error(`ngrok download failed: HTTP ${res.status}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const { writeFile: writeFileFs } = await import('node:fs/promises')
  await writeFileFs(archivePath, buf)

  if (spec.archive === 'zip') {
    if (process.platform === 'win32') {
      await runCommand(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${toolsDir.replace(/'/g, "''")}' -Force`,
        ],
        { timeoutMs: 60_000 },
      )
    } else {
      await runCommand('unzip', ['-o', archivePath, '-d', toolsDir], { timeoutMs: 60_000 })
    }
  } else {
    await runCommand('tar', ['-xzf', archivePath, '-C', toolsDir], { timeoutMs: 60_000 })
  }

  if (!existsSync(binaryPath)) {
    throw new Error(`ngrok binary not found at ${binaryPath} after extract`)
  }

  console.error(`[clone-tunnel] ngrok ready at ${binaryPath}`)
  return binaryPath
}

function resolveNgrokAuthToken(): string | undefined {
  return (
    process.env['CLONE_NGROK_AUTH_TOKEN']?.trim() ||
    process.env['NGROK_AUTHTOKEN']?.trim() ||
    undefined
  )
}

function buildNgrokChildEnv(token?: string): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (token) {
    env['NGROK_AUTHTOKEN'] = token
    env['CLONE_NGROK_AUTH_TOKEN'] = token
  }
  return env
}

export async function startNgrokTunnel(localPort: number, repoRoot: string): Promise<string> {
  const binary = await ensureNgrokBinary(repoRoot)
  const token = resolveNgrokAuthToken()
  if (token) {
    try {
      await runCommand(binary, ['config', 'add-authtoken', token], { timeoutMs: 15_000 })
      console.error('[clone-tunnel] ngrok authtoken configured')
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      console.error(
        `[clone-tunnel] ngrok config add-authtoken warning (will try NGROK_AUTHTOKEN env): ${detail}`,
      )
    }
  } else {
    console.error(
      '[clone-tunnel] ngrok: no CLONE_NGROK_AUTH_TOKEN — free tier may hit auth/rate limits',
    )
  }

  killActiveTunnelProcess()
  const child = spawnTunnelProcess(
    binary,
    ['http', String(localPort), '--log=stdout', '--log-format=logfmt'],
    'ngrok',
    buildNgrokChildEnv(token),
  )

  return waitForUrlFromProcess(child, extractNgrokUrl, fetchNgrokApiUrl)
}

export async function startLocaltunnel(localPort: number): Promise<string> {
  killActiveTunnelProcess()
  const child = spawnTunnelProcess(
    'npx',
    ['--yes', 'localtunnel', '--port', String(localPort)],
    'localtunnel',
  )
  return waitForUrlFromProcess(child, extractLocaltunnelUrl, undefined, 60_000)
}

async function ensureSshAvailable(): Promise<string> {
  const candidates =
    process.platform === 'win32'
      ? ['ssh', 'C:\\Windows\\System32\\OpenSSH\\ssh.exe']
      : ['ssh']
  for (const cmd of candidates) {
    try {
      await runCommand(cmd, ['-V'], { timeoutMs: 8_000 })
      return cmd
    } catch {
      /* try next */
    }
  }
  throw new Error('OpenSSH client not found (install OpenSSH Client on Windows)')
}

/**
 * SSH reverse tunnel via localhost.run — no account, works on many corporate networks (port 22).
 */
export async function startLocalhostRunTunnel(localPort: number): Promise<string> {
  const ssh = await ensureSshAvailable()
  killActiveTunnelProcess()
  const child = spawnTunnelProcess(
    ssh,
    [
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'ServerAliveInterval=60',
      '-o',
      'ExitOnForwardFailure=yes',
      '-R',
      `80:127.0.0.1:${localPort}`,
      'nokey@localhost.run',
    ],
    'localhost.run',
  )
  return waitForUrlFromProcess(child, extractLocalhostRunUrl, undefined, 30_000)
}

async function ensureBoreBinary(repoRoot: string): Promise<string> {
  const toolsDir = path.join(repoRoot, 'tools')
  const platform = process.platform
  const spec = BORE_DOWNLOAD[platform]
  if (!spec) {
    throw new Error(`bore auto-download not supported on platform: ${platform}`)
  }

  const binaryPath = path.join(toolsDir, spec.binary)
  if (existsSync(binaryPath)) return binaryPath

  await mkdir(toolsDir, { recursive: true })
  const archivePath = path.join(toolsDir, `bore-download.${spec.archive === 'zip' ? 'zip' : 'tgz'}`)

  console.error(`[clone-tunnel] Downloading bore from ${spec.url}`)
  const res = await fetch(spec.url, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) {
    throw new Error(`bore download failed: HTTP ${res.status}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const { writeFile: writeFileFs } = await import('node:fs/promises')
  await writeFileFs(archivePath, buf)

  if (spec.archive === 'zip') {
    if (process.platform === 'win32') {
      await runCommand(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${toolsDir.replace(/'/g, "''")}' -Force`,
        ],
        { timeoutMs: 60_000 },
      )
    } else {
      await runCommand('unzip', ['-o', archivePath, '-d', toolsDir], { timeoutMs: 60_000 })
    }
  } else {
    await runCommand('tar', ['-xzf', archivePath, '-C', toolsDir], { timeoutMs: 60_000 })
  }

  if (!existsSync(binaryPath)) {
    throw new Error(`bore binary not found at ${binaryPath} after extract`)
  }

  console.error(`[clone-tunnel] bore ready at ${binaryPath}`)
  return binaryPath
}

/**
 * UDP/TCP hole-punch tunnel via bore.pub — no account (HTTP only on assigned port).
 */
export async function startBoreTunnel(localPort: number, repoRoot: string): Promise<string> {
  const binary = await ensureBoreBinary(repoRoot)
  const server = process.env['CLONE_BORE_SERVER']?.trim() || 'bore.pub'
  killActiveTunnelProcess()
  const child = spawnTunnelProcess(
    binary,
    ['local', String(localPort), '--to', server],
    'bore',
  )
  return waitForUrlFromProcess(child, extractBoreUrl, undefined, 45_000)
}

async function tryProviderOnce(
  provider: QuickTunnelProvider,
  localPort: number,
  repoRoot: string,
  hostname?: string,
): Promise<string> {
  switch (provider) {
    case 'cloudflared':
      return startCloudflaredQuickTunnel(localPort, hostname)
    case 'ngrok':
      if (hostname) {
        throw new Error('ngrok quick tunnel does not support custom hostname in this flow')
      }
      return startNgrokTunnel(localPort, repoRoot)
    case 'localtunnel':
      if (hostname) {
        throw new Error('localtunnel does not support custom hostname')
      }
      return startLocaltunnel(localPort)
    case 'localhost.run':
      if (hostname) {
        throw new Error('localhost.run does not support custom hostname in this flow')
      }
      return startLocalhostRunTunnel(localPort)
    case 'bore':
      if (hostname) {
        throw new Error('bore does not support custom hostname')
      }
      return startBoreTunnel(localPort, repoRoot)
    default:
      throw new Error(`unknown tunnel provider: ${provider}`)
  }
}

async function tryProviderWithRetries(
  provider: QuickTunnelProvider,
  localPort: number,
  repoRoot: string,
  hostname?: string,
): Promise<string> {
  const maxAttempts = provider === 'cloudflared' ? readTunnelMaxRestarts() : 1
  let lastError = 'unknown'

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    killActiveTunnelProcess()
    try {
      const url = await tryProviderOnce(provider, localPort, repoRoot, hostname)
      const verify = await verifyPublicTunnelUrl(url)
      if (verify.ok) {
        console.error(
          `[clone-tunnel] Using ${provider} tunnel (HTTP ${verify.status ?? 200}): ${url}`,
        )
        return url
      }
      lastError = verify.detail ?? `HTTP ${verify.status}`
      console.error(
        `[clone-tunnel] ${provider} URL not reachable (attempt ${attempt}/${maxAttempts}): ${lastError}`,
      )
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      console.error(
        `[clone-tunnel] ${provider} failed (attempt ${attempt}/${maxAttempts}): ${lastError}`,
      )
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 2_000))
    }
  }

  throw new Error(`${provider} failed after ${maxAttempts} attempt(s): ${lastError}`)
}

async function tryDuckDnsHostnameTunnel(
  localPort: number,
  repoRoot: string,
  subdomain?: string,
): Promise<string> {
  if (!hasDuckDnsConfig()) {
    throw new Error('DUCKDNS_TOKEN not configured')
  }
  const sub =
    subdomain?.trim() ||
    process.env['DUCKDNS_SUBDOMAIN']?.trim() ||
    `legion-${Math.random().toString(36).slice(2, 8)}`
  const duck = await resolveDuckDnsMirrorUrl(sub)
  if (!duck.ok) throw new Error(`DuckDNS update failed: ${duck.detail}`)
  console.error(`[clone-tunnel] Using DuckDNS fallback: ${duck.fqdn}`)
  return tryProviderWithRetries('cloudflared', localPort, repoRoot, duck.fqdn)
}

/**
 * Obtain a public HTTPS URL via configured providers (cache → cloudflared → ngrok → localtunnel → DuckDNS).
 */
export async function establishMultiProviderTunnel(opts: {
  outDir: string
  localPort: number
  repoRoot: string
  hostname?: string
  duckSubdomain?: string
}): Promise<{ url: string; provider: string }> {
  if (!opts.hostname) {
    const cached = await readCachedMirrorUrl(opts.outDir, opts.localPort)
    if (cached) {
      return { url: cached.url, provider: `cached:${cached.provider}` }
    }
  }

  const providers = opts.hostname
    ? (['cloudflared'] as QuickTunnelProvider[])
    : resolveQuickTunnelProviders()
  console.error(`[clone-tunnel] Tunnel provider order: ${providers.join(' → ')}`)

  const errors: string[] = []

  for (const provider of providers) {
    try {
      const url = await tryProviderWithRetries(
        provider,
        opts.localPort,
        opts.repoRoot,
        opts.hostname,
      )
      await writeCachedMirrorUrl(opts.outDir, url, provider, opts.localPort)
      return { url, provider }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`${provider}: ${msg}`)
    }
  }

  // Restricted-network fallbacks — always try unless already attempted or using custom hostname.
  if (!opts.hostname) {
    const restrictedFallbacks: QuickTunnelProvider[] = ['localhost.run', 'bore']
    for (const provider of restrictedFallbacks) {
      if (providers.includes(provider)) continue
      console.error(`[clone-tunnel] Trying restricted-network fallback: ${provider}`)
      try {
        const url = await tryProviderWithRetries(
          provider,
          opts.localPort,
          opts.repoRoot,
          opts.hostname,
        )
        await writeCachedMirrorUrl(opts.outDir, url, provider, opts.localPort)
        return { url, provider }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        errors.push(`${provider}: ${msg}`)
      }
    }
  }

  if (!opts.hostname && hasDuckDnsConfig()) {
    try {
      const url = await tryDuckDnsHostnameTunnel(opts.localPort, opts.repoRoot, opts.duckSubdomain)
      await writeCachedMirrorUrl(opts.outDir, url, 'duckdns+cloudflared', opts.localPort)
      return { url, provider: 'duckdns+cloudflared' }
    } catch (e) {
      errors.push(`duckdns: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  throw new Error(
    `All tunnel providers failed.\n${errors.join('\n')}\n` +
      'On restricted networks try: CLONE_TUNNEL_PROVIDERS=localhost.run,bore,cloudflared\n' +
      'Or configure DUCKDNS_TOKEN / CLOUDFLARE_API_TOKEN for custom hostname.',
  )
}
