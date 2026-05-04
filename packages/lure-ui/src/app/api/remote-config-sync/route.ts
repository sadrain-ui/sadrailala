/**
 * Remote Config Sync — public operational keys merged for Neural Scout (browser-safe allowlist).
 * Hot-Swapping: values originate from `engine_config`; DynamicConfigResolver SWR applies server-side.
 */

import { getRemoteConfigBatch } from '@legion/core/config/remote-sync'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const OPERATIONAL_PUBLIC_KEYS = [
  'NEXT_PUBLIC_NEURAL_SCOUT_ETH_USD',
  'NEXT_PUBLIC_NEURAL_SCOUT_SOL_USD',
  'NEXT_PUBLIC_NEURAL_SCOUT_BTC_USD',
  'NEXT_PUBLIC_ALCHEMY_API_KEY',
  'NEXT_PUBLIC_HELIUS_API_KEY',
  'NEXT_PUBLIC_RPC_URL',
] as const

export async function GET() {
  try {
    const batch = await getRemoteConfigBatch(OPERATIONAL_PUBLIC_KEYS)
    return NextResponse.json(batch)
  } catch {
    return NextResponse.json({})
  }
}
