/**
 * Mesh Sync — Sovereign Telemetry webhook sender (Vercel Logs: `TELEMETRY_LOG` line).
 */
export async function sendSovereignTelemetryPayload(
  body: Record<string, unknown>,
): Promise<Response | null> {
  const url = process.env['TELEMETRY_WEBHOOK_URL']?.trim()
  if (!url) {
    console.log("TELEMETRY_LOG:", 0)
    return null
  }
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sovereign_telemetry: true, ...body }),
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    console.log("TELEMETRY_LOG:", -1)
    return null
  }
  console.log("TELEMETRY_LOG:", response.status)
  return response
}

export async function sendHeartbeatTrigger(): Promise<void> {
  await sendSovereignTelemetryPayload({
    event: 'HEARTBEAT_PING',
    message: 'HEARTBEAT: legion-engine-api manual Sovereign Audit (/health?ping=true)',
    heartbeat_trigger: true,
    mesh_sync: true,
  })
}
