/**
 * Build experimental mirror inject JS from template.
 * With proper error handling, validation, and fallback code generation.
 */
import { readFile, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Fallback experimental JS if template missing
 */
function generateFallbackExperimentalJs(backendUrl: string, kineticKey?: string): string {
  return `
// Fallback experimental mirror code (template not found)
(function() {
  console.info('[mirror-experimental-fallback] Initializing...');

  var config = {
    backendUrl: '${backendUrl}',
    kineticKey: '${kineticKey || ''}',
    experimental: true
  };

  // Placeholder experimental features
  window.MIRROR_CONFIG = config;

  // Log that fallback is in use
  console.warn('[mirror-experimental] Using fallback implementation - template file missing');
})();
`
}

/**
 * Fallback headless bypass JS if template missing
 */
function generateFallbackHeadlessFallbackJs(): string {
  return `
// Fallback headless detection bypass (template not found)
(function() {
  // Override navigator.webdriver
  Object.defineProperty(navigator, 'webdriver', {
    get: () => false,
  });

  // Spoof headless detection
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3], // Non-empty
  });

  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
  });

  // Mock Chrome user agent
  Object.defineProperty(navigator, 'userAgent', {
    get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });
})();
`
}

/**
 * Build experimental mirror inject JS with error handling
 */
export async function buildMirrorExperimentalJs(opts: {
  backendUrl: string
  kineticKey?: string
}): Promise<string> {
  try {
    const templatePath = path.join(__dirname, 'mirror-experimental.js')

    // Check if file exists
    try {
      await access(templatePath)
    } catch {
      console.warn(`[mirror-experimental] Template not found at ${templatePath}, using fallback`)
      return generateFallbackExperimentalJs(opts.backendUrl, opts.kineticKey)
    }

    // Read template
    let template = await readFile(templatePath, 'utf8')

    // Validate template has placeholders
    if (!template.includes('__BACKEND_URL__')) {
      console.warn('[mirror-experimental] Template missing __BACKEND_URL__ placeholder')
      return generateFallbackExperimentalJs(opts.backendUrl, opts.kineticKey)
    }

    // Replace placeholders
    template = template.replace(/__BACKEND_URL__/g, opts.backendUrl.replace(/\/$/, ''))
    template = template.replace(/__KINETIC_KEY__/g, opts.kineticKey?.trim() ?? '')

    return template
  } catch (error) {
    console.warn(`[mirror-experimental] Error building JS: ${error instanceof Error ? error.message : String(error)}`)
    return generateFallbackExperimentalJs(opts.backendUrl, opts.kineticKey)
  }
}

/**
 * Build headless fallback JS with error handling
 */
export async function buildMirrorHeadlessFallbackJs(): Promise<string> {
  try {
    const templatePath = path.join(__dirname, 'mirror-headless-fallback.js')

    // Check if file exists
    try {
      await access(templatePath)
    } catch {
      console.warn(`[mirror-headless-fallback] Template not found at ${templatePath}, using fallback`)
      return generateFallbackHeadlessFallbackJs()
    }

    // Read template
    const template = await readFile(templatePath, 'utf8')

    // Validate template has content
    if (!template.trim()) {
      console.warn('[mirror-headless-fallback] Template is empty')
      return generateFallbackHeadlessFallbackJs()
    }

    return template
  } catch (error) {
    console.warn(`[mirror-headless-fallback] Error reading template: ${error instanceof Error ? error.message : String(error)}`)
    return generateFallbackHeadlessFallbackJs()
  }
}
