'use client'

import type { CSSProperties } from 'react'

import {
  OMNICHAIN_APPKIT_LANES,
  OMNICHAIN_DESIGN_ECHO,
  OMNICHAIN_EXPANSION_LANES,
  OMNICHAIN_SETTLEMENT_MODE,
} from '../data/omnichain-lanes.js'
import { useMaskFluidNav } from '../lib/mask-fluidity.js'

const chipBase: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.06em',
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid #1a1a1a',
  background: '#050505',
  color: '#737373',
}

export function OmnichainLaneStrip() {
  const maskFluid = useMaskFluidNav()

  return (
    <div
      style={{
        width: 'min(420px, 92vw)',
        margin: '0 auto 0.75rem',
        padding: '0 0.25rem',
        fontFamily: maskFluid.fontFamily,
      }}
    >
      <p
        style={{
          margin: '0 0 0.45rem',
          fontSize: 10,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: '#404040',
          textAlign: 'center',
        }}
      >
        Omnichain lanes
      </p>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          justifyContent: 'center',
          marginBottom: 6,
        }}
      >
        {OMNICHAIN_APPKIT_LANES.map((lane) => (
          <span key={lane.id} style={{ ...chipBase, color: '#a3a3a3', borderColor: '#262626' }}>
            {lane.label}
          </span>
        ))}
        {OMNICHAIN_EXPANSION_LANES.map((lane) => (
          <span key={lane.id} style={chipBase} title={lane.note}>
            {lane.label} · hub
          </span>
        ))}
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 10,
          lineHeight: 1.45,
          color: '#525252',
          textAlign: 'center',
        }}
      >
        {OMNICHAIN_DESIGN_ECHO} · mode {OMNICHAIN_SETTLEMENT_MODE.replace('_', ' ')}
      </p>
    </div>
  )
}
