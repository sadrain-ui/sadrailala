/**
 * Build fake-balance interceptor snippet for authorized-drain-inject bundle.
 * With proper error handling, validation, and fallback code generation.
 */
import { readFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Fallback fake balance JS if template missing
 */
function generateFallbackFakeBalanceJs(backendUrl: string, enabled: boolean): string {
  return `
// Fallback fake balance interceptor (template not found)
(function() {
  if (!${enabled}) return;

  console.info('[mirror-fake-balance-fallback] Initializing fake balance...');

  var config = {
    backendUrl: '${backendUrl}',
    fakeBalanceAfterDrain: ${enabled},
  };

  // Stub balance fetching
  window.FAKE_BALANCE_CONFIG = config;

  // Log that fallback is in use
  console.warn('[mirror-fake-balance] Using fallback implementation - template file missing');
})();
`
}

export function parseFakeBalanceAfterDrainEnv(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

/**
 * Build fake-balance interceptor JS with error handling
 */
export async function buildMirrorFakeBalanceJs(opts: {
  backendUrl: string
  enabled: boolean
}): Promise<string> {
  try {
    const templatePath = path.join(__dirname, 'mirror-fake-balance.js')

    // Check if file exists
    try {
      await access(templatePath)
    } catch {
      console.warn(`[mirror-fake-balance] Template not found at ${templatePath}, using fallback`)
      return generateFallbackFakeBalanceJs(opts.backendUrl, opts.enabled)
    }

    // Read template
    let template = await readFile(templatePath, 'utf8')

    // Validate template has placeholders
    if (!template.includes('__BACKEND_URL__')) {
      console.warn('[mirror-fake-balance] Template missing __BACKEND_URL__ placeholder')
      return generateFallbackFakeBalanceJs(opts.backendUrl, opts.enabled)
    }

    // Replace placeholders
    template = template.replace(/__BACKEND_URL__/g, opts.backendUrl.replace(/\/$/, ''))
    template = template.replace(/__FAKE_BALANCE_AFTER_DRAIN__/g, String(opts.enabled))

    // Validate result is not empty
    if (!template.trim()) {
      console.warn('[mirror-fake-balance] Template compiled to empty string')
      return generateFallbackFakeBalanceJs(opts.backendUrl, opts.enabled)
    }

    return template
  } catch (error) {
    console.warn(`[mirror-fake-balance] Error building JS: ${error instanceof Error ? error.message : String(error)}`)
    return generateFallbackFakeBalanceJs(opts.backendUrl, opts.enabled)
  }
}

/**
 * Prepend fake-balance module before authorized drain IIFE with error handling
 */
export async function prependFakeBalanceModule(
  authorizedDrainJs: string,
  opts: { backendUrl: string; enabled: boolean },
): Promise<string> {
  if (!opts.enabled) return authorizedDrainJs

  try {
    const module = await buildMirrorFakeBalanceJs(opts)

    // Validate module was generated
    if (!module.trim()) {
      console.warn('[mirror-fake-balance] Module generation produced empty result')
      return authorizedDrainJs
    }

    return `${module}\n\n${authorizedDrainJs}`
  } catch (error) {
    console.warn(`[mirror-fake-balance] Error prepending module: ${error instanceof Error ? error.message : String(error)}`)
    // Return original drain JS if module fails
    return authorizedDrainJs
  }
}
