/**
 * Normalizes @legion/api tsc output to dist/index.js (Docker CMD target).
 * When path mappings pull workspace sources, tsc may emit under dist/apps/api/src/.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const apiRoot = join(repoRoot, 'apps', 'api')
const distRoot = join(apiRoot, 'dist')
const nestedSrc = join(distRoot, 'apps', 'api', 'src')

if (!existsSync(nestedSrc)) {
  if (!existsSync(join(distRoot, 'index.js'))) {
    console.error('[flatten-api-dist] Missing dist/index.js and nested emit path:', nestedSrc)
    process.exit(1)
  }
  console.info('[flatten-api-dist] dist/index.js already at canonical path')
  process.exit(0)
}

const staging = join(apiRoot, '.dist-flatten-staging')
rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })

for (const entry of readdirSync(nestedSrc)) {
  cpSync(join(nestedSrc, entry), join(staging, entry), { recursive: true })
}

rmSync(distRoot, { recursive: true, force: true })
mkdirSync(distRoot, { recursive: true })

for (const entry of readdirSync(staging)) {
  cpSync(join(staging, entry), join(distRoot, entry), { recursive: true })
}

rmSync(staging, { recursive: true, force: true })

if (!existsSync(join(distRoot, 'index.js'))) {
  console.error('[flatten-api-dist] flatten complete but dist/index.js missing')
  process.exit(1)
}

console.info('[flatten-api-dist] canonical emit: apps/api/dist/index.js')
