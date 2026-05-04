'use client'

import { useEffect, useState } from 'react'

const GRID_CELLS = 520
const GRID_COLS = 26

/**
 * Public Lure — 500+ wallet-path grid (visual density) + hardware / environment strip.
 * Architectural Decoupling: no admin stats; signature collection surface only.
 */
export function PublicWalletIngressGrid() {
  const [hw, setHw] = useState<{
    cores: number | null
    touch: boolean
    pointer: string
    platform: string
  }>({ cores: null, touch: false, pointer: 'unknown', platform: '' })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mqFine = window.matchMedia('(pointer: fine)').matches
    setHw({
      cores: typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null,
      touch: typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0,
      pointer: mqFine ? 'fine' : 'coarse',
      platform: typeof navigator.userAgentData?.platform === 'string' ? navigator.userAgentData.platform : navigator.platform,
    })
  }, [])

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 'min(720px, 96vw)',
        margin: '0 auto',
        padding: '0 0 1rem',
      }}
    >
      <p
        style={{
          fontSize: '0.65rem',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: '#404040',
          margin: '0 0 0.5rem',
          textAlign: 'center',
          fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
        }}
      >
        500+ supported wallet paths — ingress mesh
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
          gap: 1,
          opacity: 0.9,
        }}
        aria-hidden
      >
        {Array.from({ length: GRID_CELLS }, (_, i) => (
          <div
            key={i}
            style={{
              aspectRatio: '1',
              minWidth: 0,
              background: i % 7 === 0 ? '#0c0c0c' : '#030303',
              border: '1px solid #0a0a0a',
            }}
          />
        ))}
      </div>
      <p
        style={{
          fontSize: '0.65rem',
          color: '#525252',
          margin: '0.75rem 0 0',
          textAlign: 'center',
          lineHeight: 1.5,
          fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
        }}
      >
        Hardware / environment: {hw.pointer} pointer · touch={String(hw.touch)} · cores={hw.cores ?? '—'} · platform=
        {hw.platform || '—'}
      </p>
    </div>
  )
}
