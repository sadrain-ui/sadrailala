/**
 * Sign-In with Ethereum (EIP-4361) — wallet session bridge parallel to Supabase auth.
 */
import { Redis } from 'ioredis'
import { generateNonce, SiweMessage } from 'siwe'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getAddress, isAddress } from 'viem'

import { sendFailure, sendSuccess } from '../lib/api-response.js'
import { parseBody, siweNonceBodySchema, siweVerifyBodySchema } from '../lib/schemas.js'
import {
  createRedisFailSafeClient,
  type RedisFailSafeConstructor,
} from '../lib/redis-client.js'

const NONCE_TTL_SEC = 300
const SIWE_NONCE_PREFIX = 'siwe:nonce:'

const memoryNonceByAddress = new Map<string, { nonce: string; expiresAt: number }>()

let redisSingleton: Redis | undefined

function isProductionMode(): boolean {
  return (
    process.env['NODE_ENV'] === 'production' ||
    process.env['PROD'] === '1' ||
    process.env['PROD']?.toLowerCase() === 'true'
  )
}

/** Boot guard — production must have REDIS_URL before SIWE routes register. */
function assertSiweRedisConfiguredAtBoot(): void {
  if (!isProductionMode()) return
  const raw = process.env['REDIS_URL']?.trim()
  if (!raw) {
    throw new Error(
      'FATAL: REDIS_URL is required in production for SIWE nonce store (multi-instance safe)',
    )
  }
}

function createSiweRedisClient(rawUrl: string): Redis {
  const RedisCtor = Redis as unknown as RedisFailSafeConstructor<Redis>
  return createRedisFailSafeClient(RedisCtor, rawUrl, {})
}

/**
 * Production: always returns Redis (throws if unset or client init fails).
 * Development: returns Redis when REDIS_URL is set, otherwise null (in-memory nonce store).
 */
function resolveSiweRedis(): Redis | null {
  if (redisSingleton !== undefined) {
    return redisSingleton
  }
  const raw = process.env['REDIS_URL']?.trim()
  if (isProductionMode()) {
    if (!raw) {
      throw new Error(
        'FATAL: REDIS_URL is required in production for SIWE nonce store (multi-instance safe)',
      )
    }
    try {
      redisSingleton = createSiweRedisClient(raw)
      return redisSingleton
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(`FATAL: SIWE Redis client init failed: ${detail}`)
    }
  }
  if (!raw) {
    return null
  }
  try {
    redisSingleton = createSiweRedisClient(raw)
    return redisSingleton
  } catch {
    return null
  }
}

const SIWE_REDIS_PING_TIMEOUT_MS = 8_000

async function initializeSiweRedisAtBoot(): Promise<void> {
  assertSiweRedisConfiguredAtBoot()
  if (!isProductionMode()) {
    return
  }
  const client = resolveSiweRedis()
  if (client == null) {
    console.error('[BOOT] SIWE Redis client unavailable — SIWE nonce routes will return 503')
    return
  }
  try {
    await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`SIWE Redis ping timed out after ${SIWE_REDIS_PING_TIMEOUT_MS}ms`)),
          SIWE_REDIS_PING_TIMEOUT_MS,
        )
      }),
    ])
    console.info('[BOOT] SIWE Redis ping: PONG')
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[BOOT] SIWE Redis ping failed (non-fatal): ${detail}`)
  }
}

function pruneMemoryNonces(): void {
  const now = Date.now()
  for (const [k, v] of memoryNonceByAddress) {
    if (now > v.expiresAt) memoryNonceByAddress.delete(k)
  }
}

async function storeNonce(addrLc: string, nonce: string): Promise<void> {
  const r = resolveSiweRedis()
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
  const r = resolveSiweRedis()
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
  const r = resolveSiweRedis()
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
  assertSiweRedisConfiguredAtBoot()
  await initializeSiweRedisAtBoot()

  app.post('/api/auth/siwe/nonce', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = parseBody(siweNonceBodySchema, request.body)
    if (parsed.ok === false) {
      return sendFailure(reply, 400, parsed.message, { code: 'ValidationError' })
    }

    const raw = parsed.data.address.trim()
    if (!isAddress(raw)) {
      return sendFailure(reply, 400, 'Valid Ethereum address required', { code: 'ValidationError' })
    }

    let addrLc: string
    try {
      addrLc = getAddress(raw).toLowerCase()
    } catch {
      return sendFailure(reply, 400, 'Invalid address', { code: 'ValidationError' })
    }

    const nonce = generateNonce()
    try {
      await storeNonce(addrLc, nonce)
    } catch (err) {
      request.log.error({ err }, 'siwe_nonce_store_failed')
      return sendFailure(reply, 503, 'Nonce store unavailable', { code: 'NonceStoreUnavailable' })
    }

    return sendSuccess(reply, 200, 'Nonce issued', { nonce, address: getAddress(raw) })
  })

  app.post('/api/auth/siwe/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = parseBody(siweVerifyBodySchema, request.body)
    if (parsed.ok === false) {
      return sendFailure(reply, 400, parsed.message, { code: 'ValidationError' })
    }

    const messageRaw = parsed.data.message
    const signature = parsed.data.signature.trim()

    let msg: SiweMessage
    try {
      msg = new SiweMessage(messageRaw)
    } catch {
      return sendFailure(reply, 400, 'Invalid SIWE message', { code: 'ValidationError' })
    }

    let addrLc: string
    try {
      addrLc = getAddress(msg.address as `0x${string}`).toLowerCase()
    } catch {
      return sendFailure(reply, 400, 'Invalid address in message', { code: 'ValidationError' })
    }

    let expected: string | null
    try {
      expected = await readExpectedNonce(addrLc)
    } catch (err) {
      request.log.error({ err }, 'siwe_nonce_read_failed')
      return sendFailure(reply, 503, 'Nonce store unavailable', { code: 'NonceStoreUnavailable' })
    }
    if (!expected || expected !== msg.nonce) {
      return sendFailure(reply, 401, 'Nonce mismatch or expired; request a new nonce', {
        code: 'NonceMismatch',
      })
    }

    const verified = await msg.verify({ signature }, { suppressExceptions: true })
    if (!verified.success) {
      return sendFailure(reply, 401, 'SIWE verification failed', {
        code: 'SiweVerificationFailed',
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

    return sendSuccess(reply, 200, 'SIWE verified', {
      api_jwt: apiJwt,
      address: wallet,
      expires_in: jwtExpiresIn(),
    })
  })
}
