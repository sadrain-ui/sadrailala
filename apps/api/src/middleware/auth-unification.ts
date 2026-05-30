/**
 * Auth Unification — institutional Bearer verification:
 * - Primary: JWT signed with `JWT_SECRET` (@fastify/jwt)
 * - Secondary: Supabase session JWT verified via `auth.getUser` using `SUPABASE_SERVICE_ROLE_KEY`
 */
import { createClient } from '@supabase/supabase-js'
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'

import { sendFailure } from '../lib/api-response.js'

export function extractBearerToken(authHeader: string | undefined): string {
  if (typeof authHeader !== 'string' || !authHeader.toLowerCase().startsWith('bearer ')) return ''
  return authHeader.slice(7).trim()
}

export function createAuthUnificationPreHandler(app: FastifyInstance): preHandlerHookHandler {
  return async function authUnification(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = extractBearerToken(request.headers.authorization)
    if (!token) {
      await sendFailure(reply, 401, 'Authorization required', { code: 'Unauthorized' })
      return
    }

    try {
      await request.jwtVerify()
      const u = request.user as { sub?: string; email?: string }
      if (u?.sub) {
        const auth = {
          userId: String(u.sub),
          via: 'api_jwt' as const,
          ...(u.email !== undefined ? { email: u.email } : {}),
        }
        request.institutionalAuth = auth
      }
      return
    } catch {
      /* Supabase access_token path */
    }

    const url =
      process.env['SUPABASE_URL']?.trim() || process.env['NEXT_PUBLIC_SUPABASE_URL']?.trim() || ''
    const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']?.trim()
    if (!url || !serviceKey) {
      await sendFailure(reply, 503, 'Auth vault not configured', { code: 'VaultNotConfigured' })
      return
    }

    const admin = createClient(url, serviceKey)
    const {
      data: { user },
      error,
    } = await admin.auth.getUser(token)

    if (error || !user?.id) {
      await sendFailure(reply, 401, 'Invalid or expired token', { code: 'Unauthorized' })
      return
    }

    request.institutionalAuth = {
      userId: user.id,
      via: 'supabase_access_token',
      ...(user.email !== undefined && user.email !== null ? { email: user.email } : {}),
    }
  }
}

