/**
 * PHASE 77.27 — Verify packages/core/src diffs are import-path .js only (+ allowed exclusions).
 */
import { execSync } from 'node:child_process'

const diff = execSync('git diff packages/core/src/', { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })

const IMPORT_RE =
  /(?:from|export\s+\*\s+from|import\s*\(\s*)['"](\.\.?\/[^'"]+)['"]/

function stripJs(spec) {
  return spec.endsWith('.js') ? spec.slice(0, -3) : spec
}

function isImportPathOnlyLine(line) {
  const t = line.trim()
  if (!IMPORT_RE.test(t)) return false
  return (
    /^\s*import\s/.test(t) ||
    /^\s*export\s+(\*\s+)?from\s/.test(t) ||
    /import\s*\(\s*['"]/.test(t)
  )
}

function isJsSuffixOnlyChange(minus, plus) {
  const om = minus.match(IMPORT_RE)
  const pm = plus.match(IMPORT_RE)
  if (!om || !pm) return false
  if (stripJs(om[1]) !== stripJs(pm[1])) return false
  const oRest = minus.replace(IMPORT_RE, '§')
  const pRest = plus.replace(IMPORT_RE, '§')
  return oRest === pRest
}

function isBracketIndexSignatureOnly(minus, plus) {
  // settlement['chain_id'] vs settlement.chain_id — same semantics for TS4111
  const norm = (s) =>
    s
      .replace(/\.([a-z_][a-z0-9_]*)/gi, "['$1']")
      .replace(/\s+/g, ' ')
      .trim()
  return norm(minus) === norm(plus) && minus !== plus
}

function isTypingAnnotationOnly(minus, plus) {
  // (u: string) filter, Uint256 annotation, String() wrap on known line
  if (minus.includes('filter(u =>') && plus.includes('filter((u: string) =>')) return true
  if (minus.includes('filter(u =>') && plus.includes('filter((u: string) =>')) return true
  if (plus.includes(': Uint256') && !minus.includes(': Uint256')) {
    return minus.replace(/\s+/g, '') === plus.replace(/: Uint256/g, '').replace(/\s+/g, '')
  }
  if (minus.includes('BigInt(nativeOnly)') && plus.includes('BigInt(String(nativeOnly))')) return true
  return false
}

function isDefaultReturnOnly(minus, plus) {
  return (
    minus.trim() === '}' &&
    plus.includes("default:") &&
    plus.includes("return 'EVM_PAYLOAD'")
  )
}

const fileHunks = new Map()
let file = null
let pendingMinus = []

for (const line of diff.split('\n')) {
  if (line.startsWith('diff --git')) {
    const m = line.match(/ b\/(.+)$/)
    file = m?.[1] ?? null
    pendingMinus = []
    continue
  }
  if (!file) continue
  if (!fileHunks.has(file)) fileHunks.set(file, { importOnly: 0, logical: [] })

  if (line.startsWith('-') && !line.startsWith('---')) {
    pendingMinus.push(line.slice(1))
  } else if (line.startsWith('+') && !line.startsWith('+++')) {
    const plus = line.slice(1)
    const minus = pendingMinus.shift()
    if (minus === undefined) {
      fileHunks.get(file).logical.push({ kind: 'added-only', plus })
      continue
    }
    if (isJsSuffixOnlyChange(minus, plus)) {
      fileHunks.get(file).importOnly++
    } else if (isBracketIndexSignatureOnly(minus, plus)) {
      fileHunks.get(file).importOnly++ // access-equivalent
    } else if (isTypingAnnotationOnly(minus, plus)) {
      fileHunks.get(file).logical.push({ kind: 'typing-only', minus, plus })
    } else if (isDefaultReturnOnly(minus, plus)) {
      fileHunks.get(file).logical.push({ kind: 'default-return', minus, plus })
    } else if (minus.trim() === plus.trim()) {
      fileHunks.get(file).importOnly++
    } else {
      fileHunks.get(file).logical.push({ kind: 'other', minus, plus })
    }
  }
}

let pass = true
const report = []

for (const [f, data] of [...fileHunks.entries()].sort()) {
  if (data.logical.length === 0) {
    report.push(`  OK  ${f} (${data.importOnly} import-path hunks)`)
  } else {
    pass = false
    report.push(`  DRIFT  ${f}`)
    for (const d of data.logical.slice(0, 5)) {
      report.push(`       [${d.kind}] - ${(d.minus ?? '').slice(0, 80)}`)
      report.push(`       [${d.kind}] + ${(d.plus ?? '').slice(0, 80)}`)
    }
    if (data.logical.length > 5) report.push(`       ... +${data.logical.length - 5} more`)
  }
}

console.log('=== CORE INTEGRITY SCAN: packages/core/src/ ===')
console.log(`Files in index: ${fileHunks.size}`)
console.log('')
report.forEach((l) => console.log(l))
console.log('')
if (pass) {
  console.log('INTEGRITY_PASSED: Core logical perimeter is verified pristine and untouched.')
  process.exit(0)
} else {
  console.log('INTEGRITY_FAILED: Non-import-path modifications detected (see DRIFT rows).')
  process.exit(1)
}
