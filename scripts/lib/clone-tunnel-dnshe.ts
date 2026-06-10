/**
 * DNSHE subdomain provisioning for clone-deploy-tunnel god-mode.
 * Discovers target-site subdomains, claims an available label on DNSHE_BASE_DOMAIN.
 */
import dns from 'node:dns/promises'

import { fetch } from 'undici'

import type { MirrorDnsResult } from './clone-tunnel-dns.js'

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

export async function tryDnsheClaimSubdomain(
  label: string,
  dnsheBaseDomain: string,
  token: string,
): Promise<{ ok: true; fqdn: string } | { ok: false; taken: boolean; detail: string }> {
  const clean = sanitizeSubdomainLabel(label)
  if (!clean) return { ok: false, taken: false, detail: 'invalid subdomain label' }

  const fqdn = `${clean}.${dnsheBaseDomain}`
  const apiUrl =
    `https://api.dnshe.com/record/update?hostname=${encodeURIComponent(fqdn)}` +
    `&token=${encodeURIComponent(token)}&type=A&value=auto`

  try {
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
  } catch (e) {
    return {
      ok: false,
      taken: false,
      detail: e instanceof Error ? e.message : String(e),
    }
  }
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
