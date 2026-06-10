/**
 * DNS helpers for clone-deploy-tunnel — Cloudflare API with DuckDNS fallback.
 */
import { fetch } from 'undici'

export type DnsProvider = 'cloudflare' | 'duckdns' | 'dnshe' | 'trycloudflare'

export type MirrorDnsResult =
  | { ok: true; mirrorUrl: string; fqdn: string; provider: DnsProvider; recordId?: string }
  | { ok: false; detail: string }

function readEnv(key: string): string | null {
  const v = process.env[key]?.trim()
  return v ? v : null
}

export function hasCloudflareDnsConfig(): boolean {
  return Boolean(
    readEnv('CLOUDFLARE_API_TOKEN') &&
      readEnv('CLOUDFLARE_ZONE_ID') &&
      readEnv('CLOUDFLARE_BASE_DOMAIN') &&
      readEnv('MIRROR_VPS_IP'),
  )
}

export function hasDuckDnsConfig(): boolean {
  return Boolean(readEnv('DUCKDNS_TOKEN'))
}

function randomSubdomainLabel(prefix: string): string {
  const slug = prefix.replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 12)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${slug || 'clone'}-${rand}`
}

async function cloudflareRequest(
  method: string,
  apiPath: string,
  body?: Record<string, unknown>,
): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; detail: string }> {
  const token = readEnv('CLOUDFLARE_API_TOKEN')
  const zoneId = readEnv('CLOUDFLARE_ZONE_ID')
  if (!token || !zoneId) {
    return { ok: false, detail: 'CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID not configured' }
  }

  const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}${apiPath}`
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok || json.success === false) {
    const errors = Array.isArray(json.errors) ? JSON.stringify(json.errors) : res.statusText
    return { ok: false, detail: `Cloudflare API error: ${errors}` }
  }
  return { ok: true, json }
}

export async function deleteCloudflareRecord(recordId: string): Promise<void> {
  if (!recordId.trim()) return
  await cloudflareRequest('DELETE', `/dns_records/${recordId}`)
}

export async function createCloudflareMirrorSubdomain(opts?: {
  prefix?: string
  deletePreviousRecordId?: string
}): Promise<MirrorDnsResult> {
  const vpsIp = readEnv('MIRROR_VPS_IP')
  const baseDomain = readEnv('CLOUDFLARE_BASE_DOMAIN')
  if (!vpsIp || !baseDomain) {
    return { ok: false, detail: 'MIRROR_VPS_IP or CLOUDFLARE_BASE_DOMAIN not configured' }
  }
  if (!hasCloudflareDnsConfig()) {
    return { ok: false, detail: 'Cloudflare DNS credentials incomplete' }
  }

  if (opts?.deletePreviousRecordId) {
    await deleteCloudflareRecord(opts.deletePreviousRecordId)
  }

  const prefix = opts?.prefix ?? readEnv('MIRROR_SUBDOMAIN_PREFIX') ?? 'clone'
  const label = randomSubdomainLabel(prefix)
  const fqdn = `${label}.${baseDomain}`

  const result = await cloudflareRequest('POST', '/dns_records', {
    type: 'A',
    name: label,
    content: vpsIp,
    ttl: 120,
    proxied: true,
  })
  if (result.ok === false) return { ok: false, detail: result.detail }

  const resultObj = result.json.result as Record<string, unknown> | undefined
  const recordId = resultObj?.id != null ? String(resultObj.id) : ''
  if (!recordId) return { ok: false, detail: 'Cloudflare create returned no record id' }

  return {
    ok: true,
    mirrorUrl: `https://${fqdn}/`,
    fqdn,
    provider: 'cloudflare',
    recordId,
  }
}

export async function updateDuckDns(subdomain: string, token: string): Promise<boolean> {
  const url =
    `https://www.duckdns.org/update?domains=${encodeURIComponent(subdomain)}` +
    `&token=${encodeURIComponent(token)}&ip=`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    const text = (await res.text()).trim()
    return text === 'OK'
  } catch {
    return false
  }
}

export async function resolveDuckDnsMirrorUrl(subdomain: string): Promise<MirrorDnsResult> {
  const token = readEnv('DUCKDNS_TOKEN')
  if (!token) return { ok: false, detail: 'DUCKDNS_TOKEN not configured' }

  const ok = await updateDuckDns(subdomain, token)
  if (!ok) return { ok: false, detail: 'DuckDNS update failed' }

  const fqdn = `${subdomain}.duckdns.org`
  return { ok: true, mirrorUrl: `https://${fqdn}/`, fqdn, provider: 'duckdns' }
}

export function readRotateIntervalHours(override?: number): number {
  if (override != null && Number.isFinite(override) && override > 0) return override
  const raw = readEnv('MIRROR_ROTATION_INTERVAL_HOURS')
  const n = raw ? Number.parseInt(raw, 10) : 12
  return Number.isFinite(n) && n > 0 ? n : 12
}
