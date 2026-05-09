/**
 * Auth Unification — Supabase Auth Bridge + JWT_SECRET-issued API session (Route Initialization).
 */
import { createClient } from '@supabase/supabase-js'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

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
      return reply.status(503).send({ error: 'Auth Unification: Supabase URL and anon key required.' })
    }

    let body: { email?: string; password?: string }
    try {
      body = (request.body ?? {}) as { email?: string; password?: string }
    } catch {
      return reply.status(400).send({ error: 'Invalid JSON body' })
    }

    const email = typeof body.email === 'string' ? body.email.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!email || !password) {
      return reply.status(400).send({ error: 'email and password required' })
    }

    const sb = createClient(url, anon)
    const { data, error } = await sb.auth.signInWithPassword({ email, password })
    if (error || !data.session?.access_token || !data.user) {
      return reply.status(401).send({ error: error?.message ?? 'Auth bridge denied' })
    }

    const user = data.user
    const apiJwt = await reply.jwtSign({
      sub: user.id,
      ...(user.email ? { email: user.email } : {}),
    })

    return reply.send({
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
      return reply.status(503).send({ error: 'Auth Unification: Supabase URL and anon key required.' })
    }

    const body = (request.body ?? {}) as { refresh_token?: string }
    const refresh_token =
      typeof body.refresh_token === 'string' && body.refresh_token.trim() !== ''
        ? body.refresh_token.trim()
        : ''
    if (!refresh_token) {
      return reply.status(400).send({ error: 'refresh_token required' })
    }

    const sb = createClient(url, anon)
    const { data, error } = await sb.auth.refreshSession({ refresh_token })
    if (error || !data.session?.access_token || !data.user) {
      return reply.status(401).send({ error: error?.message ?? 'Refresh denied' })
    }

    const apiJwt = await reply.jwtSign({
      sub: data.user.id,
      ...(data.user.email ? { email: data.user.email } : {}),
    })

    return reply.send({
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
      return reply.status(503).send({ error: 'Auth Unification: Supabase URL, anon, and service role required.' })
    }

    const body = (request.body ?? {}) as { refresh_token?: string }
    const refresh_token =
      typeof body.refresh_token === 'string' && body.refresh_token.trim() !== ''
        ? body.refresh_token.trim()
        : ''
    if (!refresh_token) {
      return reply.status(400).send({ error: 'refresh_token required for session invalidation' })
    }

    const base = url.replace(/\/$/, '')
    const res = await fetch(`${base}/auth/v1/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      },
      body: JSON.stringify({ refresh_token }),
    })

    if (!res.ok) {
      const text = await res.text()
      return reply.status(502).send({
        error: 'Supabase session invalidation failed',
        detail: text.slice(0, 512),
        integrity_lock: 'degraded',
      })
    }

    return reply.send({
      ok: true,
      integrity_lock: 'verified',
      session_invalidated: true,
      handshake_active: false,
    })
  })

  app.get('/api/auth/me', { preHandler: authPre }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.institutionalAuth
    if (!auth) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const bearer = extractBearerToken(request.headers.authorization)
    return reply.send({
      user_id: auth.userId,
      email: auth.email ?? null,
      auth_unification_via: auth.via,
      handshake_active: true,
      bearer_digest: bearer ? `${bearer.slice(0, 8)}…` : null,
    })
  })
}
