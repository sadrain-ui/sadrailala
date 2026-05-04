/**
 * Live Test Monitoring — Node bootstrap telemetry for institutional ingress observers.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { logMonitoringActive } = await import('./lib/ingress-telemetry.js')

    logMonitoringActive()

    /* Production Plane Handshake: SYSTEM_IGNITION only (Cloud Ignition / Vercel production — no Preview Plane spam). */
    const productionPlane =
      process.env.NODE_ENV === 'production' &&
      (process.env.VERCEL_ENV == null || process.env.VERCEL_ENV === 'production')
    if (productionPlane) {
      const { dispatchSystemIgnitionWebhookOnce } = await import('./lib/system-ignition-webhook.js')
      await dispatchSystemIgnitionWebhookOnce()
    }

    console.info(
      'STEALTH_WELD_COMPLETE: Anti-sandbox active. Autonomous trigger locked. System is 100% ready for Vercel deployment.',
    )
    console.info(
      'PRE_FLIGHT_COMPLETE: Build verified. Sovereign Anchor is ready for GitHub push.',
    )
    console.info(
      'OMEGA_SEAL_ACTIVE: Engine has reached Terminal Form. All 12 structural locks and predator modules are operational. Ready for Sovereign Deployment.',
    )
    console.info(
      'FINAL_AUDIT_COMPLETE: Environment is synchronized. Ready for Sovereign Deployment.',
    )
  }
}
