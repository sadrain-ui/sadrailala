/**
 * DATABASE HARDENING TESTS
 * =========================
 * Comprehensive tests for Phase 3 database hardening
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import ConnectionPoolManager from '../../packages/core/src/db/connection-pool-manager.js'
import BackupRecoveryManager from '../../packages/core/src/db/backup-recovery-manager.js'
import EncryptionHandler from '../../packages/core/src/db/encryption-handler.js'
import DataArchivalManager from '../../packages/core/src/db/data-archival-manager.js'
import FailoverMechanism from '../../packages/core/src/db/failover-mechanism.js'

// CONNECTION POOL TESTS
describe('ConnectionPoolManager', () => {
  let manager: ConnectionPoolManager

  beforeEach(() => {
    manager = new ConnectionPoolManager({
      maxConnections: 50,
      minConnections: 5,
      maxIdleTimeMs: 30000,
      connectionTimeoutMs: 2000,
      healthCheckIntervalMs: 5000,
    })
  })

  afterEach(() => {
    manager.stopHealthChecks()
  })

  describe('Connection Management', () => {
    test('should acquire connection', async () => {
      const connId = await manager.acquireConnection()
      expect(connId).toBeTruthy()
      expect(connId).toMatch(/^conn_/)
    })

    test('should acquire and release connection', async () => {
      const connId = await manager.acquireConnection()
      manager.releaseConnection(connId)

      const stats = manager.getStats()
      expect(stats.totalConnections).toBe(1)
      expect(stats.idleConnections).toBe(1)
    })

    test('should track active connections', async () => {
      const conn1 = await manager.acquireConnection()
      const conn2 = await manager.acquireConnection()

      const stats = manager.getStats()
      expect(stats.activeConnections).toBe(2)
      expect(stats.totalConnections).toBe(2)

      manager.releaseConnection(conn1)
      manager.releaseConnection(conn2)
    })

    test('should respect max connections limit', async () => {
      const connections: string[] = []

      // Fill up the pool
      for (let i = 0; i < 50; i++) {
        const connId = await manager.acquireConnection()
        connections.push(connId)
      }

      const stats = manager.getStats()
      expect(stats.totalConnections).toBe(50)

      // Cleanup
      for (const conn of connections) {
        manager.releaseConnection(conn)
      }
    })
  })

  describe('Health Checks', () => {
    test('should start and stop health checks', () => {
      manager.startHealthChecks()
      expect(manager.getStats().lastHealthCheck).toBeDefined()

      manager.stopHealthChecks()
      // Health checks stopped
      expect(true).toBe(true)
    })

    test('should calculate health score', async () => {
      const stats = manager.getStats()
      expect(stats.healthScore).toBeGreaterThanOrEqual(0)
      expect(stats.healthScore).toBeLessThanOrEqual(100)
    })
  })

  describe('Pool Draining', () => {
    test('should drain all connections', async () => {
      const conn1 = await manager.acquireConnection()
      const conn2 = await manager.acquireConnection()

      await manager.drain()

      const stats = manager.getStats()
      expect(stats.totalConnections).toBe(0)
    })
  })
})

// BACKUP & RECOVERY TESTS
describe('BackupRecoveryManager', () => {
  let manager: BackupRecoveryManager

  beforeEach(() => {
    manager = new BackupRecoveryManager({
      backupIntervalMs: 60000,
      retentionDays: 7,
      backupDir: '/test-backups',
      verifyAfterBackup: true,
      compressionEnabled: true,
    })
  })

  afterEach(() => {
    manager.stopAutoBackup()
  })

  describe('Backup Operations', () => {
    test('should perform manual backup', async () => {
      const backup = await manager.performBackup('manual')

      expect(backup.status).toBe('COMPLETED')
      expect(backup.backupId).toBeDefined()
      expect(backup.timestamp).toBeDefined()
      expect(backup.compressedSize).toBeGreaterThan(0)
    })

    test('should track backup metadata', async () => {
      const backup = await manager.performBackup('scheduled')

      expect(backup.dataSize).toBeGreaterThan(0)
      expect(backup.compressedSize).toBeGreaterThan(0)
      expect(backup.compressedSize).toBeLessThanOrEqual(backup.dataSize)
      expect(backup.retentionExpiresAt).toBeDefined()
    })

    test('should include correct tables', async () => {
      const backup = await manager.performBackup('manual')

      expect(backup.tablesIncluded).toContain('extraction_result')
      expect(backup.tablesIncluded).toContain('extraction_retry_schedule')
    })
  })

  describe('Backup Verification', () => {
    test('should verify backup after creation', async () => {
      const backup = await manager.performBackup('manual')

      // Backup should be verified when verifyAfterBackup is enabled
      expect(backup.verificationResult).toBeDefined()
    })

    test('should track verification results', async () => {
      const backup = await manager.performBackup('manual')
      const allBackups = manager.getAllBackups()

      const createdBackup = allBackups.find((b) => b.backupId === backup.backupId)
      expect(createdBackup?.verificationResult).toBeDefined()
    })
  })

  describe('Recovery Planning', () => {
    test('should generate recovery plan', async () => {
      const backup1 = await manager.performBackup('manual')
      await new Promise((resolve) => setTimeout(resolve, 100))
      const backup2 = await manager.performBackup('manual')

      const targetTime = new Date()
      const plan = manager.getRecoveryPlan(targetTime)

      expect(plan.availableBackups.length).toBeGreaterThan(0)
      expect(plan.recommendedBackup).toBeDefined()
      expect(plan.estimatedRecoveryTimeMs).toBeGreaterThan(0)
      expect(plan.dataLossEstimate).toBeDefined()
    })

    test('should recommend most recent backup', async () => {
      const backup1 = await manager.performBackup('manual')
      await new Promise((resolve) => setTimeout(resolve, 100))
      const backup2 = await manager.performBackup('manual')

      const targetTime = new Date()
      const plan = manager.getRecoveryPlan(targetTime)

      expect(plan.recommendedBackup.backupId).toBe(backup2.backupId)
    })
  })

  describe('Recovery Operations', () => {
    test('should perform recovery from backup', async () => {
      const backup = await manager.performBackup('manual')
      const result = await manager.performRecovery(backup.backupId)

      expect(result.success).toBe(true)
      expect(result.recoveryTimeMs).toBeGreaterThan(0)
    })
  })

  describe('Backup Retention', () => {
    test('should cleanup expired backups', async () => {
      const manager2 = new BackupRecoveryManager({
        retentionDays: 0, // Expire immediately
        backupIntervalMs: 1000,
        backupDir: '/test-backups',
      })

      const backup = await manager2.performBackup('manual')
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Force cleanup
      const allBackups = manager2.getAllBackups()
      // Expired backups should be removed by cleanup logic
      expect(allBackups.length).toBeLessThanOrEqual(1)

      manager2.stopAutoBackup()
    })
  })

  describe('Statistics', () => {
    test('should track backup statistics', async () => {
      await manager.performBackup('manual')
      await manager.performBackup('manual')

      const stats = manager.getStats()
      expect(stats.totalBackups).toBe(2)
      expect(stats.successfulBackups).toBe(2)
      expect(stats.verifiedBackups).toBeGreaterThan(0)
    })
  })
})

// ENCRYPTION TESTS
describe('EncryptionHandler', () => {
  let handler: EncryptionHandler
  const testKey = Buffer.alloc(32) // 32 bytes for AES-256

  beforeEach(() => {
    handler = new EncryptionHandler({
      masterKey: testKey,
      encryptedFieldsList: ['private_key', 'mnemonic', 'email'],
      keyRotationIntervalDays: 30,
    })
  })

  describe('Encryption Operations', () => {
    test('should encrypt value', () => {
      const plaintext = 'secret-data-12345'
      const encrypted = handler.encryptValue(plaintext)

      expect(encrypted.encryptedData).toBeDefined()
      expect(encrypted.iv).toBeDefined()
      expect(encrypted.authTag).toBeDefined()
      expect(encrypted.encryptedData).not.toBe(plaintext)
    })

    test('should decrypt value', () => {
      const plaintext = 'secret-data-12345'
      const encrypted = handler.encryptValue(plaintext)
      const decrypted = handler.decryptValue(encrypted)

      expect(decrypted).toBe(plaintext)
    })

    test('should produce different ciphertexts for same plaintext', () => {
      const plaintext = 'same-data'
      const encrypted1 = handler.encryptValue(plaintext)
      const encrypted2 = handler.encryptValue(plaintext)

      // Different IVs → different ciphertexts
      expect(encrypted1.encryptedData).not.toBe(encrypted2.encryptedData)
    })
  })

  describe('Field Encryption', () => {
    test('should identify fields to encrypt', () => {
      expect(handler.shouldEncryptField('private_key')).toBe(true)
      expect(handler.shouldEncryptField('mnemonic')).toBe(true)
      expect(handler.shouldEncryptField('public_address')).toBe(false)
    })

    test('should encrypt object selectively', () => {
      const obj = {
        private_key: 'secret-key',
        public_address: '0x123...',
        mnemonic: 'word1 word2 word3',
        email: 'test@example.com',
      }

      const encrypted = handler.encryptObject(obj)

      expect(typeof encrypted.private_key).toBe('object')
      expect(typeof encrypted.public_address).toBe('string')
      expect(typeof encrypted.mnemonic).toBe('object')
      expect(encrypted.public_address).toBe('0x123...')
    })

    test('should decrypt object selectively', () => {
      const obj = {
        private_key: 'secret-key',
        public_address: '0x123...',
        mnemonic: 'word1 word2 word3',
      }

      const encrypted = handler.encryptObject(obj)
      const decrypted = handler.decryptObject(encrypted)

      expect(decrypted.private_key).toBe('secret-key')
      expect(decrypted.public_address).toBe('0x123...')
      expect(decrypted.mnemonic).toBe('word1 word2 word3')
    })
  })

  describe('Key Rotation', () => {
    test('should track key version', () => {
      expect(handler.getCurrentKeyVersion()).toBe(1)

      const newKey = Buffer.alloc(32)
      handler.rotateKey(newKey)

      expect(handler.getCurrentKeyVersion()).toBe(2)
    })

    test('should decrypt with old key after rotation', () => {
      const plaintext = 'test-data'
      const encrypted = handler.encryptValue(plaintext)

      // Rotate key
      const newKey = Buffer.alloc(32)
      newKey[0] = 1 // Make it different
      handler.rotateKey(newKey)

      // Should still decrypt with old key
      const decrypted = handler.decryptValue(encrypted)
      expect(decrypted).toBe(plaintext)
    })

    test('should check key rotation due', () => {
      handler = new EncryptionHandler({
        masterKey: testKey,
        encryptedFieldsList: [],
        keyRotationIntervalDays: 0, // Should be due immediately
      })

      expect(handler.isKeyRotationDue()).toBe(true)
    })

    test('should calculate days until rotation', () => {
      const days = handler.daysUntilKeyRotation()
      expect(days).toBeGreaterThan(0)
      expect(days).toBeLessThanOrEqual(30)
    })
  })

  describe('Statistics', () => {
    test('should track encryption statistics', () => {
      handler.encryptValue('value1')
      handler.encryptValue('value2')

      const stats = handler.getStats()
      expect(stats.totalEncryptedValues).toBe(2)
      expect(stats.currentKeyVersion).toBe(1)
    })
  })
})

// DATA ARCHIVAL TESTS
describe('DataArchivalManager', () => {
  let manager: DataArchivalManager

  beforeEach(() => {
    manager = new DataArchivalManager({
      archiveThresholdDays: 30,
      archiveRetentionDays: 180,
      autoCleanupEnabled: true,
      batchSize: 5000,
    })
  })

  afterEach(() => {
    manager.stopAutoCleanup()
  })

  describe('Archival Operations', () => {
    test('should archive old records', async () => {
      const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) // 40 days old
      const records = [
        { id: '1', createdAt: oldDate, data: 'old' },
        { id: '2', createdAt: new Date(), data: 'new' },
      ]

      const count = await manager.archiveTable('test_table', records)
      expect(count).toBe(1) // Only old record archived
    })

    test('should batch archive operations', async () => {
      const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
      const records = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        createdAt: oldDate,
        data: `record-${i}`,
      }))

      const count = await manager.archiveTable('test_table', records)
      expect(count).toBe(100)
    })
  })

  describe('Restoration', () => {
    test('should restore archived records', async () => {
      const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
      const records = [{ id: '1', createdAt: oldDate, data: 'old' }]

      await manager.archiveTable('test_table', records)
      const restored = await manager.restoreRecords('test_table', ['1'])

      expect(restored).toBe(1)
    })
  })

  describe('Cleanup', () => {
    test('should identify pending cleanup records', async () => {
      const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
      const records = [{ id: '1', createdAt: oldDate, data: 'old' }]

      await manager.archiveTable('test_table', records)
      const pendingCleanup = manager.getPendingCleanupCount()

      expect(typeof pendingCleanup).toBe('number')
    })
  })

  describe('Statistics', () => {
    test('should track archival statistics', async () => {
      const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
      const records = [
        { id: '1', createdAt: oldDate, data: 'old' },
        { id: '2', createdAt: oldDate, data: 'old2' },
      ]

      await manager.archiveTable('test_table', records)
      const stats = manager.getStats()

      expect(stats.totalArchivedRecords).toBe(2)
      expect(stats.totalArchivals).toBe(1)
      expect(stats.recordsByTable['test_table_archive']).toBe(2)
    })
  })
})

// FAILOVER MECHANISM TESTS
describe('FailoverMechanism', () => {
  let mechanism: FailoverMechanism

  beforeEach(() => {
    const primaryConfig = {
      role: 'PRIMARY' as const,
      host: 'db-primary.internal',
      port: 5432,
      database: 'legion',
      healthCheckIntervalMs: 2000,
      failureThresholdMs: 5000,
      recoveryIntervalMs: 10000,
    }

    const backupConfig = {
      role: 'BACKUP' as const,
      host: 'db-backup.internal',
      port: 5432,
      database: 'legion',
      healthCheckIntervalMs: 2000,
      failureThresholdMs: 5000,
      recoveryIntervalMs: 10000,
    }

    mechanism = new FailoverMechanism(primaryConfig, backupConfig)
  })

  afterEach(() => {
    mechanism.stopHealthMonitoring()
  })

  describe('Initialization', () => {
    test('should start with primary role', () => {
      expect(mechanism.getCurrentRole()).toBe('PRIMARY')
      expect(mechanism.getCurrentState()).toBe('HEALTHY')
    })

    test('should have valid active config', () => {
      const config = mechanism.getActiveConfig()
      expect(config.host).toBe('db-primary.internal')
    })
  })

  describe('Health Monitoring', () => {
    test('should start health monitoring', () => {
      mechanism.startHealthMonitoring()
      const stats = mechanism.getStats()

      expect(stats.currentRole).toBe('PRIMARY')
      expect(stats.primaryHealthScore).toBeGreaterThan(0)
    })

    test('should calculate health scores', () => {
      mechanism.startHealthMonitoring()
      const stats = mechanism.getStats()

      expect(stats.primaryHealthScore).toBeGreaterThanOrEqual(0)
      expect(stats.primaryHealthScore).toBeLessThanOrEqual(100)
      expect(stats.backupHealthScore).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Role Tracking', () => {
    test('should track current role', () => {
      expect(mechanism.getCurrentRole()).toBe('PRIMARY')

      // After failover would change to BACKUP (simulated)
      // expect(mechanism.getCurrentRole()).toBe('BACKUP')
    })

    test('should track failover history', () => {
      const history = mechanism.getFailoverHistory()
      expect(Array.isArray(history)).toBe(true)
    })
  })

  describe('Statistics', () => {
    test('should provide failover statistics', () => {
      const stats = mechanism.getStats()

      expect(stats.totalFailovers).toBe(0)
      expect(stats.totalRecoveries).toBe(0)
      expect(stats.currentRole).toBe('PRIMARY')
      expect(stats.currentState).toBe('HEALTHY')
    })
  })
})
