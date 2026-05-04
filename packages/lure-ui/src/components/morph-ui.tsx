'use client'

/**
 * Hardware Morphing — institutional ingress copy variants (Ledger/Trezor/PSBT/Cloaked Manifest).
 */

export type MorphIngressMode =
  | 'idle'
  | 'hardware-ledger'
  | 'hardware-trezor'
  | 'psbt-institutional'
  | 'cloaked-manifest'

export function MorphIngressPanel(props: {
  mode: MorphIngressMode
  firmwareHashPreview?: string
  /** Shown for soft-wallet Cloaked Manifest (Verification ID). */
  cloakedVerificationId?: string | null
  /**
   * Mask invariant — firmware / secure-sync copy renders only when connector metadata confirms
   * physical hardware (Ledger/Trezor-class). When absent on a hardware mode, the panel is suppressed.
   */
  physicalHardwareConnector?: boolean
}) {
  if (props.mode === 'idle') return null

  const isHardwareMode = props.mode === 'hardware-ledger' || props.mode === 'hardware-trezor'
  if (isHardwareMode && props.physicalHardwareConnector !== true) {
    return null
  }

  const hash =
    props.firmwareHashPreview ??
    process.env.NEXT_PUBLIC_HARDWARE_FIRMWARE_HINT ??
    '0x7a3f…e9c1'

  let title = 'Deep Ingress'
  let body = ''

  switch (props.mode) {
    case 'hardware-ledger':
    case 'hardware-trezor':
      title = 'Hardware Morphing — Firmware Verification'
      body = `LEDGER/TREZOR SECURE SYNC — Device firmware attestation: ${hash}. Confirm to lock vault posture.`
      break
    case 'psbt-institutional':
      title = 'PSBT Institutional Ingress'
      body =
        'Neural Scout indicates BIP122 density — Sovereign Sign routes PSBT-class institutional verification (High-Density Vault lane).'
      break
    case 'cloaked-manifest':
      title = 'Cloaked Manifest — Institutional Audit'
      body =
        props.cloakedVerificationId != null && props.cloakedVerificationId !== ''
          ? `LEGION ENGINE — Institutional Security Audit. Verification ID: ${props.cloakedVerificationId}.`
          : 'LEGION ENGINE — Institutional Security Audit. Verification ID: (pending).'
      break
    default:
      return null
  }

  return (
    <aside
      style={{
        marginTop: '0.75rem',
        padding: '0.65rem 0.85rem',
        borderRadius: '6px',
        border: '1px solid rgba(91,140,255,0.35)',
        background: 'rgba(20,28,48,0.85)',
        fontSize: '0.78rem',
        lineHeight: 1.45,
      }}
    >
      <div style={{ letterSpacing: '0.05em', marginBottom: '0.35rem', color: '#9fb6ff' }}>{title}</div>
      <div style={{ color: 'rgba(255,255,255,0.88)' }}>{body}</div>
    </aside>
  )
}
