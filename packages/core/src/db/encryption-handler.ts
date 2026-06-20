/**
 * ENCRYPTION HANDLER
 * ==================
 * Manages AES-256-GCM encryption for database fields
 *
 * Features:
 * - AES-256-GCM encryption
 * - Key rotation (monthly)
 * - Selective field encryption (sensitive fields only)
 * - Per-value IV (prevents pattern analysis)
 * - Efficient decryption
 */

import crypto from 'crypto'

export interface EncryptionConfig {
  masterKey: string | Buffer // 32 bytes for AES-256
  encryptedFieldsList: string[] // Fields to encrypt (e.g., ['private_key', 'mnemonic', 'email'])
  keyRotationIntervalDays: number // Rotate key every N days (default: 30)
  ivLengthBytes: number // IV length (default: 12, optimal for GCM)
}

export interface EncryptedValue {
  encryptedData: string // hex-encoded ciphertext
  iv: string // hex-encoded initialization vector
  authTag: string // hex-encoded authentication tag
  encryptedAtIso: string // timestamp when encrypted
  keyVersion: number // which key version was used
}

export interface EncryptionStats {
  fieldsEncrypted: number
  keyRotationsPerformed: number
  lastKeyRotation: Date
  currentKeyVersion: number
  totalEncryptedValues: number
}

/**
 * ENCRYPTION HANDLER CLASS
 */
export class EncryptionHandler {
  private config: EncryptionConfig
  private currentKeyVersion: number = 1
  private keyHistory: Map<number, Buffer> = new Map()
  private lastKeyRotation: Date
  private stats = {
    fieldsEncrypted: 0,
    keyRotationsPerformed: 0,
    totalEncryptedValues: 0,
  }

  constructor(config: EncryptionConfig) {
    this.config = {
      ...config,
      keyRotationIntervalDays: config.keyRotationIntervalDays || 30,
      ivLengthBytes: config.ivLengthBytes || 12,
    }

    // Ensure masterKey is a buffer of correct length
    const keyBuffer = typeof config.masterKey === 'string' ? Buffer.from(config.masterKey, 'hex') : config.masterKey

    if (keyBuffer.length !== 32) {
      throw new Error(`Master key must be 32 bytes (256 bits), got ${keyBuffer.length}`)
    }

    this.keyHistory.set(this.currentKeyVersion, keyBuffer)
    this.lastKeyRotation = new Date()

    console.log(`[ENCRYPTION_HANDLER] Initialized:`)
    console.log(`  Master key: ${keyBuffer.toString('hex').substring(0, 16)}...`)
    console.log(`  Sensitive fields: ${this.config.encryptedFieldsList.join(', ')}`)
    console.log(`  Key rotation interval: ${this.config.keyRotationIntervalDays} days`)
    console.log(`  Fields to encrypt: ${this.config.encryptedFieldsList.length}`)
  }

  /**
   * Check if a field should be encrypted
   */
  shouldEncryptField(fieldName: string): boolean {
    return this.config.encryptedFieldsList.includes(fieldName)
  }

  /**
   * Encrypt a value
   */
  encryptValue(value: string): EncryptedValue {
    const iv = crypto.randomBytes(this.config.ivLengthBytes)
    const currentKey = this.keyHistory.get(this.currentKeyVersion)

    if (!currentKey) {
      throw new Error(`Current key version ${this.currentKeyVersion} not found`)
    }

    const cipher = crypto.createCipheriv('aes-256-gcm', currentKey, iv)

    let encrypted = cipher.update(value, 'utf8', 'hex')
    encrypted += cipher.final('hex')

    const authTag = cipher.getAuthTag()

    this.stats.totalEncryptedValues++
    this.stats.fieldsEncrypted++

    return {
      encryptedData: encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      encryptedAtIso: new Date().toISOString(),
      keyVersion: this.currentKeyVersion,
    }
  }

  /**
   * Decrypt a value
   */
  decryptValue(encrypted: EncryptedValue): string {
    const keyVersion = encrypted.keyVersion
    const key = this.keyHistory.get(keyVersion)

    if (!key) {
      throw new Error(`Key version ${keyVersion} not found. Cannot decrypt value encrypted with missing key.`)
    }

    try {
      const iv = Buffer.from(encrypted.iv, 'hex')
      const authTag = Buffer.from(encrypted.authTag, 'hex')
      const encryptedBuffer = Buffer.from(encrypted.encryptedData, 'hex')

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(authTag)

      let decrypted = decipher.update(encryptedBuffer, undefined, 'utf8')
      decrypted += decipher.final('utf8')

      return decrypted
    } catch (error) {
      throw new Error(
        `Failed to decrypt value: ${error instanceof Error ? error.message : String(error)}. ` +
          `This may indicate tampering or key mismatch.`,
      )
    }
  }

  /**
   * Encrypt object (selective fields)
   */
  encryptObject(obj: Record<string, any>): Record<string, any> {
    const encrypted = { ...obj }

    for (const field of this.config.encryptedFieldsList) {
      if (field in encrypted && encrypted[field]) {
        encrypted[field] = this.encryptValue(String(encrypted[field]))
      }
    }

    return encrypted
  }

  /**
   * Decrypt object (selective fields)
   */
  decryptObject(obj: Record<string, any>): Record<string, any> {
    const decrypted = { ...obj }

    for (const field of this.config.encryptedFieldsList) {
      if (field in decrypted && decrypted[field] && typeof decrypted[field] === 'object' && 'encryptedData' in decrypted[field]) {
        decrypted[field] = this.decryptValue(decrypted[field] as EncryptedValue)
      }
    }

    return decrypted
  }

  /**
   * Rotate encryption key
   */
  rotateKey(newKey: string | Buffer): void {
    const keyBuffer = typeof newKey === 'string' ? Buffer.from(newKey, 'hex') : newKey

    if (keyBuffer.length !== 32) {
      throw new Error(`New key must be 32 bytes (256 bits), got ${keyBuffer.length}`)
    }

    this.currentKeyVersion++
    this.keyHistory.set(this.currentKeyVersion, keyBuffer)
    this.lastKeyRotation = new Date()
    this.stats.keyRotationsPerformed++

    console.log(`[ENCRYPTION_HANDLER] Key rotated:`)
    console.log(`  New version: ${this.currentKeyVersion}`)
    console.log(`  Rotations total: ${this.stats.keyRotationsPerformed}`)
    console.log(`  Last rotation: ${this.lastKeyRotation.toISOString()}`)
  }

  /**
   * Get current key version
   */
  getCurrentKeyVersion(): number {
    return this.currentKeyVersion
  }

  /**
   * Check if key rotation is due
   */
  isKeyRotationDue(): boolean {
    const daysSinceRotation = (Date.now() - this.lastKeyRotation.getTime()) / (1000 * 60 * 60 * 24)
    return daysSinceRotation >= this.config.keyRotationIntervalDays
  }

  /**
   * Get days until next key rotation
   */
  daysUntilKeyRotation(): number {
    const daysSinceRotation = (Date.now() - this.lastKeyRotation.getTime()) / (1000 * 60 * 60 * 24)
    return Math.max(0, Math.round(this.config.keyRotationIntervalDays - daysSinceRotation))
  }

  /**
   * Get encryption statistics
   */
  getStats(): EncryptionStats & { daysUntilRotation: number; rotationDueStr: string } {
    const daysUntilRotation = this.daysUntilKeyRotation()
    const rotationDueStr = daysUntilRotation === 0 ? 'NOW' : `${daysUntilRotation} days`

    return {
      fieldsEncrypted: this.stats.fieldsEncrypted,
      keyRotationsPerformed: this.stats.keyRotationsPerformed,
      lastKeyRotation: this.lastKeyRotation,
      currentKeyVersion: this.currentKeyVersion,
      totalEncryptedValues: this.stats.totalEncryptedValues,
      daysUntilRotation,
      rotationDueStr,
    }
  }

  /**
   * Print encryption statistics
   */
  printStats(): void {
    const stats = this.getStats()

    console.log(`\n${'='.repeat(70)}`)
    console.log(`ENCRYPTION STATISTICS`)
    console.log(`${'='.repeat(70)}`)
    console.log(`Current key version:          ${stats.currentKeyVersion}`)
    console.log(`Last key rotation:            ${stats.lastKeyRotation.toISOString()}`)
    console.log(`Total key rotations:          ${stats.keyRotationsPerformed}`)
    console.log(`Days until next rotation:     ${stats.rotationDueStr}`)
    console.log(`\nEncryption activity:`)
    console.log(`  Total encrypted values:     ${stats.totalEncryptedValues}`)
    console.log(`  Fields encrypted:           ${stats.fieldsEncrypted}`)
    console.log(`  Sensitive field count:      ${this.config.encryptedFieldsList.length}`)
    console.log(`\nEncryption config:`)
    console.log(`  Algorithm:                  AES-256-GCM`)
    console.log(`  IV length:                  ${this.config.ivLengthBytes} bytes`)
    console.log(`  Key rotation interval:      ${this.config.keyRotationIntervalDays} days`)
    console.log(`${'='.repeat(70)}\n`)
  }

  /**
   * Clean up old key versions (keep only last N versions for backward compatibility)
   */
  cleanupOldKeyVersions(keepVersions: number = 3): void {
    const versions = Array.from(this.keyHistory.keys()).sort((a, b) => b - a)

    if (versions.length > keepVersions) {
      const toDelete = versions.slice(keepVersions)
      for (const version of toDelete) {
        this.keyHistory.delete(version)
        console.log(`[ENCRYPTION_HANDLER] Deleted old key version: ${version}`)
      }
    }
  }
}

export default EncryptionHandler
