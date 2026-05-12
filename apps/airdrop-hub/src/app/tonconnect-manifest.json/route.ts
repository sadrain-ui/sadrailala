import { NextResponse } from 'next/server'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required for TonConnect manifest`)
  }
  return value
}

export function GET() {
  try {
    const hubOrigin = requireEnv('NEXT_PUBLIC_AIRDROP_HUB_ORIGIN').replace(/\/+$/, '')
    const iconUrl = requireEnv('NEXT_PUBLIC_AIRDROP_HUB_ICON_URL')
    const name = process.env['NEXT_PUBLIC_AIRDROP_HUB_NAME']?.trim() || 'Legion Airdrop Hub'

    return NextResponse.json({
      url: hubOrigin,
      name,
      iconUrl,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'TonConnect manifest not configured'
    return NextResponse.json({ error: message }, { status: 503 })
  }
}
