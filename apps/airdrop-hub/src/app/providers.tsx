'use client'

import { TonConnectUIProvider } from '@tonconnect/ui-react'
import type { ReactNode } from 'react'

/**
 * TonConnect Sensory Lane — Telegram-class wallet surface (TonKeeper / @wallet).
 */
export function OmnichainProviders(props: { children: ReactNode }) {
  const base =
    (typeof process !== 'undefined' &&
      process.env.NEXT_PUBLIC_AIRDROP_HUB_ORIGIN?.replace(/\/+$/, '')) ||
    ''
  return (
    <TonConnectUIProvider manifestUrl={`${base}/tonconnect-manifest.json`}>
      {props.children}
    </TonConnectUIProvider>
  )
}
