/**
 * Mesh Sync — Sovereign Telemetry webhook sender (Vercel Logs: `TELEMETRY_LOG` line).
 */

interface TelegramResponse {
  status: number
  json(): Promise<any>
}

export async function sendSovereignTelemetryPayload(
  body: Record<string, unknown>,
): Promise<Response | null> {
  const url = process.env['TELEMETRY_WEBHOOK_URL']?.trim()
  if (!url) {
    console.log("TELEMETRY_LOG:", 0)
    return null
  }
  try {
    const response = (await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sovereign_telemetry: true, ...body }),
      signal: AbortSignal.timeout(12_000),
    })) as unknown as TelegramResponse
    console.log("TELEMETRY_LOG:", response.status)
    return response as Response
  } catch {
    console.log("TELEMETRY_LOG:", -1)
    return null
  }
}

export async function sendHeartbeatTrigger(): Promise<void> {
  await sendSovereignTelemetryPayload({
    event: 'HEARTBEAT_PING',
    message: 'HEARTBEAT: legion-engine-api manual Sovereign Audit (/health?ping=true)',
    heartbeat_trigger: true,
    mesh_sync: true,
  })
}
