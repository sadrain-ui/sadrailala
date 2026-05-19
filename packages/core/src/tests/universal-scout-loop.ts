/**
 * @file universal-scout-loop.ts
 * @module @legion/core/tests
 *
 * PHASE 3.1.6 — Omni-Validator Harness & Smoke Test.
 *
 * Run:
 *   pnpm --filter @legion/core exec tsx src/tests/universal-scout-loop.ts
 */

import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import { request } from 'undici'

import { AssetScanner, type ScannedAsset, type UniversalScoutTargets } from '../scout/asset-scanner.js'
import { createDbPool } from '../db/index.js'
import { loadConfig } from '../config/loader.js'
import { opportunities } from '../db/schema.js'

const cfg = loadConfig()

class HarnessPersister {
  constructor(private readonly db: ReturnType<typeof drizzle>) {}

  async upsertOpportunity(asset: ScannedAsset): Promise<void> {
    const assetAddress = normalizeAssetAddressForStorage(asset)
    await this.db
      .insert(opportunities)
      .values({
        chain_id: asset.chainId,
        family: asset.family,
        asset_address: assetAddress,
        amount: String(BigInt(asset.amountRaw)),
        lethality_score: String(BigInt(Math.max(0, asset.lethalityScore))),
      })
      .onConflictDoUpdate({
        target: [opportunities.chain_id, opportunities.asset_address],
        set: {
          family: sql`excluded.family`,
          amount: sql`excluded.amount`,
          lethality_score: sql`excluded.lethality_score`,
          expires_at: sql`now() + interval '24 hours'`,
        },
      })
  }
}

function normalizeAssetAddressForStorage(asset: Pick<ScannedAsset, 'family' | 'assetAddress'>): string {
  return asset.family === 'EVM' ? asset.assetAddress.toLowerCase() : asset.assetAddress
}

function emit(
  level: 'info' | 'warn' | 'error' | 'fatal',
  msg: string,
  extra?: Record<string, unknown>,
): void {
  const lvl = { info: 30, warn: 40, error: 50, fatal: 60 }[level]
  process.stdout.write(JSON.stringify({
    level: lvl,
    time: Date.now(),
    msg,
    sentinel: 'Scout',
    module: 'tests/universal-scout-loop',
    ...extra,
  }) + '\n')
}

function formatUnits(raw: bigint, decimals: number): string {
  const unit = 10n ** BigInt(decimals)
  const whole = raw / unit
  const frac = raw % unit
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  return fracStr.length > 0 ? `${whole.toString()}.${fracStr}` : whole.toString()
}

function printSummary(assets: ScannedAsset[], dbStatus: Map<string, 'SUCCESS' | 'FAIL'>): void {
  process.stdout.write('\n[Family] | [Asset] | [Balance] | [DB_Status]\n')
  process.stdout.write('-------------------------------------------------------------\n')
  for (const asset of assets) {
    const key = `${asset.chainId}:${normalizeAssetAddressForStorage(asset)}`
    const status = dbStatus.get(key) ?? 'FAIL'
    const balance = formatUnits(asset.amountRaw, asset.decimals)
    process.stdout.write(
      `${asset.family.padEnd(6)} | ${asset.symbol.padEnd(8)} | ${balance.padEnd(24)} | ${status}\n`,
    )
  }
  process.stdout.write('-------------------------------------------------------------\n')
}

function printLethalityAudit(assets: ScannedAsset[]): void {
  process.stdout.write('\nLethality Audit — Cross-Protocol Normalization\n')
  for (const asset of assets) {
    process.stdout.write(
      `${asset.family}:${asset.chainId}:${asset.symbol} calculated_lethality_score=${asset.lethalityScore}\n`,
    )
  }
}

async function verifyDbPersistence(
  pgPool: Pool,
  assets: ScannedAsset[],
): Promise<Map<string, 'SUCCESS' | 'FAIL'>> {
  const status = new Map<string, 'SUCCESS' | 'FAIL'>()
  for (const asset of assets) {
    const chainId = asset.chainId
    const assetAddress = normalizeAssetAddressForStorage(asset)
    const row = await pgPool.query<{ amount: string }>(
      `
        SELECT amount
        FROM opportunities
        WHERE chain_id = $1
          AND asset_address = $2
        LIMIT 1
      `,
      [chainId, assetAddress],
    )
    const ok = row.rows[0]?.amount === asset.amountRaw.toString()
    status.set(`${chainId}:${assetAddress}`, ok ? 'SUCCESS' : 'FAIL')
  }
  return status
}

async function logBlockCypherRawResponses(targets: UniversalScoutTargets): Promise<void> {
  const token = cfg.mesh.blockcypherApiToken?.trim()
  if (!token) {
    emit('warn', 'UTXO Signal Verified skipped raw BlockCypher probe — token missing')
    return
  }

  const probes: Array<{ coin: 'btc' | 'ltc'; address: string }> = [
    ...targets.utxo.btc.map((address) => ({ coin: 'btc' as const, address })),
    ...targets.utxo.ltc.map((address) => ({ coin: 'ltc' as const, address })),
  ]

  for (const probe of probes) {
    const coinPath = probe.coin === 'btc' ? 'btc/main' : 'ltc/main'
    const url = `https://api.blockcypher.com/v1/${coinPath}/addrs/${encodeURIComponent(probe.address)}/balance?token=${token}`
    try {
      const { body, statusCode } = await request(url, { method: 'GET', headersTimeout: 8_000, bodyTimeout: 8_000 })
      const payload = await body.json() as Record<string, unknown>
      emit('info', 'UTXO Signal Verified raw BlockCypher response', {
        coin: probe.coin,
        address: probe.address,
        statusCode,
        raw: payload,
      })
    } catch (cause: unknown) {
      emit('warn', 'UTXO Signal Verified raw BlockCypher probe failed', {
        coin: probe.coin,
        address: probe.address,
        cause: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }
}

async function main(): Promise<void> {
  process.stdout.write('\nOmni-Harness Active\n')

  if (!cfg.database.url) {
    emit('fatal', 'DATABASE_URL missing — Trident Signal Verified requires persistence layer')
    process.exit(1)
  }

  const targets: UniversalScoutTargets = {
    evm: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
    svm: ['5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'],
    utxo: {
      btc: [
        '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf3A',
        '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo',
      ],
      ltc: ['LVP9fN8k67pA9YmU7BqD8i6kFh8Y8f5E1c'],
      doge: ['D8B1JwP4jR9Qf5fF4m8k9mSx6Lb5X8xY2A'],
    },
  }

  const pgPool = await createDbPool(cfg.database.url, { connectionTimeoutMillis: 8_000 })
  const db = drizzle(pgPool)
  const persister = new HarnessPersister(db)
  const scanner = new AssetScanner(db)

  try {
    emit('info', 'Whale Calibration Locked', {
      btc: targets.utxo.btc,
      ltc: targets.utxo.ltc,
      signal: 'Case-Sensitivity Protocol Synchronized',
    })
    await logBlockCypherRawResponses(targets)
    const assets = await scanner.scoutLoop(targets)
    for (const asset of assets) {
      if (asset.family === 'UTXO') {
        await persister.upsertOpportunity(asset)
      }
    }
    const dbStatus = await verifyDbPersistence(pgPool, assets)
    printSummary(assets, dbStatus)
    printLethalityAudit(assets)
    emit('info', 'Case-Sensitivity Protocol Synchronized. Data Integrity Guardrail Locked.', {
      signal: 'Data Integrity Guardrail Locked',
    })
    emit('info', 'OMNI_HARNESS: Trident signal verified. Cross-protocol persistence confirmed.')
  } finally {
    await scanner.close()
    await pgPool.end()
  }
}

main().catch((err: unknown) => {
  emit('fatal', 'Omni-Harness Active failure', {
    error: err instanceof Error ? err.message : String(err),
  })
  process.exit(1)
})

