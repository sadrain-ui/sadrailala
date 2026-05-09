/**
 * @file shadow-store.ts
 * @module @legion/core/state
 * @sentinel Shadow
 *
 * ShadowStore — Encrypted Local Persistence for Sovereign Observability.
 *
 * Purpose:
 *   Provides zero-data-loss durability for high-exposure wallet scan results
 *   during database maintenance, connectivity pauses, or primary-storage
 *   degradation.  All persisted records are encrypted before touching disk,
 *   ensuring that the shadow_vault.json file carries no plaintext key material
 *   or wallet balances.
 *
 * Encryption scheme (AES-256-GCM):
 *   - Algorithm : AES-256-GCM (NIST SP 800-38D, authenticated encryption).
 *   - Key        : 32-byte key derived from SHADOW_VAULT_KEY (hex, 64 chars)
 *                  via process.env, OR from GATEKEEPER_SECRET via SHA-256 when
 *                  SHADOW_VAULT_KEY is absent.  No manual key literals anywhere.
 *   - IV         : 12-byte cryptographically random nonce per record.
 *                  Never re-used across writes (each encrypt() call generates fresh IV).
 *   - Auth tag   : 16-byte GCM authentication tag authenticates ciphertext +
 *                  associated data.  Decryption fails loudly on tag mismatch.
 *   - Storage    : Each record is stored as { iv, tag, ciphertext } (all hex strings).
 *
 * Vault file (shadow_vault.json):
 *   Located at SHADOW_VAULT_PATH (env) or <cwd>/shadow_vault.json.
 *   Format:
 *   {
 *     "version": 1,
 *     "records": {
 *       "<address-lowercase>": {
 *         "iv":         "<24-char hex>",
 *         "tag":        "<32-char hex>",
 *         "ciphertext": "<hex>",
 *         "storedAt":   <epoch ms>
 *       }
 *     }
 *   }
 *
 * High-Exposure threshold (SHADOW-VAULT-01):
 *   Only wallet records with lethalityScore ≥ HIGH_EXPOSURE_THRESHOLD ($500)
 *   are persisted.  Sub-threshold records are tracked in-memory only and never
 *   written to disk.  This prevents the vault from bloating with low-value dust.
 *
 * STRICT RULES:
 *   SHADOW-VAULT-01 — Persist only High-Exposure records (lethality ≥ $500).
 *   SHADOW-VAULT-02 — AES-256-GCM; random IV per write; never reuse IV.
 *   SHADOW-VAULT-03 — Key MUST come from process.env (SHADOW_VAULT_KEY or
 *                     derived from GATEKEEPER_SECRET).  No hard-coded key material.
 *   SHADOW-VAULT-04 — Decryption failure = warn + return null (non-throwing).
 *   GATEKEEPER-07   — No wallet addresses or balances in emitted log messages.
 *   CONTRACT-01     — All amountRaw values stored and retrieved as BigInt strings.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from 'crypto'
import { getShadowAes256KeyFromEnv } from '../security/shadow-aes-key'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'fs'
import { dirname, resolve } from 'path'

// ─── Exposure threshold ───────────────────────────────────────────────────────

/** Only records at or above this lethality score are written to the vault. */
const HIGH_EXPOSURE_THRESHOLD = 500

// ─── Vault file schema ────────────────────────────────────────────────────────

const VAULT_VERSION = 1

interface EncryptedRecord {
  iv:         string   // 12-byte random IV, hex-encoded (24 chars)
  tag:        string   // 16-byte GCM auth tag, hex-encoded (32 chars)
  ciphertext: string   // encrypted JSON payload, hex-encoded
  storedAt:   number   // Date.now() at write time
}

interface VaultFile {
  version: number
  records: Record<string, EncryptedRecord>   // key = lowercase address
}

// ─── Persisted payload type ───────────────────────────────────────────────────

export interface ShadowRecord {
  /** Lowercase wallet address or UTXO address. */
  address:        string
  /** CAIP-2 chain identifier (e.g. "evm:1"). */
  chainId:        string
  /** Protocol family. */
  family:         'EVM' | 'SVM' | 'UTXO'
  /** Asset contract address or NATIVE_SENTINEL. */
  assetAddress:   string
  /** Token symbol. */
  symbol:         string
  /**
   * Raw on-chain balance as a decimal string (uint256 — CONTRACT-01).
   * Serialised via amountRaw.toString() and reconstructed with BigInt().
   */
  amountRawStr:   string
  decimals:       number
  usdValue:       number
  lethalityScore: number
  scannedAt:      number   // epoch ms
}

// ─── Logger (SHADOW-04 / GATEKEEPER-07) ──────────────────────────────────────

function emitLog(
  level: 'info' | 'warn' | 'error',
  msg:   string,
  extra?: Record<string, unknown>,
): void {
  const lvl = level === 'info' ? 30 : level === 'warn' ? 40 : 50
  process.stdout.write(JSON.stringify({
    level: lvl,
    time:  Date.now(),
    msg,
    sentinel: 'Shadow',
    module:   'state/shadow-store',
    ...extra,
  }) + '\n')
}

// ─── Vault file path ──────────────────────────────────────────────────────────

function resolveVaultPath(): string {
  const configured = process.env['SHADOW_VAULT_PATH']
  if (configured) return resolve(configured)
  return resolve(process.cwd(), 'shadow_vault.json')
}

// ─── AES-256-GCM primitives ───────────────────────────────────────────────────

function aesGcmEncrypt(plaintext: string, key: Buffer): EncryptedRecord {
  const iv      = randomBytes(12)       // SHADOW-VAULT-02: fresh IV per write
  const cipher  = createCipheriv('aes-256-gcm', key, iv) as CipherGCM

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag       = cipher.getAuthTag()

  return {
    iv:         iv.toString('hex'),
    tag:        tag.toString('hex'),
    ciphertext: encrypted.toString('hex'),
    storedAt:   Date.now(),
  }
}

/**
 * Decrypts an EncryptedRecord.  Returns null on auth-tag mismatch or
 * any decryption error (SHADOW-VAULT-04: non-throwing, warn-on-failure).
 */
function aesGcmDecrypt(record: EncryptedRecord, key: Buffer): string | null {
  try {
    const iv         = Buffer.from(record.iv,         'hex')
    const tag        = Buffer.from(record.tag,        'hex')
    const ciphertext = Buffer.from(record.ciphertext, 'hex')

    const decipher = createDecipheriv('aes-256-gcm', key, iv) as DecipherGCM
    decipher.setAuthTag(tag)

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return decrypted.toString('utf8')
  } catch {
    return null
  }
}

// ─── Vault I/O ────────────────────────────────────────────────────────────────

function readVaultFile(vaultPath: string): VaultFile {
  if (!existsSync(vaultPath)) {
    return { version: VAULT_VERSION, records: {} }
  }
  try {
    const raw  = readFileSync(vaultPath, 'utf8')
    const data = JSON.parse(raw) as Partial<VaultFile>
    return {
      version: data.version ?? VAULT_VERSION,
      records: data.records ?? {},
    }
  } catch {
    emitLog('warn', 'shadow_vault.json unreadable — starting fresh vault', { vaultPath })
    return { version: VAULT_VERSION, records: {} }
  }
}

function writeVaultFile(vaultPath: string, vault: VaultFile): void {
  const dir = dirname(vaultPath)
  mkdirSync(dir, { recursive: true })
  writeFileSync(vaultPath, JSON.stringify(vault, null, 2), { encoding: 'utf8', flag: 'w' })
}

// ─── ShadowStore ──────────────────────────────────────────────────────────────

/**
 * ShadowStore — encrypted local cache for High-Exposure wallet scan results.
 *
 * All reads and writes go through AES-256-GCM using a key resolved from
 * process.env at construction time.  The vault file is read fresh on every
 * `retrieve()` call and written atomically on every `persist()` call.
 *
 * Usage:
 *   const store = new ShadowStore()
 *
 *   // Persist a batch of scanned records for an address:
 *   store.persist('0xabc…', records)
 *
 *   // Retrieve previously persisted records:
 *   const records = store.retrieve('0xabc…')
 */
export class ShadowStore {
  private readonly _key:       Buffer
  private readonly _vaultPath: string

  constructor() {
    this._key       = getShadowAes256KeyFromEnv()
    this._vaultPath = resolveVaultPath()
  }

  /**
   * Persists an array of ShadowRecords for a wallet address.
   *
   * High-Exposure filter (SHADOW-VAULT-01):
   *   Only records with lethalityScore ≥ HIGH_EXPOSURE_THRESHOLD ($500) are
   *   written.  Sub-threshold records are silently dropped.
   *
   * Encrypts the qualifying records as a JSON array (AES-256-GCM, fresh IV)
   * and upserts the ciphertext into shadow_vault.json keyed by lowercase address.
   *
   * @param address  Wallet address (any case — normalised to lowercase internally).
   * @param records  Array of ShadowRecord objects from the current scan cycle.
   */
  persist(address: string, records: ShadowRecord[]): void {
    const highExposure = records.filter(r => r.lethalityScore >= HIGH_EXPOSURE_THRESHOLD)
    if (highExposure.length === 0) return

    const key  = address.toLowerCase()
    const json = JSON.stringify(highExposure)

    try {
      const vault                = readVaultFile(this._vaultPath)
      vault.records[key]         = aesGcmEncrypt(json, this._key)
      writeVaultFile(this._vaultPath, vault)

      emitLog('info', 'shadow-store.persist', {
        recordCount:  highExposure.length,
        vaultPath:    this._vaultPath,
        // GATEKEEPER-07: address withheld from log — only record count emitted.
      })
    } catch (cause: unknown) {
      emitLog('error', 'shadow-store.persist.failed', {
        cause: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  /**
   * Retrieves and decrypts previously persisted ShadowRecords for an address.
   *
   * Returns null when:
   *   - No vault entry exists for the address.
   *   - The ciphertext fails GCM authentication (tampered or key mismatch).
   *   - The decrypted payload is not valid JSON.
   *
   * (SHADOW-VAULT-04: all failure paths return null, never throw.)
   *
   * CONTRACT-01 note: amountRawStr is a decimal string — callers must
   * reconstruct via BigInt(record.amountRawStr).
   *
   * @param address  Wallet address (normalised to lowercase internally).
   */
  retrieve(address: string): ShadowRecord[] | null {
    const key = address.toLowerCase()
    const vault = readVaultFile(this._vaultPath)
    const encrypted = vault.records[key]
    if (!encrypted) return null

    const plaintext = aesGcmDecrypt(encrypted, this._key)
    if (plaintext === null) {
      emitLog('warn', 'shadow-store.retrieve.auth-failed',
        // GATEKEEPER-07: no address in log
        { hint: 'GCM tag mismatch — ciphertext may be tampered or key has rotated' },
      )
      return null
    }

    try {
      return JSON.parse(plaintext) as ShadowRecord[]
    } catch {
      emitLog('warn', 'shadow-store.retrieve.parse-failed', { hint: 'Decrypted payload is not valid JSON' })
      return null
    }
  }

  /**
   * Removes a wallet's record from the vault entirely.
   *
   * Used when the primary database resumes and the shadow record is no longer
   * needed as a durability backstop.
   *
   * @param address  Wallet address (normalised to lowercase internally).
   */
  evict(address: string): void {
    const key   = address.toLowerCase()
    const vault = readVaultFile(this._vaultPath)
    if (!(key in vault.records)) return

    delete vault.records[key]
    try {
      writeVaultFile(this._vaultPath, vault)
      emitLog('info', 'shadow-store.evict', { vaultPath: this._vaultPath })
    } catch (cause: unknown) {
      emitLog('warn', 'shadow-store.evict.failed', {
        cause: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  /**
   * Returns a count of encrypted records currently in the vault, without
   * decrypting any of them.  Used for health-check / telemetry.
   */
  recordCount(): number {
    const vault = readVaultFile(this._vaultPath)
    return Object.keys(vault.records).length
  }
}
