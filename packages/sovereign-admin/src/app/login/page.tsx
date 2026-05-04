'use client'

import { useEffect, useState } from 'react'

export default function VaultLoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!process.env.PROD) {
      console.info('SIMULATION_PURGED: Visual bloat removed. Engine is now strictly functional.')
    }
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })

      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }

      if (res.ok && j.ok === true) {
        window.location.href = '/dashboard'
        if (!process.env.PROD) {
          console.info('AUTH_TUNNELING: Session cookies applied — Supabase Auth established.')
        }
        return
      }

      if (res.status === 401 || res.status === 403) {
        setError(j.error ?? 'Auth Bridge Fix — credential denied.')
        if (res.status === 403) {
          window.location.replace('/404')
        }
        return
      }

      setError(j.error ?? 'Auth Tunneling — session establishment failed.')
    } catch (err) {
      console.error('[Auth Tunneling] Session Welding exception', err)
      setError(err instanceof Error ? err.message : 'Auth Bridge Fix — session error.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#000',
        color: '#a3a3a3',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
        padding: '1.5rem',
      }}
    >
      <div style={{ width: 'min(420px, 92vw)' }}>
        <h1
          style={{
            fontSize: '1.0625rem',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: '#f5f5f7',
            marginBottom: '0.5rem',
          }}
        >
          Sovereign Vault
        </h1>
        <p style={{ fontSize: '0.8125rem', color: '#636366', marginBottom: '1.5rem', lineHeight: 1.4 }}>
          Establish Session — Supabase Auth Session Welding.
        </p>
        <form onSubmit={onSubmit}>
          <label style={{ display: 'block', fontSize: '0.75rem', color: '#8e8e93', marginBottom: '0.35rem' }}>
            Email
          </label>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            required
            style={{
              width: '100%',
              marginBottom: '0.85rem',
              padding: '0.5rem 0.65rem',
              background: '#000',
              border: '1px solid #2c2c2e',
              borderRadius: 6,
              color: '#f5f5f7',
              fontSize: '0.9375rem',
            }}
          />
          <label style={{ display: 'block', fontSize: '0.75rem', color: '#8e8e93', marginBottom: '0.35rem' }}>
            Password
          </label>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            required
            style={{
              width: '100%',
              marginBottom: '1rem',
              padding: '0.5rem 0.65rem',
              background: '#000',
              border: '1px solid #2c2c2e',
              borderRadius: 6,
              color: '#f5f5f7',
              fontSize: '0.9375rem',
            }}
          />
          {error ? (
            <p style={{ color: '#ff453a', fontSize: '0.8125rem', marginBottom: '0.75rem', lineHeight: 1.4 }}>{error}</p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            style={{
              width: '100%',
              padding: '0.6rem',
              background: '#000',
              border: '1px solid #48484a',
              borderRadius: 6,
              color: '#f5f5f7',
              cursor: pending ? 'wait' : 'pointer',
              fontSize: '0.8125rem',
              fontWeight: 500,
              letterSpacing: '-0.01em',
            }}
          >
            {pending ? 'Authenticating…' : 'Establish Session'}
          </button>
        </form>
      </div>
    </div>
  )
}
