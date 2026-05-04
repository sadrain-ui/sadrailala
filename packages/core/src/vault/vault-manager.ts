/**
 * @file vault-manager.ts
 * @module @legion/core/vault
 * @sentinel Gatekeeper (Key custody, identity verification)
 *
 * Production VaultManager — secp256k1 key custody and identity verification.
 *
 * GATEKEEPER-07 contract (Zero-Leak Fencing):
 *   - The raw private key scalar is stored exclusively in a JS private field (`#`).
 *     It is syntactically unreachable from outside the class and cannot be serialised
 *     by JSON.stringify, structuredClone, or any object spread.
 *   - `verifyIdentity()` logs ONLY the derived public address. The key NEVER enters
 *     any output channel: logs, OTel spans, error objects, or return values.
 *   - Unencrypted {r, s, v} signature components are NEVER logged or persisted.
 *     `sign()` returns a 65-byte compact hex string (`0x{r}{s}{v}`).
 *   - Pino redact paths enforced via the caller's ILogger (GATEKEEPER-07 list).
 *
 * Storage contract:
 *   1. Hardware wallet / HSM — key never extracted (production preference).
 *   2. OS keychain / AWS KMS — VaultManager decrypts in-memory, NEVER writes decrypted
 *      form to disk or DB.
 *   3. `loadFromEnv()` path (development / CI only) — raw hex from process.env absorbed
 *      directly into `#privateKey`. The env var is NOT re-read after construction.
 *
 * CONTRACT-01: All balance / amount values at call sites remain uint256 BigInt.
 * CONTRACT-05: All errors thrown are VaultError (LegionError-compatible).
 *
 * Dependencies: viem (already in @legion/core) — no extra secp256k1 package needed.
 *   `privateKeyToAddress` from `viem/accounts` derives EIP-55 checksummed address.
 *   `sign` from `viem/accounts` produces a secp256k1 compact signature.
 */

import { privateKeyToAddress, sign as viemSign } from 'viem/accounts'
import { getAddress, isAddress, type Address, type Hex } from 'viem'

// ─── Logger interface (SHADOW-04 compatible) ──────────────────────────────────
// Minimal structural interface. SovereignLogger and pino loggers satisfy this
// without any import coupling.

export interface ILogger {
  info (msg: string, extra?: Record<string, unknown>): void
  warn (msg: string, extra?: Record<string, unknown>): void
  error(msg: string, extra?: Record<string, unknown>): void
}

// ─── VaultError ───────────────────────────────────────────────────────────────
// CONTRACT-05: never throw raw Error — always VaultError with a code.

export const VaultErrorCode = {
  INVALID_KEY_FORMAT:  'VAULT_INVALID_KEY_FORMAT',
  ENV_VAR_MISSING:     'VAULT_ENV_VAR_MISSING',
  SIGN_FAILED:         'VAULT_SIGN_FAILED',
  IDENTITY_UNRESOLVED: 'VAULT_IDENTITY_UNRESOLVED',
} as const

export type VaultErrorCode = (typeof VaultErrorCode)[keyof typeof VaultErrorCode]

export class VaultError extends Error {
  readonly code:        VaultErrorCode
  readonly sentinel:    string
  readonly recoverable: boolean
  readonly rootCause:   unknown

  constructor(opts: {
    code:        VaultErrorCode
    msg:         string
    recoverable: boolean
    cause?:      unknown
  }) {
    super(opts.msg)
    this.name        = 'VaultError'
    this.code        = opts.code
    this.sentinel    = 'Gatekeeper'
    this.recoverable = opts.recoverable
    this.rootCause   = opts.cause ?? null
  }
}

// ─── VaultManager ─────────────────────────────────────────────────────────────

export class VaultManager {
  /** @gatekeeper NEVER log, NEVER export, NEVER serialise */
  readonly #privateKey: Hex

  /** Stable identifier stored in chain_registry / approval_ledger. */
  readonly keyId: string

  private constructor(keyId: string, privateKey: Hex) {
    this.keyId      = keyId
    this.#privateKey = privateKey
  }

  // ─── Factory: explicit hex ──────────────────────────────────────────────────

  /**
   * Loads a key into the vault from a raw hex string.
   * The `rawKeyHex` argument is absorbed into `#privateKey` immediately.
   * It is intentionally NOT logged anywhere in this method.
   *
   * Accepts keys with or without `0x` prefix (normalises internally).
   *
   * @param keyId     - Stable key identifier (logged for tracing; never the key itself).
   * @param rawKeyHex - 64-char hex private key. Development / CI only; production uses HSM.
   */
  static load(keyId: string, rawKeyHex: string): VaultManager {
    const stripped = rawKeyHex.startsWith('0x') ? rawKeyHex.slice(2) : rawKeyHex
    if (!/^[0-9a-fA-F]{64}$/.test(stripped)) {
      throw new VaultError({
        code:        VaultErrorCode.INVALID_KEY_FORMAT,
        msg:         `[VaultManager] key '${keyId}' is not valid 64-char hex (0x-prefix optional)`,
        recoverable: false,
      })
    }
    return new VaultManager(keyId, `0x${stripped}` as Hex)
  }

  // ─── Factory: environment variable ─────────────────────────────────────────

  /**
   * Convenience factory: reads `process.env[envVar]`, validates it, and
   * returns a VaultManager instance.
   *
   * GATEKEEPER-07: the env var VALUE is absorbed and NEVER emitted in logs or
   * error messages.  Only `envVar` (the variable NAME) may appear in error output.
   *
   * @param keyId  - Stable key identifier (used for tracing).
   * @param envVar - Environment variable name (e.g. 'FLASHBOTS_AUTH_KEY').
   */
  static loadFromEnv(keyId: string, envVar: string): VaultManager {
    const raw = process.env[envVar]
    if (!raw || raw.trim() === '') {
      throw new VaultError({
        code:        VaultErrorCode.ENV_VAR_MISSING,
        msg:         `[VaultManager] env var '${envVar}' is not set or empty`,
        recoverable: true,
      })
    }
    return VaultManager.load(keyId, raw.trim())
  }

  // ─── getPublicAddress ───────────────────────────────────────────────────────

  /**
   * Derives the EIP-55 checksummed public address for this key.
   *
   * GATEKEEPER-07: only the public address is returned. The private scalar
   * never leaves the vault context. Callers MAY log or display this value.
   */
  getPublicAddress(): Address {
    return privateKeyToAddress(this.#privateKey)
  }

  // ─── verifyIdentity ─────────────────────────────────────────────────────────

  /**
   * Derives the public address from the loaded private key and emits it as an
   * INFO log entry to confirm the key is valid and correctly formed.
   *
   * GATEKEEPER-07 compliance:
   *   ✓  Only the derived public address is passed to the logger.
   *   ✗  The private key scalar NEVER enters the log entry.
   *   ✗  No intermediate representation of the key is constructed for logging.
   *
   * @param log - Any ILogger-compatible logger (SovereignLogger, pino child, …).
   * @returns The EIP-55 checksummed public address (safe to log / display).
   */
  verifyIdentity(log: ILogger): Address {
    let address: Address
    try {
      address = this.getPublicAddress()
    } catch (cause: unknown) {
      const err = new VaultError({
        code:        VaultErrorCode.IDENTITY_UNRESOLVED,
        msg:         `[VaultManager '${this.keyId}'] address derivation failed`,
        recoverable: false,
        cause,
      })
      log.error('VaultManager.verifyIdentity() failed', {
        keyId: this.keyId,
        code:  err.code,
        // cause.message is safe — it never contains key material
        reason: cause instanceof Error ? cause.message : String(cause),
      })
      throw err
    }

    log.info('VaultManager identity verified', {
      keyId:         this.keyId,
      // GATEKEEPER-07: publicAddress is the ONLY vault-related field logged here.
      publicAddress: address,
      checksummed:   true,
    })

    return address
  }

  // ─── sign ───────────────────────────────────────────────────────────────────

  /**
   * Signs a 32-byte hash with the vault's private key (secp256k1 ECDSA).
   *
   * Returns the 65-byte compact hex signature `0x{r32}{s32}{v1}`.
   *
   * GATEKEEPER-07: {r, s, v} raw components are NEVER individually logged or
   * persisted. Callers MUST store the compact signature only. The underlying
   * viem `sign()` call is wrapped in a try-catch; the caught error is surfaced
   * as a VaultError without leaking key material through the error message.
   *
   * @param payloadHash - 0x-prefixed 32-byte hash to sign.
   * @returns 0x-prefixed 65-byte compact signature string.
   */
  async sign(payloadHash: Hex): Promise<Hex> {
    try {
      const { r, s, v } = await viemSign({
        hash:       payloadHash,
        privateKey: this.#privateKey,
      })
      // Compact encoding: r (32 bytes) + s (32 bytes) + v (1 byte)
      // {r, s, v} are NOT logged individually — only the compact hex is returned.
      const vByte = v === 28n ? '1c' : '1b'
      return `0x${r.slice(2)}${s.slice(2)}${vByte}` as Hex
    } catch (cause: unknown) {
      throw new VaultError({
        code:        VaultErrorCode.SIGN_FAILED,
        msg:         `[VaultManager '${this.keyId}'] secp256k1 sign failed`,
        recoverable: false,
        cause,
      })
    }
  }

  // ─── isValidEip55Address (static utility) ───────────────────────────────────

  /**
   * Returns the EIP-55 checksummed form of `addr`, or null if the address is
   * not a valid 20-byte EVM address.  Utility for Check E (ADMIN_WALLET_ADDRESS).
   *
   * Does not require a VaultManager instance — purely a static helper.
   */
  static checksumAddress(addr: string): Address | null {
    const trimmed = addr.trim()
    if (!isAddress(trimmed)) return null
    return getAddress(trimmed)
  }
}
