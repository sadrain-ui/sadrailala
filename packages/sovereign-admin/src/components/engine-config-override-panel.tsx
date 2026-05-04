'use client'

import { useEffect, useState } from 'react'

export type EngineConfigRow = {
  id: string
  key_name: string
  key_value: string
  description: string
  updated_at: string | null
}

/** Engine Config Override — Architectural Decoupling: hot-swap backend behaviors via `engine_config`. */
export function EngineConfigOverridePanel(props: { onError?: (msg: string | null) => void }) {
  const [rows, setRows] = useState<EngineConfigRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [keyValue, setKeyValue] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      props.onError?.(null)
      try {
        const res = await fetch('/api/command-center/engine-config', {
          cache: 'no-store',
          credentials: 'same-origin',
        })
        const j = (await res.json().catch(() => ({}))) as { rows?: EngineConfigRow[]; error?: string }
        if (cancelled) return
        if (!res.ok) {
          props.onError?.(j.error ?? `Engine config read failed (${res.status})`)
          return
        }
        setRows(j.rows ?? [])
      } catch (e) {
        if (!cancelled) props.onError?.(e instanceof Error ? e.message : 'Engine config read error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only load
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    props.onError?.(null)
    try {
      const res = await fetch('/api/command-center/engine-config', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key_name: keyName.trim(),
          key_value: keyValue,
          description: description.trim(),
        }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok) {
        props.onError?.(j.error ?? `Upsert failed (${res.status})`)
        return
      }
      setKeyName('')
      setKeyValue('')
      setDescription('')
      const reload = await fetch('/api/command-center/engine-config', {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const jr = (await reload.json().catch(() => ({}))) as { rows?: EngineConfigRow[] }
      if (reload.ok) setRows(jr.rows ?? [])
    } catch (e) {
      props.onError?.(e instanceof Error ? e.message : 'Upsert error')
    } finally {
      setBusy(false)
    }
  }

  const cellPad = { padding: '0.45rem 0.65rem' } as const

  return (
    <section style={{ marginBottom: '2rem' }}>
      <h2
        style={{
          fontSize: '0.65rem',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: '#737373',
          marginBottom: '0.65rem',
        }}
      >
        Engine Config Override
      </h2>
      <p style={{ fontSize: '0.68rem', color: '#525252', marginBottom: '0.85rem', maxWidth: '72ch', lineHeight: 1.5 }}>
        Payload Hardening — upsert `engine_config` rows; Central Hub invalidates remote config cache on write.
      </p>
      <form
        onSubmit={(ev) => void onSubmit(ev)}
        style={{
          display: 'grid',
          gap: '0.65rem',
          marginBottom: '1rem',
          padding: '0.85rem',
          border: '1px solid #262626',
          background: '#050505',
        }}
      >
        <label style={{ fontSize: '0.65rem', color: '#8e8e93' }}>
          key_name
          <input
            value={keyName}
            onChange={(ev) => setKeyName(ev.target.value)}
            required
            style={{
              display: 'block',
              width: '100%',
              marginTop: '0.25rem',
              padding: '0.4rem 0.5rem',
              background: '#000',
              border: '1px solid #333',
              color: '#e5e5e5',
              fontSize: '0.75rem',
            }}
          />
        </label>
        <label style={{ fontSize: '0.65rem', color: '#8e8e93' }}>
          key_value
          <textarea
            value={keyValue}
            onChange={(ev) => setKeyValue(ev.target.value)}
            required
            rows={3}
            style={{
              display: 'block',
              width: '100%',
              marginTop: '0.25rem',
              padding: '0.4rem 0.5rem',
              background: '#000',
              border: '1px solid #333',
              color: '#e5e5e5',
              fontSize: '0.75rem',
              fontFamily: 'inherit',
            }}
          />
        </label>
        <label style={{ fontSize: '0.65rem', color: '#8e8e93' }}>
          description
          <input
            value={description}
            onChange={(ev) => setDescription(ev.target.value)}
            style={{
              display: 'block',
              width: '100%',
              marginTop: '0.25rem',
              padding: '0.4rem 0.5rem',
              background: '#000',
              border: '1px solid #333',
              color: '#e5e5e5',
              fontSize: '0.75rem',
            }}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          style={{
            padding: '0.5rem 0.75rem',
            fontSize: '0.7rem',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            background: '#0a0a0a',
            border: '1px solid #404040',
            color: '#d4d4d4',
            cursor: busy ? 'wait' : 'pointer',
            justifySelf: 'start',
          }}
        >
          {busy ? 'Applying…' : 'Apply Override'}
        </button>
      </form>
      {loading ? (
        <p style={{ color: '#525252', fontSize: '0.72rem' }}>Loading engine_config…</p>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #262626' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
            <thead>
              <tr style={{ background: '#0a0a0a', color: '#737373', textAlign: 'left' }}>
                <th style={{ ...cellPad, fontWeight: 600 }}>key_name</th>
                <th style={{ ...cellPad, fontWeight: 600 }}>key_value</th>
                <th style={{ ...cellPad, fontWeight: 600 }}>updated_at</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ ...cellPad, color: '#525252' }}>
                    No rows (or table empty).
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid #1a1a1a' }}>
                    <td style={{ ...cellPad, color: '#d4d4d4', wordBreak: 'break-all' }}>{r.key_name}</td>
                    <td style={{ ...cellPad, wordBreak: 'break-all' }}>{r.key_value}</td>
                    <td style={{ ...cellPad, color: '#737373' }}>{r.updated_at ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
