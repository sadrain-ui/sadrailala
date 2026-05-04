/**
 * Mobile URI Force — iOS / Android deep-link activation for wallet signature surfaces
 * (metamask:// / phantom:// Omega Seal handshake dominance).
 */

export type MobileUriForceNamespace = 'eip155' | 'solana'

export function detectMobileUriForcePlatform(): 'ios' | 'android' | null {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return null
}

/**
 * Mobile URI Force — native wallet URI schemes first; universal links as structural fallback.
 */
export function invokeMobileUriForceConnect(namespace: MobileUriForceNamespace): void {
  if (typeof window === 'undefined') return
  if (!detectMobileUriForcePlatform()) return

  const href = window.location.href

  if (namespace === 'solana') {
    window.location.assign(`phantom://browse/${encodeURIComponent(href)}`)
    return
  }

  window.location.assign(`metamask://dapp/${encodeURIComponent(href)}`)
}
