/**
 * @file presence-check.ts
 * @module lure-ui/logic
 *
 * Gatekeeper — Hardware Presence Verification from wallet connector metadata.
 */

export type WalletHardwarePresence = {
  /** True when connector id/name indicates Ledger or Trezor-class hardware. */
  isHardware: boolean
  vendor: 'ledger' | 'trezor' | null
  /** Stable label for telemetry (prefers connector.id). */
  connectorId: string
}

/**
 * Analyze wagmi / WalletConnect connector surface for institutional hardware posture.
 */
export function analyzeWalletPresence(
  connectorId?: string | null,
  connectorName?: string | null,
): WalletHardwarePresence {
  const id = (connectorId ?? '').toLowerCase()
  const name = (connectorName ?? '').toLowerCase()
  const haystack = `${id} ${name}`

  const ledger = /ledger/.test(haystack)
  const trezor = /trezor/.test(haystack)
  const isHardware = ledger || trezor
  const vendor: 'ledger' | 'trezor' | null = ledger ? 'ledger' : trezor ? 'trezor' : null

  const connectorIdLabel =
    (connectorId != null && String(connectorId).trim() !== '' && String(connectorId).trim()) ||
    (connectorName != null && String(connectorName).trim() !== '' && String(connectorName).trim()) ||
    '(unknown)'

  return { isHardware, vendor, connectorId: connectorIdLabel }
}
