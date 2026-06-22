/**
 * Auth Unification — institutional Bearer verification:
 * - Primary: JWT signed with `JWT_SECRET` (@fastify/jwt)
 * - Secondary: Supabase session JWT verified via `auth.getUser` using `SUPABASE_SERVICE_ROLE_KEY`
 *
 * FIX: Added comprehensive auth validation, session tracking, and proper error responses
 */
import { createClient } from '@supabase/supabase-js'
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'

import { sendFailure } from '../lib/api-response.js'

// Session tracking for rate limiting and audit
const sessionCache = new Map<string, { userId: string; lastUsed: number; via: string }>()
const SESSION_TTL_MS = 3600000 // 1 hour

export function extractBearerToken(authHeader: string | undefined): string {
  if (typeof authHeader !== 'string' || !authHeader.toLowerCase().startsWith('bearer ')) return ''
  return authHeader.slice(7).trim()
}

/**
 * Clean expired sessions from cache (runs periodically)
 */
export function cleanExpiredSessions(): void {
  const now = Date.now()
  for (const [key, session] of sessionCache.entries()) {
    if (now - session.lastUsed > SESSION_TTL_MS) {
      sessionCache.delete(key)
    }
  }
}

// Auto-cleanup every 5 minutes
setInterval(cleanExpiredSessions, 5 * 60 * 1000)

export function createAuthUnificationPreHandler(app: FastifyInstance): preHandlerHookHandler {
  return async function authUnification(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = extractBearerToken(request.headers.authorization)
    if (!token) {
      await sendFailure(reply, 401, 'Authorization required', {
        code: 'MissingAuthorizationHeader',
        detail: 'Bearer token required in Authorization header',
      })
      return
    }

    // Validate token format (basic security check)
    if (token.length < 10 || token.length > 10000) {
      await sendFailure(reply, 401, 'Invalid token format', {
        code: 'InvalidTokenFormat',
        detail: 'Token length out of acceptable range',
      })
      return
    }

    try {
      // Verify JWT signature using @fastify/jwt
      await request.jwtVerify()
      const u = request.user as { sub?: string; email?: string }
      if (u?.sub) {
        const auth = {
          userId: String(u.sub),
          via: 'api_jwt' as const,
          ...(u.email !== undefined ? { email: u.email } : {}),
        }
        request.institutionalAuth = auth

        // Track session
        const sessionKey = `${auth.userId}:${auth.via}`
        sessionCache.set(sessionKey, {
          userId: auth.userId,
          lastUsed: Date.now(),
          via: auth.via,
        })
        return
      }
    } catch (jwtError) {
      // JWT verification failed, try Supabase path
    }

    // FIX: Add proper Supabase auth validation
    const url =
      process.env['SUPABASE_URL']?.trim() || process.env['NEXT_PUBLIC_SUPABASE_URL']?.trim() || ''
    const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']?.trim()
    if (!url || !serviceKey) {
      app.log.warn('[AUTH] Supabase not configured - cannot validate Supabase tokens')
      await sendFailure(reply, 503, 'Auth vault not configured', {
        code: 'VaultNotConfigured',
        detail: 'Supabase auth is not properly configured',
      })
      return
    }

    try {
      const admin = createClient(url, serviceKey)
      const {
        data: { user },
        error,
      } = await admin.auth.getUser(token)

      if (error || !user?.id) {
        app.log.warn(
          { error: error?.message, hasUser: !!user },
          '[AUTH] Supabase token validation failed'
        )
        await sendFailure(reply, 401, 'Invalid or expired token', {
          code: 'InvalidSupabaseToken',
          detail: error?.message ?? 'Token validation failed',
        })
        return
      }

      request.institutionalAuth = {
        userId: user.id,
        via: 'supabase_access_token',
        ...(user.email !== undefined && user.email !== null ? { email: user.email } : {}),
      }

      // Track session
      const sessionKey = `${user.id}:supabase`
      sessionCache.set(sessionKey, {
        userId: user.id,
        lastUsed: Date.now(),
        via: 'supabase_access_token',
      })
    } catch (supabaseError) {
      const errorMsg = supabaseError instanceof Error ? supabaseError.message : 'Unknown error'
      app.log.error({ error: errorMsg }, '[AUTH] Supabase auth error')
      await sendFailure(reply, 500, 'Auth verification failed', {
        code: 'AuthVerificationError',
        detail: 'Internal error during token validation',
      })
    }
  }
}

/**
 * Get active sessions count (for monitoring)
 */
export function getActiveSessions(): number {
  return sessionCache.size
}

