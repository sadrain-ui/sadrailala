/**
 * @file presence-check.ts
 * @module lure-ui/logic
 *
 * Gatekeeper — Active Session Management + connector heuristics for hardware-class Universal Ingress.
 */

import type { HardwareDeepLinkSnapshot } from './hardware-webhid-session.js'

export type WalletHardwarePresence = {
  /** True when Active Session Management or connector surface indicates hardware-class. */
  isHardware: boolean
  vendor: 'ledger' | 'trezor' | null
  /** Stable label for telemetry (prefers connector.id). */
  connectorId: string
}

/**
 * Heuristic-only path — connector id/name (Legacy detection surface).
 */
export function inferHeuristicWalletPresence(
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

/**
 * Active Session Management wins over heuristics when a hardware deep-link is open.
 */
export function analyzeWalletPresence(
  connectorId?: string | null,
  connectorName?: string | null,
  activeHardware?: HardwareDeepLinkSnapshot | null,
): WalletHardwarePresence {
  const h = inferHeuristicWalletPresence(connectorId, connectorName)
  if (activeHardware?.open && activeHardware.vendor) {
    return {
      isHardware: true,
      vendor: activeHardware.vendor,
      connectorId: h.connectorId,
    }
  }
  return h
}
