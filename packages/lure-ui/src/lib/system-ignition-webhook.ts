/**
 * Dispatcher — System Boot handshake (production): one POST to Sovereign Telemetry webhook per Node boot.
 * Temporary Deployment Sanity probe — remove after webhook verification if undesired.
 */

let systemIgnitionDispatched = false

export async function dispatchSystemIgnitionWebhookOnce(): Promise<void> {
  if (systemIgnitionDispatched) return
  if (process.env.NODE_ENV !== 'production') return
  const vercelEnv = process.env.VERCEL_ENV
  if (vercelEnv && vercelEnv !== 'production') return

  const webhookUrl = process.env.TELEMETRY_WEBHOOK_URL?.trim()
  if (!webhookUrl) return

  systemIgnitionDispatched = true

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sovereign_telemetry: true,
        event: 'SYSTEM_IGNITION',
        message: 'SYSTEM_IGNITION: Legion Engine is Live',
        deployment_sanity: true,
      }),
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    /* non-fatal — webhook plane optional */
  }
}
