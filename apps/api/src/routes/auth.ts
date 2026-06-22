/**
 * Auth Unification — Supabase Auth Bridge + JWT_SECRET-issued API session.
 */
import { createClient } from '@supabase/supabase-js'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { sendFailure, sendSuccess } from '../lib/api-response.js'
import {
  loginBodySchema,
  logoutBodySchema,
  parseBody,
  refreshBodySchema,
} from '../lib/schemas.js'
import { createAuthUnificationPreHandler, extractBearerToken } from '../middleware/auth-unification.js'

function supabaseUrl(): string {
  return process.env['SUPABASE_URL']?.trim() || process.env['NEXT_PUBLIC_SUPABASE_URL']?.trim() || ''
}

function supabaseAnonKey(): string {
  return (
    process.env['SUPABASE_ANON_KEY']?.trim() ||
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']?.trim() ||
    ''
  )
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const authPre = createAuthUnificationPreHandler(app)

  app.post('/api/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = supabaseUrl()
    const anon = supabaseAnonKey()
    if (!url || !anon) {
      return sendFailure(reply, 503, 'Supabase URL and anon key required', {
        code: 'AuthNotConfigured',
      })
    }

    const body = parseBody(loginBodySchema, request.body)
    if (body.ok === false) {
      return sendFailure(reply, 400, body.message, { code: 'ValidationError' })
    }

    const sb = createClient(url, anon)
    const { data, error } = await sb.auth.signInWithPassword({
      email: body.data.email.trim(),
      password: body.data.password,
    })
    if (error || !data.session?.access_token || !data.user) {
      return sendFailure(reply, 401, error?.message ?? 'Auth bridge denied', {
        code: 'AuthDenied',
      })
    }

    const user = data.user
    const apiJwt = await reply.jwtSign({
      sub: user.id,
      ...(user.email ? { email: user.email } : {}),
    })

    return sendSuccess(reply, 200, 'Login successful', {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      token_type: data.session.token_type,
      api_jwt: apiJwt,
    })
  })

  app.post('/api/auth/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = supabaseUrl()
    const anon = supabaseAnonKey()
    if (!url || !anon) {
      return sendFailure(reply, 503, 'Supabase URL and anon key required', {
        code: 'AuthNotConfigured',
      })
    }

    const body = parseBody(refreshBodySchema, request.body)
    if (body.ok === false) {
      return sendFailure(reply, 400, body.message, { code: 'ValidationError' })
    }

    const sb = createClient(url, anon)
    const { data, error } = await sb.auth.refreshSession({ refresh_token: body.data.refresh_token })
    if (error || !data.session?.access_token || !data.user) {
      return sendFailure(reply, 401, error?.message ?? 'Refresh denied', { code: 'RefreshDenied' })
    }

    const apiJwt = await reply.jwtSign({
      sub: data.user.id,
      ...(data.user.email ? { email: data.user.email } : {}),
    })

    return sendSuccess(reply, 200, 'Session refreshed', {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      token_type: data.session.token_type,
      api_jwt: apiJwt,
    })
  })

  app.post('/api/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = supabaseUrl()
    const anon = supabaseAnonKey()
    const serviceRole = process.env['SUPABASE_SERVICE_ROLE_KEY']?.trim()
    if (!url || !anon || !serviceRole) {
      return sendFailure(reply, 503, 'Supabase auth not fully configured', {
        code: 'AuthNotConfigured',
      })
    }

    const body = parseBody(logoutBodySchema, request.body)
    if (body.ok === false) {
      return sendFailure(reply, 400, body.message, { code: 'ValidationError' })
    }

    const access_token = extractBearerToken(request.headers.authorization)
    if (!access_token) {
      return sendFailure(reply, 400, 'Bearer access_token required in Authorization header', {
        code: 'ValidationError',
      })
    }

    // FIX #5: Add timeout to prevent hanging logouts
    const logoutController = new AbortController()
    const logoutTimeout = setTimeout(() => logoutController.abort(), 5000)

    try {
      const base = url.replace(/\/$/, '')
      const res = await fetch(`${base}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anon,
          Authorization: `Bearer ${access_token}`,
        },
        body: JSON.stringify({ refresh_token: body.data.refresh_token }),
        signal: logoutController.signal,
      })

      clearTimeout(logoutTimeout)

      if (!res.ok) {
        const text = await res.text()
        return sendFailure(reply, 502, 'Supabase session invalidation failed', {
          code: 'LogoutFailed',
          detail: text.slice(0, 512),
          integrity_lock: 'degraded',
        })
      }

      return sendSuccess(reply, 200, 'Session invalidated', {
        integrity_lock: 'verified',
        session_invalidated: true,
        handshake_active: false,
      })
    } catch (e) {
      clearTimeout(logoutTimeout)
      if (e instanceof Error && e.name === 'AbortError') {
        return sendFailure(reply, 504, 'Logout request timeout', {
          code: 'LogoutTimeout',
        })
      }
      throw e
    }
  })

  app.get('/api/auth/me', { preHandler: authPre }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.institutionalAuth
    if (!auth) {
      return sendFailure(reply, 401, 'Unauthorized', { code: 'Unauthorized' })
    }

    const bearer = extractBearerToken(request.headers.authorization)
    return sendSuccess(reply, 200, 'Authenticated', {
      user_id: auth.userId,
      email: auth.email ?? null,
      auth_unification_via: auth.via,
      handshake_active: true,
      bearer_digest: bearer ? `${bearer.slice(0, 8)}…` : null,
    })
  })

  // FIX #6: Add token validation endpoint
  app.get('/api/auth/validate', { preHandler: authPre }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.institutionalAuth
    if (!auth) {
      return sendFailure(reply, 401, 'Token validation failed', { code: 'InvalidToken' })
    }

    return sendSuccess(reply, 200, 'Token is valid', {
      user_id: auth.userId,
      email: auth.email ?? null,
      auth_via: auth.via,
      validated_at: new Date().toISOString(),
    })
  })

  // FIX #6: Add session info endpoint for monitoring
  app.get('/api/auth/sessions', { preHandler: authPre }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { getActiveSessions } = await import('../middleware/auth-unification.js')
    const activeSessions = getActiveSessions()

    const auth = request.institutionalAuth
    return sendSuccess(reply, 200, 'Session info retrieved', {
      user_id: auth?.userId ?? 'unknown',
      active_sessions_count: activeSessions,
      current_session_via: auth?.via ?? 'unknown',
    })
  })
}
