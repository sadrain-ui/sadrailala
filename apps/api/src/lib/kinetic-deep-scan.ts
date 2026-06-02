/**
 * Kinetic Link — Signature Anchor → Deep Asset Scanner (Node runtime).
 * High-priority microtask dispatch maps all nominal discovery lanes for the wallet address.
 */

import { runAndPersistAssetScan } from './asset-scan-store.js'

function kineticDeepScanLog(level: 'error' | 'warn' | 'info', event: string, detail: string): void {
  const line = JSON.stringify({
    level: level === 'error' ? 50 : level === 'warn' ? 40 : 30,
    time: Date.now(),
    sentinel: 'Gatekeeper',
    module: 'lib/kinetic-deep-scan',
    event,
    detail,
  })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.info(line)
}

/**
 * Queue AssetScanner on the microtask queue — binds Signature Anchor persistence to omnichain lane sweep.
 */
export function queueKineticDeepAssetScan(wallet_address: string): void {
  queueMicrotask(() => {
    void runKineticDeepAssetScan(wallet_address).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      kineticDeepScanLog('warn', 'kinetic_deep_scan.failed', msg)
    })
  })
}

async function runKineticDeepAssetScan(wallet_address: string): Promise<void> {
  const normalized = wallet_address.trim()
  if (!normalized) {
    kineticDeepScanLog('warn', 'kinetic_deep_scan.empty_wallet', 'wallet_address missing')
    return
  }
  const result = await runAndPersistAssetScan(normalized)
  if (result.ok === false) {
    kineticDeepScanLog('warn', 'kinetic_deep_scan.persist_failed', result.error)
    return
  }
  kineticDeepScanLog(
    'info',
    'kinetic_deep_scan.persisted',
    `assets=${result.record.asset_count} usd=${result.record.total_value_usd}`,
  )
}

export { runAndPersistAssetScan, persistAssetScan, fetchLatestAssetScan } from './asset-scan-store.js'
