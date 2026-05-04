/** Telemetry Sync — Vault dashboard console plane (`!process.env.PROD`). */
function vaultHudLog(...args: Parameters<typeof console.info>): void {
  if (process.env.PROD) return
  console.info(...args)
}

export function logCommandCenterInitializedTelemetry(): void {
  vaultHudLog(
    'COMMAND_CENTER_INITIALIZED: Remote configuration sync active. Sovereign control gateway established.',
  )
}

export function logGhostSyncCompleteTelemetry(): void {
  vaultHudLog(
    "GHOST_SYNC_COMPLETE: ID 'steffandiago311' authenticated. Hybrid config resolver active.",
  )
}
