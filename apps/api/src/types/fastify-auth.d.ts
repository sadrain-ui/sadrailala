import '@fastify/jwt'

declare module 'fastify' {
  interface FastifyRequest {
    /** Auth Unification — API JWT (JWT_SECRET) or Supabase access_token (SUPABASE_SERVICE_ROLE_KEY verification plane). */
    institutionalAuth?: {
      userId: string
      email?: string | null
      via: 'api_jwt' | 'supabase_access_token'
    }
  }
}
