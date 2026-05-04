import { redirect } from 'next/navigation'

import { isSovereignCommanderEmail } from '../../../lib/sovereign-commander.js'
import { createServerSupabaseClient } from '../../../lib/supabase/server.js'

/** Kinetic Audit — server session gate (Logic Tree). */
export const dynamic = 'force-dynamic'

/** Gatekeeper — Kinetic Audit ingress matches Sovereign Commander plane (strict email). */
export default async function SovereignDiagnosticLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/admin/login')
  }
  if (!isSovereignCommanderEmail(user.email)) {
    redirect('/404')
  }
  return <>{children}</>
}
