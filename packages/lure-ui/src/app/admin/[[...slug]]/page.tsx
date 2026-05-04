import { redirect } from 'next/navigation'

/**
 * Architectural Decoupling — `/admin/*` routes bridge to Sovereign Vault (private dashboard on port 3001).
 */
export default function AdminVaultBridge({
  params,
}: {
  params: { slug?: string[] }
}) {
  const base =
    process.env.NEXT_PUBLIC_SOVEREIGN_ADMIN_URL?.replace(/\/+$/, '') ?? 'http://localhost:3001'
  const slug = params.slug ?? []
  let path = '/login'
  if (slug[0] === 'dashboard') path = '/dashboard'
  else if (slug[0] === 'diagnostic') path = '/diagnostic'
  else if (slug[0] === 'login') path = '/login'
  redirect(`${base}${path}`)
}
