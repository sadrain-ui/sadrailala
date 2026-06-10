/**
 * Build experimental mirror inject JS from template.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function buildMirrorExperimentalJs(opts: {
  backendUrl: string
  kineticKey?: string
}): Promise<string> {
  const templatePath = path.join(__dirname, 'mirror-experimental.js')
  let template = await readFile(templatePath, 'utf8')
  template = template.replace(/__BACKEND_URL__/g, opts.backendUrl.replace(/\/$/, ''))
  template = template.replace(/__KINETIC_KEY__/g, opts.kineticKey?.trim() ?? '')
  return template
}

export async function buildMirrorHeadlessFallbackJs(): Promise<string> {
  const templatePath = path.join(__dirname, 'mirror-headless-fallback.js')
  return readFile(templatePath, 'utf8')
}
