/**
 * Appends .js to relative import/export paths for NodeNext ESM resolution.
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['packages/core/src', 'apps/api/src']

const FROM_RE = /((?:from|export\s+\*\s+from)\s+['"])(\.\.?\/[^'"]+)(['"])/g
const DYNAMIC_RE = /(import\s*\(\s*['"])(\.\.?\/[^'"]+)(['"]\s*\))/g

function hasExtension(spec) {
  return /\.(js|json|node|mjs|cjs)$/.test(spec)
}

function fixContent(content) {
  const apply = (text, re) =>
    text.replace(re, (full, prefix, spec, suffix) => {
      if (hasExtension(spec)) return full
      return `${prefix}${spec}.js${suffix}`
    })
  return apply(apply(content, FROM_RE), DYNAMIC_RE)
}

function walkTsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      walkTsFiles(p, out)
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      out.push(p)
    }
  }
  return out
}

let changed = 0
for (const root of ROOTS) {
  for (const file of walkTsFiles(root)) {
    const before = readFileSync(file, 'utf8')
    const after = fixContent(before)
    if (after !== before) {
      writeFileSync(file, after, 'utf8')
      changed++
    }
  }
}

console.log(`fix-relative-imports: updated ${changed} file(s)`)
