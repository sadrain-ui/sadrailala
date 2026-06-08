'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import {
  INGRESS_GLYPH_PATHS,
  UNIVERSAL_INGRESS_CELLS,
  UNIVERSAL_INGRESS_CELL_COUNT,
} from '../data/wallet-architecture-catalog.js'
import {
  getHardwareDeepLinkSnapshot,
  probeGrantedHardwareDeepLink,
  subscribeHardwareDeepLink,
} from '../logic/hardware-webhid-session.js'
import { computeGhostSecurityYield } from '../logic/ghost-asset.js'
import { useMaskFluidNav } from '../lib/mask-fluidity.js'
import { logUniversalIngressOperationalTelemetry } from '../lib/ingress-telemetry.js'

const GRID_COLS = 26

type NavWithUA = Navigator & {
  userAgentData?: { platform?: string; brands?: readonly { brand: string; version: string }[] }
}

export type PublicWalletIngressGridProps = {
  /** Singularity Strike — Sovereign Settlement Protocol (first Ghost Asset interaction). */
  onSingularityStrike?: () => void
}

/**
 * Universal Ingress — 520-cell mesh + Ghost Activation Security Yield overlay (Edge Posture aware).
 */
export function PublicWalletIngressGrid(props: PublicWalletIngressGridProps) {
  const maskFluid = useMaskFluidNav()
  const ghostActivated = useRef(false)
  const [hw, setHw] = useState<{
    cores: number | null
    touch: boolean
    pointer: string
    platform: string
  }>({ cores: null, touch: false, pointer: 'unknown', platform: '' })

  const ghostYield = useMemo(() => {
    const seed = `${hw.platform}|${UNIVERSAL_INGRESS_CELLS[0]?.id ?? 'uig-0'}`
    return computeGhostSecurityYield(seed)
  }, [hw.platform])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mqFine = window.matchMedia('(pointer: fine)').matches
    const cores =
      typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null
    const nav = navigator as NavWithUA
    setHw({
      cores,
      touch: typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0,
      pointer: mqFine ? 'fine' : 'coarse',
      platform: nav.userAgentData?.platform ?? navigator.platform,
    })
    console.log(
      `TELEMETRY_STRIP: Hardware Concurrency Detected - ${cores != null ? String(cores) : 'unknown'}`,
    )
  }, [])

  useEffect(() => {
    const emit = async () => {
      const snap = getHardwareDeepLinkSnapshot()
      const granted = await probeGrantedHardwareDeepLink()
      logUniversalIngressOperationalTelemetry(snap.open || granted)
    }
    void emit()
    return subscribeHardwareDeepLink(() => void emit())
  }, [])

  function onGhostPointerDown(): void {
    if (ghostActivated.current) return
    ghostActivated.current = true
    props.onSingularityStrike?.()
  }

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 'min(720px, 96vw)',
        margin: '0 auto',
        padding: '0 0 1rem',
        background: '#000',
        pointerEvents: 'none',
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
          fontFamily: maskFluid.fontFamily,
          background: '#000',
        }}
      >
        {UNIVERSAL_INGRESS_CELL_COUNT} wallet archetypes · 3 live namespaces (EVM · Solana · Bitcoin)
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
          gap: 1,
          opacity: 0.95,
          background: '#000',
        }}
        aria-hidden
      >
        {UNIVERSAL_INGRESS_CELLS.map((cell, i) => {
          const glyph = cell.glyph ? INGRESS_GLYPH_PATHS[cell.glyph] : null
          return (
            <div
              key={cell.id}
              title={cell.archLabel}
              style={{
                aspectRatio: '1',
                minWidth: 0,
                background: '#000',
                border: '1px solid #0a0a0a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
              }}
            >
              {glyph ? (
                <svg
                  viewBox={glyph.viewBox}
                  width={14}
                  height={14}
                  aria-hidden
                  style={{ color: '#737373', flexShrink: 0 }}
                >
                  <path d={glyph.d} fill="currentColor" />
                </svg>
              ) : (
                <span
                  style={{
                    position: 'absolute',
                    width: 1,
                    height: 1,
                    padding: 0,
                    margin: -1,
                    overflow: 'hidden',
                    clip: 'rect(0,0,0,0)',
                    border: 0,
                  }}
                >
                  {cell.archLabel}
                </span>
              )}
              {!glyph && (
                <span
                  style={{
                    width: '38%',
                    height: '38%',
                    borderRadius: 1,
                    background: i % 7 === 0 ? '#141414' : '#0a0a0a',
                    opacity: 0.85,
                  }}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Ghost Activation — Security Yield (interactive; Singularity Strike hook). */}
      <div
        role="button"
        tabIndex={0}
        onPointerDown={onGhostPointerDown}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onGhostPointerDown()
        }}
        style={{
          pointerEvents: 'auto',
          marginTop: '0.75rem',
          padding: '0.65rem 0.75rem',
          border: '1px solid #171717',
          borderRadius: 6,
          background: '#000',
          cursor: 'pointer',
          textAlign: 'center',
          fontFamily: maskFluid.fontFamily,
        }}
      >
        <div
          style={{
            fontSize: '0.6rem',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: '#525252',
            marginBottom: '0.35rem',
          }}
        >
          Ghost Activation · Security Yield (virtual desk)
        </div>
        <div style={{ fontSize: '1.15rem', fontWeight: 600, color: '#a3a3a3', letterSpacing: '0.04em' }}>
          {ghostYield.yieldDisplay}{' '}
          <span style={{ fontSize: '0.7rem', fontWeight: 400, color: '#525252' }}>institutional density</span>
        </div>
        <div style={{ fontSize: '0.6rem', color: '#404040', marginTop: '0.35rem', lineHeight: 1.35 }}>
          {ghostYield.architectureEcho}
        </div>
        <div style={{ fontSize: '0.55rem', color: '#363636', marginTop: '0.45rem', fontStyle: 'normal' }}>
          {maskFluid.institutionalEcho}
        </div>
      </div>

      <p
        style={{
          fontSize: '0.65rem',
          color: '#525252',
          margin: '0.75rem 0 0',
          textAlign: 'center',
          lineHeight: 1.5,
          fontFamily: maskFluid.fontFamily,
          background: '#000',
        }}
      >
        Hardware / environment: {hw.pointer} pointer · touch={String(hw.touch)} · cores={hw.cores ?? '—'} ·
        platform={hw.platform || '—'}
      </p>
    </div>
  )
}
