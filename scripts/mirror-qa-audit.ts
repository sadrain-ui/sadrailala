/**
 * Mirror QA audit — HTTP checks + optional Puppeteer performance/console scan.
 * Usage: npx tsx scripts/mirror-qa-audit.ts [base-url]
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const baseUrl = (process.argv[2] ?? 'http://127.0.0.1:8080').replace(/\/$/, '')
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

type Finding = {
  area: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}

const findings: Finding[] = []

function record(area: string, status: Finding['status'], detail: string): void {
  findings.push({ area, status, detail })
}

async function httpCheck(
  url: string,
  opts?: { expectBody?: RegExp; label?: string },
): Promise<{ status: number; body: string; ms: number }> {
  const t0 = Date.now()
  const res = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
  })
  const body = await res.text()
  const ms = Date.now() - t0
  const label = opts?.label ?? url
  if (!res.ok) {
    record(label, 'fail', `HTTP ${res.status} (${ms}ms)`)
  } else if (opts?.expectBody && !opts.expectBody.test(body)) {
    record(label, 'warn', `HTTP ${res.status} but pattern missing (${ms}ms)`)
  } else {
    record(label, 'pass', `HTTP ${res.status} (${ms}ms)`)
  }
  return { status: res.status, body, ms }
}

async function runHttpAudit(): Promise<void> {
  const home = await httpCheck(`${baseUrl}/`, {
    label: 'Reverse proxy /',
    expectBody: /id=["']root["']|legion-authorized-drain/i,
  })

  if (/legion-authorized-drain\.js/i.test(home.body)) {
    record('Script injection', 'pass', 'legion-authorized-drain.js referenced in HTML')
  } else if (/legion-authorized-drain/i.test(home.body)) {
    record('Script injection', 'warn', 'legion reference found but script tag unclear')
  } else {
    record('Script injection', 'fail', 'legion-authorized-drain.js not in proxied HTML')
  }

  const csp = home.body.match(/content-security-policy/i)
  record('CSP in HTML', csp ? 'warn' : 'pass', csp ? 'inline CSP meta present' : 'no inline CSP meta')

  await httpCheck(`${baseUrl}/mirror-health`, { label: 'mirror-health' })
  const script = await httpCheck(`${baseUrl}/legion-authorized-drain.js`, {
    label: 'legion-authorized-drain.js',
    expectBody: /window\.ethereum|LEGION_AUTH/i,
  })
  if (script.body.includes('window.ethereum')) {
    record('Wallet simulation', 'pass', 'script references window.ethereum')
  } else {
    record('Wallet simulation', 'warn', 'window.ethereum hook not found in script body')
  }

  await httpCheck(`${baseUrl}/legion-authorized-drain.css`, { label: 'legion-authorized-drain.css' })
}

async function runPuppeteerAudit(): Promise<void> {
  let puppeteer: typeof import('puppeteer')
  try {
    puppeteer = await import('puppeteer')
  } catch {
    record('Puppeteer', 'warn', 'puppeteer not installed — skipping browser audit')
    return
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  await page.setUserAgent(BROWSER_UA)
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })

  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  const t0 = Date.now()
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  const domMs = Date.now() - t0

  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector('script[src*="legion-authorized-drain"]') ||
          document.getElementById('legion-auth-panel'),
      ),
    { timeout: 15_000 },
  ).catch(() => undefined)

  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    return {
      domInteractive: nav?.domInteractive ?? 0,
      loadEventEnd: nav?.loadEventEnd ?? 0,
      hasPanel: Boolean(document.getElementById('legion-auth-panel')),
      hasScript: Boolean(document.querySelector('script[src*="legion-authorized-drain"]')),
      hasEthereum: typeof (window as Window & { ethereum?: unknown }).ethereum !== 'undefined',
    }
  })

  record(
    'DOM interactive',
    domMs > 15_000 ? 'warn' : 'pass',
    `${Math.round(metrics.domInteractive || domMs)}ms (navigation domInteractive)`,
  )
  record(
    'Wallet panel',
    metrics.hasPanel ? 'pass' : 'warn',
    metrics.hasPanel
      ? '#legion-auth-panel in DOM'
      : 'silent/production mode — panel hidden; use CLONE_MIRROR_QA_UI=true or native Connect',
  )
  record(
    'Script in DOM',
    metrics.hasScript ? 'pass' : 'fail',
    metrics.hasScript ? 'legion-authorized-drain.js tag present' : 'script tag missing',
  )

  if (consoleErrors.length === 0) {
    record('Browser console', 'pass', 'no errors')
  } else {
    record('Browser console', 'warn', consoleErrors.slice(0, 5).join(' | '))
  }

  await browser.close()
}

async function main(): Promise<void> {
  console.log(`\n=== Mirror QA Audit: ${baseUrl} ===\n`)
  await runHttpAudit()
  await runPuppeteerAudit()

  console.log('| Area | Status | Detail |')
  console.log('|------|--------|--------|')
  for (const f of findings) {
    console.log(`| ${f.area} | ${f.status} | ${f.detail.replace(/\|/g, '/')} |`)
  }

  const failCount = findings.filter((f) => f.status === 'fail').length
  const reportPath = path.join(process.cwd(), 'tmp', 'mirror-qa-audit.json')
  await import('node:fs/promises').then((fs) =>
    fs.mkdir(path.dirname(reportPath), { recursive: true }).then(() =>
      fs.writeFile(reportPath, `${JSON.stringify({ baseUrl, findings, at: new Date().toISOString() }, null, 2)}\n`),
    ),
  )
  console.log(`\nReport: ${reportPath}`)
  process.exit(failCount > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
