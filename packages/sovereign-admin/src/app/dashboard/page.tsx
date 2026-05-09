import type { Metadata } from 'next'

import { VaultCommandCenter } from '../../components/vault-dashboard'

/** App Router marks this route ƒ — dynamic SSR (built; not omitted from production output). */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Vault — Command Center',
}

export default function DashboardPage() {
  return <VaultCommandCenter />
}
