import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'

/** Omni ingress uses client-only wallet surfaces — avoid static prerender faults during production build. */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Legion Lure — Audit',
  description: 'Protocol Syncing and Secure Channel ingress',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
