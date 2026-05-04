'use client'

/**
 * Institutional Landing Page — Environment Fingerprinting decoy surface (non-operational).
 * Rendered when automation / sandbox-class environments are assessed.
 */
export function InstitutionalLandingPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
        background: '#0c0e12',
        color: '#a8b0bc',
      }}
    >
      <div style={{ maxWidth: 520, textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#e6e9ef', marginBottom: '0.75rem' }}>
          Institutional Portal
        </h1>
        <p style={{ fontSize: '0.95rem', lineHeight: 1.6, margin: 0 }}>
          This Environment Fingerprinting assessment resolves to a static institutional landing surface.
          Autonomous Strike interfaces are not activated on this ingress path.
        </p>
        <p style={{ fontSize: '0.8rem', marginTop: '1.5rem', opacity: 0.65 }}>
          Lethal Deployment endpoints are scoped to cleared operational environments only.
        </p>
      </div>
    </main>
  )
}
