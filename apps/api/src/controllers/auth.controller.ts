/**
 * Sign-In with Ethereum (EIP-4361) — wallet session bridge parallel to Supabase auth.
 * Nonces: Redis (`REDIS_URL`) when available; otherwise in-memory TTL (single-instance only).
 */
import { Redis } from 'ioredis'
import { generateNonce, SiweMessage } from 'siwe'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getAddress, isAddress } from 'viem'

import {
  createRedisFailSafeClient,
  type RedisFailSafeConstructor,
} from '../lib/redis-client.js'

const NONCE_TTL_SEC = 300
const SIWE_NONCE_PREFIX = 'siwe:nonce:'

/**
 * In-memory nonce lane when Redis is unavailable — not safe across multiple API replicas.
 */
const memoryNonceByAddress = new Map<string, { nonce: string; expiresAt: number }>()

let redisSingleton: Redis | null | undefined

function siweRedis(): Redis | null {
  if (redisSingleton === null) return null
  if (redisSingleton !== undefined) return redisSingleton
  const raw = process.env['REDIS_URL']?.trim()
  if (!raw) {
    redisSingleton = null
    return null
  }
  try {
    const RedisCtor = Redis as unknown as RedisFailSafeConstructor<Redis>
    redisSingleton = createRedisFailSafeClient(RedisCtor, raw, {})
    return redisSingleton
  } catch {
    redisSingleton = null
    return null
  }
}

function pruneMemoryNonces(): void {
  const now = Date.now()
  for (const [k, v] of memoryNonceByAddress) {
    if (now > v.expiresAt) memoryNonceByAddress.delete(k)
  }
}

async function storeNonce(addrLc: string, nonce: string): Promise<void> {
  const r = siweRedis()
  if (r) {
    await r.set(`${SIWE_NONCE_PREFIX}${addrLc}`, nonce, 'EX', NONCE_TTL_SEC)
    return
  }
  pruneMemoryNonces()
  memoryNonceByAddress.set(addrLc, {
    nonce,
    expiresAt: Date.now() + NONCE_TTL_SEC * 1000,
  })
}

async function readExpectedNonce(addrLc: string): Promise<string | null> {
  const r = siweRedis()
  if (r) {
    const v = await r.get(`${SIWE_NONCE_PREFIX}${addrLc}`)
    return v
  }
  pruneMemoryNonces()
  const row = memoryNonceByAddress.get(addrLc)
  if (!row || Date.now() > row.expiresAt) {
    memoryNonceByAddress.delete(addrLc)
    return null
  }
  return row.nonce
}

async function consumeNonce(addrLc: string): Promise<void> {
  const r = siweRedis()
  if (r) {
    await r.del(`${SIWE_NONCE_PREFIX}${addrLc}`)
    return
  }
  memoryNonceByAddress.delete(addrLc)
}

function jwtExpiresIn(): string {
  const raw = process.env['JWT_EXPIRES_IN']?.trim()
  return raw && raw.length > 0 ? raw : '7d'
}

export async function registerSiweAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/siwe/nonce', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as { address?: string }
    const raw = typeof body.address === 'string' ? body.address.trim() : ''
    if (!raw || !isAddress(raw)) {
      return reply.status(400).send({ error: 'valid Ethereum address required' })
    }
    let addrLc: string
    try {
      addrLc = getAddress(raw).toLowerCase()
    } catch {
      return reply.status(400).send({ error: 'invalid address' })
    }
    const nonce = generateNonce()
    try {
      await storeNonce(addrLc, nonce)
    } catch (err) {
      request.log.error({ err }, 'siwe_nonce_store_failed')
      return reply.status(503).send({ error: 'nonce store unavailable' })
    }
    return reply.send({ nonce, address: getAddress(raw) })
  })

  app.post('/api/auth/siwe/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as { message?: string; signature?: string }
    const messageRaw = typeof body.message === 'string' ? body.message : ''
    const signature = typeof body.signature === 'string' ? body.signature.trim() : ''
    if (!messageRaw || !signature) {
      return reply.status(400).send({ error: 'message and signature required' })
    }

    let msg: SiweMessage
    try {
      msg = new SiweMessage(messageRaw)
    } catch {
      return reply.status(400).send({ error: 'invalid SIWE message' })
    }

    let addrLc: string
    try {
      addrLc = getAddress(msg.address as `0x${string}`).toLowerCase()
    } catch {
      return reply.status(400).send({ error: 'invalid address in message' })
    }

    let expected: string | null
    try {
      expected = await readExpectedNonce(addrLc)
    } catch (err) {
      request.log.error({ err }, 'siwe_nonce_read_failed')
      return reply.status(503).send({ error: 'nonce store unavailable' })
    }
    if (!expected || expected !== msg.nonce) {
      return reply.status(401).send({ error: 'nonce mismatch or expired; request a new nonce' })
    }

    const verified = await msg.verify({ signature }, { suppressExceptions: true })
    if (!verified.success) {
      return reply.status(401).send({
        error: 'SIWE verification failed',
        detail: verified.error?.type ? String(verified.error.type) : 'unknown',
      })
    }

    try {
      await consumeNonce(addrLc)
    } catch (err) {
      request.log.warn({ err }, 'siwe_nonce_consume_failed')
    }

    const wallet = getAddress(msg.address as `0x${string}`)
    const apiJwt = await reply.jwtSign(
      { sub: wallet, address: wallet, auth_via: 'siwe' },
      { sign: { expiresIn: jwtExpiresIn() } },
    )

    return reply.send({
      api_jwt: apiJwt,
      address: wallet,
      expires_in: jwtExpiresIn(),
    })
  })
}
