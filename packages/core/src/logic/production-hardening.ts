/**
 * Production Hardening — Security, rate limiting, input validation
 * Implements defensive layers for production deployment
 */

import type { Address } from 'viem'

export interface RateLimitConfig {
  maxRequestsPerWindow: number
  windowSizeMs: number
  maxConcurrentPerWallet: number
  cooldownMs: number
}

export interface ValidationRules {
  maxWalletSize: number
  maxPositionAmount: bigint
  minPositionAmount: bigint
  allowedChains: string[]
  allowedProtocols: string[]
}

/**
 * Rate limiter with sliding window
 */
export class RateLimiter {
  private requests: Map<string, number[]> = new Map()
  private config: RateLimitConfig

  constructor(config: RateLimitConfig) {
    this.config = config
  }

  /**
   * Check if request is allowed
   */
  isAllowed(walletAddress: Address): boolean {
    const now = Date.now()
    const key = walletAddress.toLowerCase()

    const timestamps = this.requests.get(key) || []

    // Remove old requests outside the window
    const recentTimestamps = timestamps.filter((ts) => now - ts < this.config.windowSizeMs)

    // Check if exceeds limit
    if (recentTimestamps.length >= this.config.maxRequestsPerWindow) {
      return false
    }

    // Update timestamps
    recentTimestamps.push(now)
    this.requests.set(key, recentTimestamps)

    return true
  }

  /**
   * Get current rate for wallet
   */
  getRate(walletAddress: Address): { requests: number; limit: number; resetMs: number } {
    const now = Date.now()
    const key = walletAddress.toLowerCase()

    const timestamps = (this.requests.get(key) || []).filter((ts) => now - ts < this.config.windowSizeMs)

    const oldestRequest = timestamps.length > 0 ? timestamps[0] : now
    const resetMs = this.config.windowSizeMs - (now - oldestRequest)

    return {
      requests: timestamps.length,
      limit: this.config.maxRequestsPerWindow,
      resetMs: Math.max(0, resetMs),
    }
  }

  /**
   * Reset limiter (for testing)
   */
  reset(): void {
    this.requests.clear()
  }
}

/**
 * Concurrent operation tracker
 */
export class ConcurrencyTracker {
  private activeOperations: Map<string, number> = new Map()
  private maxConcurrent: number

  constructor(maxConcurrent: number = 10) {
    this.maxConcurrent = maxConcurrent
  }

  /**
   * Acquire slot for operation
   */
  acquire(walletAddress: Address): boolean {
    const key = walletAddress.toLowerCase()
    const current = this.activeOperations.get(key) || 0

    if (current >= this.maxConcurrent) {
      return false
    }

    this.activeOperations.set(key, current + 1)
    return true
  }

  /**
   * Release slot
   */
  release(walletAddress: Address): void {
    const key = walletAddress.toLowerCase()
    const current = this.activeOperations.get(key) || 0

    if (current > 0) {
      this.activeOperations.set(key, current - 1)
    }
  }

  /**
   * Get current concurrency
   */
  getCurrent(walletAddress: Address): number {
    return this.activeOperations.get(walletAddress.toLowerCase()) || 0
  }

  /**
   * Get total active operations
   */
  getTotalActive(): number {
    return Array.from(this.activeOperations.values()).reduce((sum, count) => sum + count, 0)
  }
}

/**
 * Input validator
 */
export class InputValidator {
  private rules: ValidationRules

  constructor(rules: ValidationRules) {
    this.rules = rules
  }

  /**
   * Validate wallet address
   */
  validateWallet(address: string): { valid: boolean; error?: string } {
    if (!address) {
      return { valid: false, error: 'Wallet address required' }
    }

    const trimmed = address.trim()

    // EVM address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
      return { valid: false, error: 'Invalid wallet address format' }
    }

    return { valid: true }
  }

  /**
   * Validate chain
   */
  validateChain(chain: string): { valid: boolean; error?: string } {
    if (!this.rules.allowedChains.includes(chain)) {
      return { valid: false, error: `Chain ${chain} not allowed. Allowed: ${this.rules.allowedChains.join(', ')}` }
    }

    return { valid: true }
  }

  /**
   * Validate protocol
   */
  validateProtocol(protocol: string): { valid: boolean; error?: string } {
    if (!this.rules.allowedProtocols.includes(protocol)) {
      return {
        valid: false,
        error: `Protocol ${protocol} not allowed. Allowed: ${this.rules.allowedProtocols.join(', ')}`,
      }
    }

    return { valid: true }
  }

  /**
   * Validate position amount
   */
  validateAmount(amount: bigint): { valid: boolean; error?: string } {
    if (amount < this.rules.minPositionAmount) {
      return {
        valid: false,
        error: `Amount too small. Minimum: ${this.rules.minPositionAmount.toString()}`,
      }
    }

    if (amount > this.rules.maxPositionAmount) {
      return {
        valid: false,
        error: `Amount too large. Maximum: ${this.rules.maxPositionAmount.toString()}`,
      }
    }

    return { valid: true }
  }

  /**
   * Validate vault address
   */
  validateVault(address: string): { valid: boolean; error?: string } {
    if (!address) {
      return { valid: false, error: 'Vault address required' }
    }

    const validation = this.validateWallet(address)
    if (!validation.valid) {
      return { valid: false, error: `Invalid vault address: ${validation.error}` }
    }

    return { valid: true }
  }

  /**
   * Validate complete extraction request
   */
  validateExtractionRequest(request: {
    wallet_address: string
    vault_address: string
    chain: string
    protocol?: string
    amount?: bigint
  }): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    const walletValidation = this.validateWallet(request.wallet_address)
    if (!walletValidation.valid) {
      errors.push(`Wallet: ${walletValidation.error}`)
    }

    const vaultValidation = this.validateVault(request.vault_address)
    if (!vaultValidation.valid) {
      errors.push(`Vault: ${vaultValidation.error}`)
    }

    const chainValidation = this.validateChain(request.chain)
    if (!chainValidation.valid) {
      errors.push(`Chain: ${chainValidation.error}`)
    }

    if (request.protocol) {
      const protocolValidation = this.validateProtocol(request.protocol)
      if (!protocolValidation.valid) {
        errors.push(`Protocol: ${protocolValidation.error}`)
      }
    }

    if (request.amount) {
      const amountValidation = this.validateAmount(request.amount)
      if (!amountValidation.valid) {
        errors.push(`Amount: ${amountValidation.error}`)
      }
    }

    return { valid: errors.length === 0, errors }
  }
}

/**
 * Access control list
 */
export class AccessControl {
  private allowlist: Set<string> = new Set()
  private blocklist: Set<string> = new Set()
  private adminAddresses: Set<string> = new Set()

  constructor(admins: Address[] = []) {
    this.adminAddresses = new Set(admins.map((a) => a.toLowerCase()))
  }

  /**
   * Add address to allowlist
   */
  allowlist(address: Address): void {
    this.allowlist.add(address.toLowerCase())
  }

  /**
   * Add address to blocklist
   */
  blocklist(address: Address): void {
    this.blocklist.add(address.toLowerCase())
  }

  /**
   * Check if address is allowed
   */
  isAllowed(address: Address): boolean {
    const normalized = address.toLowerCase()

    // Check blocklist first
    if (this.blocklist.has(normalized)) {
      return false
    }

    // If allowlist is not empty, check allowlist
    if (this.allowlist.size > 0) {
      return this.allowlist.has(normalized)
    }

    // If allowlist is empty, allow by default
    return true
  }

  /**
   * Check if address is admin
   */
  isAdmin(address: Address): boolean {
    return this.adminAddresses.has(address.toLowerCase())
  }

  /**
   * Add admin
   */
  addAdmin(address: Address): void {
    this.adminAddresses.add(address.toLowerCase())
  }

  /**
   * Remove admin
   */
  removeAdmin(address: Address): void {
    this.adminAddresses.delete(address.toLowerCase())
  }

  /**
   * Get ACL stats
   */
  getStats(): {
    allowlistSize: number
    blocklistSize: number
    adminCount: number
    enforcement: 'open' | 'allowlist' | 'blocklist'
  } {
    const enforcement =
      this.allowlist.size > 0 ? 'allowlist' : this.blocklist.size > 0 ? 'blocklist' : 'open'

    return {
      allowlistSize: this.allowlist.size,
      blocklistSize: this.blocklist.size,
      adminCount: this.adminAddresses.size,
      enforcement,
    }
  }
}

/**
 * Security audit logger
 */
export class SecurityAuditLog {
  private logs: Array<{
    timestamp: Date
    severity: 'info' | 'warn' | 'error'
    action: string
    wallet: Address
    detail: string
    metadata?: Record<string, unknown>
  }> = []

  private maxLogs: number

  constructor(maxLogs: number = 10000) {
    this.maxLogs = maxLogs
  }

  /**
   * Log security event
   */
  log(
    severity: 'info' | 'warn' | 'error',
    action: string,
    wallet: Address,
    detail: string,
    metadata?: Record<string, unknown>,
  ): void {
    const entry = {
      timestamp: new Date(),
      severity,
      action,
      wallet,
      detail,
      metadata,
    }

    this.logs.push(entry)

    // Keep only recent logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs)
    }

    // Also log to console
    const logLevel = severity === 'error' ? 'error' : severity === 'warn' ? 'warn' : 'info'
    console[logLevel as 'error' | 'warn' | 'info'](
      `[SECURITY_AUDIT] ${action} ${wallet}: ${detail}`,
    )
  }

  /**
   * Get recent logs
   */
  getRecent(limit: number = 100): Array<{
    timestamp: Date
    severity: 'info' | 'warn' | 'error'
    action: string
    wallet: Address
    detail: string
    metadata?: Record<string, unknown>
  }> {
    return this.logs.slice(-limit)
  }

  /**
   * Get logs by severity
   */
  getBySeverity(severity: 'info' | 'warn' | 'error'): typeof this.logs {
    return this.logs.filter((log) => log.severity === severity)
  }

  /**
   * Clear logs
   */
  clear(): number {
    const count = this.logs.length
    this.logs = []
    return count
  }
}

/**
 * Production hardening service
 */
export class ProductionHardeningService {
  rateLimiter: RateLimiter
  concurrencyTracker: ConcurrencyTracker
  inputValidator: InputValidator
  accessControl: AccessControl
  auditLog: SecurityAuditLog

  constructor(config: {
    rateLimitConfig: RateLimitConfig
    validationRules: ValidationRules
    adminAddresses: Address[]
  }) {
    this.rateLimiter = new RateLimiter(config.rateLimitConfig)
    this.concurrencyTracker = new ConcurrencyTracker(config.rateLimitConfig.maxConcurrentPerWallet)
    this.inputValidator = new InputValidator(config.validationRules)
    this.accessControl = new AccessControl(config.adminAddresses)
    this.auditLog = new SecurityAuditLog()
  }

  /**
   * Check if extraction can proceed
   */
  canProceedWithExtraction(
    wallet: Address,
    vault: Address,
  ): { allowed: boolean; reason?: string } {
    // Check access control
    if (!this.accessControl.isAllowed(wallet)) {
      this.auditLog.log('warn', 'ACCESS_DENIED', wallet, 'Wallet not in allowlist')
      return { allowed: false, reason: 'Access denied' }
    }

    // Check rate limit
    if (!this.rateLimiter.isAllowed(wallet)) {
      this.auditLog.log('warn', 'RATE_LIMIT_EXCEEDED', wallet, 'Exceeded request rate limit')
      return { allowed: false, reason: 'Rate limit exceeded' }
    }

    // Check concurrency
    if (!this.concurrencyTracker.acquire(wallet)) {
      this.auditLog.log('warn', 'CONCURRENCY_LIMIT', wallet, 'Max concurrent operations exceeded')
      return { allowed: false, reason: 'Too many concurrent operations' }
    }

    this.auditLog.log('info', 'EXTRACTION_APPROVED', wallet, `Vault: ${vault}`)
    return { allowed: true }
  }

  /**
   * Release concurrency slot
   */
  releaseExtraction(wallet: Address): void {
    this.concurrencyTracker.release(wallet)
  }

  /**
   * Get service status
   */
  getStatus(): {
    rateLimitStats: ReturnType<RateLimiter['getRate']>
    totalActive: number
    aclStats: ReturnType<AccessControl['getStats']>
    recentErrors: number
  } {
    return {
      rateLimitStats: {
        requests: 0,
        limit: 0,
        resetMs: 0,
      },
      totalActive: this.concurrencyTracker.getTotalActive(),
      aclStats: this.accessControl.getStats(),
      recentErrors: this.auditLog.getBySeverity('error').length,
    }
  }
}
