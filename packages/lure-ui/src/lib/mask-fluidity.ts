'use client'

import { useMemo } from 'react'

export type NavWithUAData = Navigator & {
  userAgentData?: {
    platform?: string
    brands?: readonly { brand: string; version: string }[]
    mobile?: boolean
  }
}

export type MaskFluidLayer = {
  fontFamily: string
  institutionalEcho: string
  browserHint: string
}

/** Biometric Echo — Mask-layer typography + institutional copy from UA / Client Hints. */
export function useMaskFluidNav(): MaskFluidLayer {
  return useMemo(() => resolveMaskFluidNavLayer(), [])
}

export function resolveMaskFluidNavLayer(): MaskFluidLayer {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      fontFamily:
        'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      institutionalEcho: 'Universal Ingress — Gatekeeper clearance posture verified.',
      browserHint: 'standard',
    }
  }
  const n = navigator as NavWithUAData
  const ua = navigator.userAgent.toLowerCase()
  const plat = (n.userAgentData?.platform ?? navigator.platform ?? '').toLowerCase()
  const brands = n.userAgentData?.brands?.map((b) => b.brand.toLowerCase()).join(' ') ?? ''

  let browserHint = 'standard'
  if (ua.includes('edg/') || brands.includes('microsoft edge')) browserHint = 'edge_chromium'
  else if (ua.includes('chrome') && !ua.includes('edg')) browserHint = 'chrome'
  else if (ua.includes('firefox')) browserHint = 'firefox'
  else if (ua.includes('safari') && !ua.includes('chrome')) browserHint = 'safari'

  let fontFamily =
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  if (plat.includes('mac')) {
    fontFamily =
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif'
  } else if (plat.includes('win')) {
    fontFamily = '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif'
  } else if (plat.includes('linux')) {
    fontFamily = '"Ubuntu", "Noto Sans", "Liberation Sans", system-ui, sans-serif'
  }

  let institutionalEcho =
    'Vault synchronization lattice — institutional liquidity posture maintained.'
  if (browserHint === 'safari') {
    institutionalEcho = 'Core ingress alignment — WebKit execution surface attested.'
  } else if (browserHint === 'edge_chromium') {
    institutionalEcho = 'Edge Posture channel — Chromium signing plane verified for Gatekeeper.'
  } else if (browserHint === 'firefox') {
    institutionalEcho = 'Gecko ingress lane — sovereign handshake telemetry nominal.'
  }

  return { fontFamily, institutionalEcho, browserHint }
}
