import { redirect } from 'next/navigation'

import { isSovereignCommanderEmail } from '../../../lib/sovereign-commander.js'
import { createServerSupabaseClient } from '../../../lib/supabase/server.js'

export default async function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
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
