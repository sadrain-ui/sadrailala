/**
 * LEVEL 7: Authentication System Mock
 *
 * Complete authentication system simulation:
 * - Session management (cookie-based)
 * - JWT token generation + validation
 * - OAuth 2.0 flow simulation
 * - Multi-factor authentication
 * - Password hashing
 * - Token refresh
 * - Role-based access control (RBAC)
 *
 * Result: Full auth compatibility without external services
 */

export interface User {
  id: number
  email: string
  password_hash: string
  name: string
  role: 'admin' | 'user' | 'guest'
  mfa_enabled: boolean
  mfa_secret?: string
  created_at: string
  last_login?: string
}

export interface Session {
  id: string
  user_id: number
  token: string
  refresh_token: string
  expires_at: number
  created_at: number
}

export interface JWTPayload {
  sub: string // user ID
  email: string
  role: string
  iat: number // issued at
  exp: number // expires at
  iss: string // issuer
}

export class EcosystemAuthMock {
  private users: Map<number, User> = new Map()
  private sessions: Map<string, Session> = new Map()
  private jwtSecret: string = 'mock_jwt_secret_' + Math.random().toString(36)
  private sessionStore: Map<string, any> = new Map()

  constructor() {
    this.initializeDefaultUsers()
  }

  /**
   * Initialize with default test users
   */
  private initializeDefaultUsers(): void {
    const defaultUsers: User[] = [
      {
        id: 1,
        email: 'admin@example.com',
        password_hash: this.hashPassword('admin123'),
        name: 'Admin User',
        role: 'admin',
        mfa_enabled: false,
        created_at: new Date().toISOString(),
      },
      {
        id: 2,
        email: 'user@example.com',
        password_hash: this.hashPassword('user123'),
        name: 'Regular User',
        role: 'user',
        mfa_enabled: false,
        created_at: new Date().toISOString(),
      },
      {
        id: 3,
        email: 'guest@example.com',
        password_hash: this.hashPassword('guest123'),
        name: 'Guest User',
        role: 'guest',
        mfa_enabled: false,
        created_at: new Date().toISOString(),
      },
    ]

    defaultUsers.forEach((user) => {
      this.users.set(user.id, user)
    })
  }

  /**
   * Login: email + password
   */
  async login(email: string, password: string): Promise<{ token: string; refresh_token: string; user: User }> {
    const user = Array.from(this.users.values()).find((u) => u.email === email)

    if (!user || !this.verifyPassword(password, user.password_hash)) {
      throw new Error('Invalid email or password')
    }

    if (user.mfa_enabled && !user.mfa_secret) {
      throw new Error('MFA required')
    }

    const token = this.generateJWT(user)
    const refresh_token = this.generateRefreshToken(user.id)

    // Store session
    const session: Session = {
      id: this.generateSessionId(),
      user_id: user.id,
      token,
      refresh_token,
      expires_at: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      created_at: Date.now(),
    }

    this.sessions.set(session.id, session)
    this.sessionStore.set(token, { user_id: user.id, created_at: Date.now() })

    // Update last login
    user.last_login = new Date().toISOString()

    return {
      token,
      refresh_token,
      user: this.sanitizeUser(user),
    }
  }

  /**
   * Logout: invalidate token
   */
  async logout(token: string): Promise<{ success: boolean }> {
    this.sessionStore.delete(token)

    // Find and delete session
    for (const [key, session] of this.sessions.entries()) {
      if (session.token === token) {
        this.sessions.delete(key)
        break
      }
    }

    return { success: true }
  }

  /**
   * Verify JWT token
   */
  async verifyToken(token: string): Promise<{ valid: boolean; payload?: JWTPayload }> {
    if (!this.sessionStore.has(token)) {
      return { valid: false }
    }

    const session = this.sessionStore.get(token)
    if (Date.now() > session.created_at + 24 * 60 * 60 * 1000) {
      this.sessionStore.delete(token)
      return { valid: false }
    }

    const user = this.users.get(session.user_id)
    if (!user) return { valid: false }

    const payload: JWTPayload = {
      sub: user.id.toString(),
      email: user.email,
      role: user.role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000),
      iss: 'clone-ecosystem',
    }

    return { valid: true, payload }
  }

  /**
   * Refresh JWT token
   */
  async refreshToken(refresh_token: string): Promise<{ token: string; expires_at: number }> {
    const session = Array.from(this.sessions.values()).find((s) => s.refresh_token === refresh_token)

    if (!session || Date.now() > session.expires_at) {
      throw new Error('Invalid or expired refresh token')
    }

    const user = this.users.get(session.user_id)
    if (!user) throw new Error('User not found')

    const newToken = this.generateJWT(user)
    session.token = newToken
    session.expires_at = Date.now() + 24 * 60 * 60 * 1000

    this.sessionStore.set(newToken, { user_id: user.id, created_at: Date.now() })

    return {
      token: newToken,
      expires_at: session.expires_at,
    }
  }

  /**
   * Get current user
   */
  async getCurrentUser(token: string): Promise<User> {
    const session = this.sessionStore.get(token)
    if (!session) throw new Error('No active session')

    const user = this.users.get(session.user_id)
    if (!user) throw new Error('User not found')

    return this.sanitizeUser(user)
  }

  /**
   * Register new user
   */
  async register(email: string, password: string, name: string): Promise<User> {
    if (Array.from(this.users.values()).some((u) => u.email === email)) {
      throw new Error('Email already registered')
    }

    const id = Math.max(...Array.from(this.users.keys())) + 1

    const user: User = {
      id,
      email,
      password_hash: this.hashPassword(password),
      name,
      role: 'user',
      mfa_enabled: false,
      created_at: new Date().toISOString(),
    }

    this.users.set(id, user)
    return this.sanitizeUser(user)
  }

  /**
   * Check permission
   */
  async checkPermission(token: string, resource: string, action: string): Promise<boolean> {
    const session = this.sessionStore.get(token)
    if (!session) return false

    const user = this.users.get(session.user_id)
    if (!user) return false

    // Simple RBAC
    const permissions: Record<string, string[]> = {
      admin: ['read', 'write', 'delete', 'admin'],
      user: ['read', 'write'],
      guest: ['read'],
    }

    return permissions[user.role]?.includes(action) || false
  }

  /**
   * Validate OAuth 2.0 authorization code
   */
  async validateOAuthCode(code: string, client_id: string, client_secret: string): Promise<{ token: string; user: User }> {
    // Simulate OAuth code validation
    if (!code || code.length < 10) {
      throw new Error('Invalid authorization code')
    }

    // Decode code (mock)
    const user = Array.from(this.users.values())[0]
    const token = this.generateJWT(user)

    return { token, user: this.sanitizeUser(user) }
  }

  /**
   * Enable MFA for user
   */
  async enableMFA(token: string): Promise<{ secret: string; qr_code: string }> {
    const session = this.sessionStore.get(token)
    if (!session) throw new Error('No active session')

    const user = this.users.get(session.user_id)
    if (!user) throw new Error('User not found')

    const secret = this.generateMFASecret()
    user.mfa_secret = secret
    user.mfa_enabled = true

    return {
      secret,
      qr_code: `otpauth://totp/clone-app:${user.email}?secret=${secret}`,
    }
  }

  /**
   * Verify MFA code
   */
  async verifyMFACode(token: string, code: string): Promise<{ valid: boolean }> {
    const session = this.sessionStore.get(token)
    if (!session) throw new Error('No active session')

    const user = this.users.get(session.user_id)
    if (!user || !user.mfa_secret) throw new Error('MFA not enabled')

    // Simple TOTP simulation (in production, use speakeasy or similar)
    const isValid = code.length === 6 && /^\d+$/.test(code)

    return { valid: isValid }
  }

  /**
   * Generate JWT token
   */
  private generateJWT(user: User): string {
    const payload: JWTPayload = {
      sub: user.id.toString(),
      email: user.email,
      role: user.role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000),
      iss: 'clone-ecosystem',
    }

    // Simple JWT encoding (not cryptographically secure, for mock only)
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64')
    const body = Buffer.from(JSON.stringify(payload)).toString('base64')
    const signature = Buffer.from(this.jwtSecret).toString('base64')

    return `${header}.${body}.${signature}`
  }

  /**
   * Generate refresh token
   */
  private generateRefreshToken(userId: number): string {
    return `refresh_${userId}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Generate session ID
   */
  private generateSessionId(): string {
    return `session_${Math.random().toString(36).substr(2, 16)}`
  }

  /**
   * Hash password (simple mock)
   */
  private hashPassword(password: string): string {
    // In production, use bcrypt
    return Buffer.from(password).toString('base64')
  }

  /**
   * Verify password
   */
  private verifyPassword(password: string, hash: string): boolean {
    return this.hashPassword(password) === hash
  }

  /**
   * Generate MFA secret
   */
  private generateMFASecret(): string {
    return Math.random().toString(36).substr(2, 32).toUpperCase()
  }

  /**
   * Sanitize user (remove sensitive data)
   */
  private sanitizeUser(user: User): User {
    const { password_hash, mfa_secret, ...sanitized } = user
    return sanitized as User
  }

  /**
   * Get all sessions (admin only)
   */
  getSessions(): Session[] {
    return Array.from(this.sessions.values())
  }

  /**
   * Get all users (admin only)
   */
  getUsers(): User[] {
    return Array.from(this.users.values()).map((u) => this.sanitizeUser(u))
  }

  /**
   * Export auth state
   */
  export() {
    return {
      users: this.getUsers(),
      sessions_active: this.sessions.size,
      jwt_secret: this.jwtSecret,
    }
  }
}

export const authMock = new EcosystemAuthMock()
