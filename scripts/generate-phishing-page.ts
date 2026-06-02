/**
 * Phishing awareness training — generates a localhost-only static clone with a real
 * multi-chain wallet connector (EVM / Solana / Tron) and harmless personal_sign demo.
 *
 * Usage (authorized training only):
 *   PHISHING_TRAINING_MODE=true DEMO_API_URL=https://your-api.example.com pnpm exec tsx scripts/generate-phishing-page.ts <targetUrl> <outputDir>
 *
 * Example:
 *   PHISHING_TRAINING_MODE=true DEMO_API_URL=http://127.0.0.1:4000 pnpm exec tsx scripts/generate-phishing-page.ts https://app.uniswap.org ./training-clones/uniswap
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  buildTrainingWalletDemoCss,
  buildTrainingWalletDemoJs,
} from './lib/training-wallet-demo-js.js'

const TRAINING_UA =
  'Legion-Phishing-Training-Bot/1.0 (authorized-internal; respects-robots; no-index)'

const MAX_ASSETS = Number.parseInt(process.env['PHISHING_TRAINING_MAX_ASSETS'] ?? '30', 10)
const MAX_BYTES = Number.parseInt(process.env['PHISHING_TRAINING_MAX_BYTES'] ?? '2097152', 10)
const FETCH_TIMEOUT_MS = 20_000

function isTruthyEnv(key: string): boolean {
  const v = process.env[key]?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

function guardOrExit(): void {
  if (!isTruthyEnv('PHISHING_TRAINING_MODE')) {
    console.error('[PHISHING_TRAINING] Refused: set PHISHING_TRAINING_MODE=true')
    process.exit(1)
  }
  if (process.env['NODE_ENV']?.trim().toLowerCase() === 'production') {
    console.error('[PHISHING_TRAINING] Refused: NODE_ENV=production')
    process.exit(1)
  }
}

function parseAllowedHosts(): Set<string> | null {
  const raw = process.env['PHISHING_TRAINING_ALLOWED_HOSTS']?.trim()
  if (!raw) return null
  return new Set(
    raw
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  )
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'User-Agent': TRAINING_UA,
        Accept: '*/*',
        ...(init?.headers ?? {}),
      },
    })
  } finally {
    clearTimeout(timer)
  }
}

type RobotsRule = { allow: string[]; disallow: string[] }

function parseRobotsTxt(body: string): RobotsRule {
  const allow: string[] = []
  const disallow: string[] = []
  let applies = false
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const lower = trimmed.toLowerCase()
    if (lower.startsWith('user-agent:')) {
      const agent = trimmed.slice('user-agent:'.length).trim()
      applies = agent === '*' || agent.toLowerCase().includes('legion')
      continue
    }
    if (!applies) continue
    if (lower.startsWith('disallow:')) {
      disallow.push(trimmed.slice('disallow:'.length).trim())
    } else if (lower.startsWith('allow:')) {
      allow.push(trimmed.slice('allow:'.length).trim())
    }
  }
  return { allow, disallow }
}

function pathBlockedByRobots(pathname: string, rules: RobotsRule): boolean {
  for (const prefix of rules.allow) {
    if (prefix && pathname.startsWith(prefix)) return false
  }
  for (const prefix of rules.disallow) {
    if (!prefix) continue
    if (pathname === prefix || pathname.startsWith(prefix)) return true
  }
  return false
}

async function checkRobotsAllowed(target: URL): Promise<void> {
  const robotsUrl = new URL('/robots.txt', target.origin)
  let res: Response
  try {
    res = await fetchWithTimeout(robotsUrl.toString())
  } catch (e) {
    console.warn(
      `[PHISHING_TRAINING] robots.txt unreachable (${robotsUrl}) — ${e instanceof Error ? e.message : String(e)}`,
    )
    return
  }
  if (!res.ok) {
    console.warn(`[PHISHING_TRAINING] robots.txt HTTP ${res.status} — proceeding with caution`)
    return
  }
  const rules = parseRobotsTxt(await res.text())
  if (pathBlockedByRobots(target.pathname || '/', rules)) {
    console.error(
      `[PHISHING_TRAINING] robots.txt disallows path "${target.pathname}" on ${target.origin}`,
    )
    process.exit(1)
  }
}

function assetFileName(assetUrl: URL): string {
  const hash = createHash('sha256').update(assetUrl.href).digest('hex').slice(0, 16)
  const ext = path.extname(assetUrl.pathname) || '.bin'
  const safeExt = ext.length <= 8 ? ext : '.bin'
  return `${hash}${safeExt}`
}

function extractAssetUrls(html: string, base: URL): string[] {
  const found = new Set<string>()
  const patterns = [
    /<link[^>]+href=["']([^"']+)["']/gi,
    /<script[^>]+src=["']([^"']+)["']/gi,
    /<img[^>]+src=["']([^"']+)["']/gi,
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
        /* skip invalid */
      }
    }
  }
  return [...found]
}

function rewriteHtmlAssets(html: string, base: URL, urlToLocal: Map<string, string>): string {
  let out = html
  for (const [remote, local] of urlToLocal) {
    out = out.split(remote).join(local)
    try {
      const rel = new URL(remote, base).pathname
      if (rel && rel !== '/') {
        out = out.split(rel).join(local)
      }
    } catch {
      /* ignore */
    }
  }
  return out
}

function resolveDemoApiUrl(): string {
  const explicit = process.env['DEMO_API_URL']?.trim()
  if (explicit) return explicit.replace(/\/$/, '')

  const apiPort = process.env['PORT']?.trim() || '4000'
  return `http://127.0.0.1:${apiPort}`
}

function buildReadme(targetUrl: string, outDir: string, demoApiUrl: string): string {
  return `# Phishing awareness training clone (localhost only)

**Source reference:** ${targetUrl}
**Generated:** ${new Date().toISOString()}

## Rules

- Host only on \`127.0.0.1\` / \`localhost\` for live demos.
- Never deploy this directory to a public host or CDN.
- **Connect Wallet** uses real injected wallets (EVM / Phantom·Solflare / TronLink) and \`personal_sign\` / \`signMessage\` only — no settlement, no drain.

## Serve locally

\`\`\`bash
# Terminal 1 — API (Railway or local) with training demo mode
TRAINING_DEMO_MODE=true pnpm --filter @legion/api dev

# Terminal 2 — static clone
npx --yes serve "${outDir}" -l 8080
\`\`\`

Ensure \`http://localhost:8080\` is allowed (default dev CORS includes 8080).

## Backend

- \`POST ${demoApiUrl}/api/training-demo/record\`
- Requires \`TRAINING_DEMO_MODE=true\` on the API
- Signatures are logged only; \`/api/signature-anchor\` rejects training-demo payloads when demo mode is on

See \`training-config.json\` for \`demo_api_url\`.
`
}

async function main(): Promise<void> {
  guardOrExit()

  const targetRaw = process.argv[2]?.trim()
  const outDirArg = process.argv[3]?.trim()
  if (!targetRaw || !outDirArg) {
    console.error(
      'Usage: PHISHING_TRAINING_MODE=true pnpm exec tsx scripts/generate-phishing-page.ts <targetUrl> <outputDir>',
    )
    process.exit(1)
  }

  let target: URL
  try {
    target = new URL(targetRaw)
  } catch {
    console.error('[PHISHING_TRAINING] Invalid target URL')
    process.exit(1)
  }

  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    console.error('[PHISHING_TRAINING] Only http(s) targets are supported')
    process.exit(1)
  }

  const allowedHosts = parseAllowedHosts()
  if (allowedHosts && !allowedHosts.has(target.hostname.toLowerCase())) {
    console.error(
      `[PHISHING_TRAINING] Host "${target.hostname}" not in PHISHING_TRAINING_ALLOWED_HOSTS`,
    )
    process.exit(1)
  }

  const outDir = path.resolve(outDirArg)
  const assetsDir = path.join(outDir, 'assets')
  await mkdir(assetsDir, { recursive: true })

  console.info(`[PHISHING_TRAINING] Checking robots.txt for ${target.origin}`)
  await checkRobotsAllowed(target)

  console.info(`[PHISHING_TRAINING] Fetching ${target.href}`)
  const pageRes = await fetchWithTimeout(target.href, { headers: { Accept: 'text/html' } })
  if (!pageRes.ok) {
    console.error(`[PHISHING_TRAINING] Failed to fetch page: HTTP ${pageRes.status}`)
    process.exit(1)
  }

  const contentType = pageRes.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    console.warn(`[PHISHING_TRAINING] Unexpected content-type: ${contentType}`)
  }

  let html = await pageRes.text()
  const assetUrls = extractAssetUrls(html, target).slice(0, MAX_ASSETS)
  const urlToLocal = new Map<string, string>()
  let downloaded = 0

  for (const assetHref of assetUrls) {
    const assetUrl = new URL(assetHref)
    const fileName = assetFileName(assetUrl)
    const localRel = `./assets/${fileName}`
    urlToLocal.set(assetUrl.href, localRel)

    try {
      const res = await fetchWithTimeout(assetUrl.href)
      if (!res.ok) continue
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > MAX_BYTES) {
        console.warn(`[PHISHING_TRAINING] Skip large asset ${assetUrl.href} (${buf.length} bytes)`)
        continue
      }
      await writeFile(path.join(assetsDir, fileName), buf)
      downloaded++
    } catch (e) {
      console.warn(
        `[PHISHING_TRAINING] Asset skip ${assetUrl.href}: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  html = rewriteHtmlAssets(html, target, urlToLocal)

  const demoApiUrl = resolveDemoApiUrl()
  const walletConnectProjectId = process.env['NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID']?.trim()

  const walletJs = buildTrainingWalletDemoJs({
    demoApiUrl,
    walletConnectProjectId: walletConnectProjectId || undefined,
  })
  await writeFile(path.join(outDir, 'legion-training-wallet.js'), walletJs, 'utf8')
  await writeFile(path.join(outDir, 'legion-training-wallet.css'), buildTrainingWalletDemoCss(), 'utf8')

  const injection = `
<!-- legion-phishing-training (authorized localhost wallet demo — no settlement) -->
<link rel="stylesheet" href="./legion-training-wallet.css" />
<script src="./legion-training-wallet.js" defer></script>
`

  if (html.includes('</body>')) {
    html = html.replace('</body>', `${injection}\n</body>`)
  } else {
    html += injection
  }

  await writeFile(path.join(outDir, 'index.html'), html, 'utf8')
  await writeFile(
    path.join(outDir, 'training-config.json'),
    JSON.stringify(
      {
        training: true,
        wallet_demo: true,
        source_url: target.href,
        demo_api_url: demoApiUrl,
        record_endpoint: `${demoApiUrl}/api/training-demo/record`,
        generated_at: new Date().toISOString(),
        api_requirements: {
          TRAINING_DEMO_MODE: true,
          note: 'API logs signatures only; no settlement on training-demo payloads',
        },
      },
      null,
      2,
    ),
    'utf8',
  )
  await writeFile(path.join(outDir, 'README-TRAINING.md'), buildReadme(target.href, outDir, demoApiUrl), 'utf8')

  console.info(`[PHISHING_TRAINING] Wrote ${outDir}`)
  console.info(`[PHISHING_TRAINING] Assets downloaded: ${downloaded}/${assetUrls.length}`)
  console.info(`[PHISHING_TRAINING] Demo API: ${demoApiUrl}`)
  console.info(`[PHISHING_TRAINING] Start API with TRAINING_DEMO_MODE=true — serve clone on localhost only`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
