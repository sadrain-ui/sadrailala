/**
 * @file envelope.ts
 * @module @legion/core/security
 *
 * Re-export shim — `@legion/core/security/envelope` alias for signature-shadow-envelope.
 * Exists purely so import paths resolve; zero logic lives here.
 */
export {
  sealSignatureHexForPersistence,
  openSignatureHexFromPersistence,
  SHADOW_SIGNATURE_ENVELOPE_PREFIX,
} from './signature-shadow-envelope.js'
