import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { OmnichainProviders } from './providers'

export const metadata: Metadata = {
  title: 'Omnichain Ingress — Airdrop Hub',
}

export default function RootLayout(props: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#000', color: '#e8e8e8', minHeight: '100vh' }}>
        <OmnichainProviders>{props.children}</OmnichainProviders>
      </body>
    </html>
  )
}
