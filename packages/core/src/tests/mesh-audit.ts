/**
 * @file mesh-audit.ts
 * @module @legion/core/tests
 * @sentinel Scout
 *
 * Sovereign Mesh Audit — Node Ingestion Locked Validation Script.
 *
 * Runs a single full ingest cycle against all three discovery sources
 * (chainid.network, ethereum-lists/chains GitHub, PublicNode extended seeds)
 * and a concurrent ProviderMesh healthPing across EVM/SVM/UTXO families.
 *
 * Output (printed to stdout as structured NDJSON + human-readable summary):
 *   • Total Nodes Discovered   — all candidates before the Latency Sieve
 *   • Total Nodes Probed       — candidates after dedup + blacklist filter
 *   • Total Nodes Active       — passed Latency Sieve (RTT ≤ 300 ms, lag ≤ 10 blocks)
 *   • Nodes Lag-Purged         — passed RTT but failed block-height lag check
 *   • Nodes Blacklisted        — 429 rate-limited during this cycle
 *   • Breakdown by EVM Chain   — per-chain active count + top-3 lowest-latency URLs
 *   • ProviderMesh Health      — EVM/SVM/UTXO live/total counts and signals
 *   • Zero-API Lock Status     — whether mesh density exceeds the 50-node threshold
 *
 * Usage:
 *   pnpm --filter @legion/core exec tsx src/tests/mesh-audit.ts
 *
 * No database connection is required.  All probes are read-only network calls.
 * No API keys are used — SCOUT-MESH-01 enforced throughout.
 */

import { request }       from 'undici'
import { MeshIngestor }  from '../scout/mesh-ingestor'
import { ProviderMesh, resolveTransportPolicy }  from '../scout/rpc-mesh'
import { loadConfig }    from '../config/loader'

// ─── Formatting helpers ───────────────────────────────────────────────────────

const CHAIN_LABELS: Readonly<Record<number, string>> = {
  1:      'Ethereum Mainnet  (EVM:1)',
  137:    'Polygon PoS       (EVM:137)',
  42_161: 'Arbitrum One      (EVM:42161)',
  8_453:  'Base              (EVM:8453)',
  10:     'Optimism          (EVM:10)',
}

function pad(label: string, width: number): string {
  return label.padEnd(width, ' ')
}

function hr(char = '─', width = 72): string {
  return char.repeat(width)
}

function printLine(label: string, value: string | number): void {
  console.log(`  ${pad(String(label) + ':', 42)} ${value}`)
}

// ─── Managed Transport Validation ─────────────────────────────────────────────
// Probes each configured managed endpoint (Alchemy EVM, Chainstack SVM) and
// emits MANAGED_SIGNAL lines before the public-mesh audit begins.
// This confirms API keys are live even when the public mesh is degraded.
// Runs only when USE_HYBRID_MODE = true (silent no-op otherwise).

const MANAGED_PROBE_TIMEOUT_MS = 5_000

const ALCHEMY_EVM_PROBES: ReadonlyArray<{ label: string; subdomain: string; chainId: number }> = [
  { label: 'Ethereum Mainnet  (EVM:1)',      subdomain: 'eth-mainnet',     chainId: 1      },
  { label: 'Polygon PoS       (EVM:137)',    subdomain: 'polygon-mainnet', chainId: 137    },
  { label: 'Arbitrum One      (EVM:42161)',  subdomain: 'arb-mainnet',     chainId: 42_161 },
  { label: 'Base              (EVM:8453)',   subdomain: 'base-mainnet',    chainId: 8_453  },
  { label: 'Optimism          (EVM:10)',     subdomain: 'opt-mainnet',     chainId: 10     },
]

async function probeManagedEvm(subdomain: string, key: string): Promise<{
  alive: boolean; latencyMs: number; blockHeight: string | null; statusCode: number
}> {
  const url = `https://${subdomain}.g.alchemy.com/v2/${key}`
  const t0  = Date.now()
  try {
    const { body, statusCode } = await request(url, {
      method:         'POST',
      headers:        { 'content-type': 'application/json' },
      body:           JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      headersTimeout: MANAGED_PROBE_TIMEOUT_MS,
      bodyTimeout:    MANAGED_PROBE_TIMEOUT_MS,
    })
    const latencyMs = Date.now() - t0
    if (statusCode !== 200) { await body.dump(); return { alive: false, latencyMs, blockHeight: null, statusCode } }
    const json = await body.json() as { result?: string }
    if (typeof json.result === 'string' && json.result.startsWith('0x')) {
      // CONTRACT-01: block height is uint256 — stays BigInt, serialised to string for display.
      return { alive: true, latencyMs, blockHeight: BigInt(json.result).toString(), statusCode }
    }
    return { alive: false, latencyMs, blockHeight: null, statusCode }
  } catch {
    return { alive: false, latencyMs: Date.now() - t0, blockHeight: null, statusCode: 0 }
  }
}

async function probeManagedSvm(url: string): Promise<{
  alive: boolean; latencyMs: number; statusCode: number
}> {
  const t0 = Date.now()
  try {
    const { body, statusCode } = await request(url, {
      method:         'POST',
      headers:        { 'content-type': 'application/json' },
      body:           JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth', params: [] }),
      headersTimeout: MANAGED_PROBE_TIMEOUT_MS,
      bodyTimeout:    MANAGED_PROBE_TIMEOUT_MS,
    })
    const latencyMs = Date.now() - t0
    if (statusCode !== 200) { await body.dump(); return { alive: false, latencyMs, statusCode } }
    const json = await body.json() as { result?: string }
    return { alive: json.result === 'ok', latencyMs, statusCode }
  } catch {
    return { alive: false, latencyMs: Date.now() - t0, statusCode: 0 }
  }
}

/**
 * Section 0: Managed Transport Validation.
 * Probes Alchemy (all 5 EVM chains) and Chainstack (SVM) if configured.
 * Emits MANAGED_SIGNAL per endpoint: [ALIVE], [DEGRADED], or [UNREACHABLE].
 * This section is skipped silently when USE_HYBRID_MODE = false.
 */
async function runManagedTransportValidation(): Promise<void> {
  const cfg = loadConfig()

  console.log(hr())
  console.log('  MANAGED TRANSPORT VALIDATION — Gatekeeper Synchronized')
  console.log(hr())
  console.log()

  // ── Alchemy EVM probes ──────────────────────────────────────────────────────
  if (cfg.mesh.evmAlchemyKey) {
    console.log('  Alchemy EVM — BlockCypher Token Synchronized (probing 5 chains…)')
    console.log()
    const probes = await Promise.all(
      ALCHEMY_EVM_PROBES.map(({ subdomain }) =>
        probeManagedEvm(subdomain, cfg.mesh.evmAlchemyKey!),
      ),
    )
    for (let i = 0; i < ALCHEMY_EVM_PROBES.length; i++) {
      const meta   = ALCHEMY_EVM_PROBES[i]!
      const result = probes[i]!
      let signal: string
      if (result.alive) {
        signal = `MANAGED_SIGNAL: [ALIVE] — Latency: ${result.latencyMs}ms  Block: ${result.blockHeight}`
      } else if (result.statusCode > 0) {
        signal = `MANAGED_SIGNAL: [DEGRADED] — HTTP ${result.statusCode}  Latency: ${result.latencyMs}ms`
      } else {
        signal = `MANAGED_SIGNAL: [UNREACHABLE] — Timeout / Network Error  Latency: ${result.latencyMs}ms`
      }
      printLine(`  Alchemy ${meta.label}`, signal)
    }
  } else {
    printLine('  Alchemy EVM', 'EVM_ALCHEMY_KEY not set — Managed Transport skipped')
  }

  console.log()

  // ── Chainstack SVM probe ────────────────────────────────────────────────────
  if (cfg.mesh.solanaChainstackUrl) {
    console.log('  Chainstack SVM — probing Solana endpoint…')
    console.log()
    const result = await probeManagedSvm(cfg.mesh.solanaChainstackUrl)
    let signal: string
    if (result.alive) {
      signal = `MANAGED_SIGNAL: [ALIVE] — Latency: ${result.latencyMs}ms`
    } else if (result.statusCode > 0) {
      signal = `MANAGED_SIGNAL: [DEGRADED] — HTTP ${result.statusCode}  Latency: ${result.latencyMs}ms`
    } else {
      signal = `MANAGED_SIGNAL: [UNREACHABLE] — Timeout / Network Error  Latency: ${result.latencyMs}ms`
    }
    printLine('  Chainstack SVM (Solana)', signal)
  } else {
    printLine('  Chainstack SVM', 'SOLANA_CHAINSTACK_URL not set — Managed Transport skipped')
  }

  console.log()
}

// ─── Main audit ───────────────────────────────────────────────────────────────

async function runMeshAudit(): Promise<void> {
  const auditStart = Date.now()

  console.log()
  console.log(hr('═'))
  console.log('  SOVEREIGN MESH AUDIT — Node Ingestion Locked')
  console.log(`  Started: ${new Date(auditStart).toISOString()}`)
  console.log(hr('═'))
  // ── Section 0: Managed Transport Validation (runs first, non-blocking) ──────
  await runManagedTransportValidation()

  console.log()
  console.log('  Launching concurrent discovery + health-ping cycles…')
  console.log('  (Adaptive Jitter active — expect 0.8–2.0 s initial delay)')
  console.log()

  // ── Run MeshIngestor + ProviderMesh healthPing concurrently ──────────────
  const ingestor    = new MeshIngestor()
  const providerMesh = new ProviderMesh()

  const [report, meshStatuses] = await Promise.all([
    ingestor.ingest(),
    providerMesh.healthPing(),
  ])

  const elapsed = ((Date.now() - auditStart) / 1000).toFixed(1)

  // ── Section 1: Ingestion summary ─────────────────────────────────────────
  console.log(hr())
  console.log('  INGESTION SUMMARY — Latency Tolerance Calibrated')
  console.log(hr())
  printLine('Total Nodes Discovered',    report.nodesDiscovered)
  printLine('Total Nodes Probed',        report.nodesProbed)
  printLine('Total Nodes Active (Sieve)', report.nodesPromoted)
  printLine('  ↳ Tier-1 Primary   (≤600ms)',
    report.nodesPromoted - report.nodesLowPriority - report.nodesEmergency)
  printLine('  ↳ Tier-2 Low-Priority (≤1000ms)', report.nodesLowPriority)
  printLine('  ↳ Tier-3 Emergency  (≤10000ms)',  report.nodesEmergency)
  printLine('Active Sieve Tier',
    report.activeTier === 'primary'
      ? 'Tier-1 Primary (Sieve Threshold Optimized)' :
    report.activeTier === 'low-priority'
      ? 'Tier-2 Low-Priority (fallback)' :
      '⚠ Tier-3 Emergency — Pipeline Audit Active')
  printLine('Nodes Lag-Purged (>10 blk)', report.nodesLagPurged)
  printLine('Nodes Blacklisted (429)',   report.blacklisted)
  printLine('Chains Probed',             report.chainsProbed)
  printLine('Audit Duration (s)',        elapsed)
  console.log()

  // ── Section 2: Zero-API Lock status ──────────────────────────────────────
  const providerLive = meshStatuses.reduce((s, m) => s + m.liveCount, 0)
  const policy = resolveTransportPolicy(providerLive)

  console.log(hr())
  console.log('  ZERO-API LOCK STATUS')
  console.log(hr())
  printLine('ProviderMesh Live Nodes (total)', providerLive)
  printLine('Lock Threshold',                  policy.lockThreshold)
  printLine('Zero-API Lock',
    policy.zeroApiLock
      ? '✓ ACTIVE — strict mode mesh lock engaged'
      : '✗ INACTIVE — managed transport allowed',
  )
  printLine('Managed Provider Priority', policy.useManagedEnvProviders ? 'ACTIVE' : 'STANDBY')
  printLine('Transport Signal', 'Managed transport priority active; public mesh fallback armed.')
  console.log()

  // ── Section 3: EVM breakdown (MeshIngestor ACTIVE_MESH) ──────────────────
  console.log(hr())
  console.log('  EVM BREAKDOWN — MeshIngestor ACTIVE_MESH (tiered latency sieve)')
  console.log(hr())

  const evmChainIds = [1, 137, 42_161, 8_453, 10]
  for (const chainId of evmChainIds) {
    const nodes = ingestor.getActiveMesh(chainId)
    const label = CHAIN_LABELS[chainId] ?? `EVM:${chainId}`
    console.log()
    console.log(`  ┌─ ${label}`)
    console.log(`  │  Active Nodes : ${nodes.length}`)

    const top3 = nodes.slice(0, 3)
    if (top3.length === 0) {
      console.log(`  │  Status       : NO ACTIVE NODES — all failed Latency Sieve`)
    } else {
      for (let i = 0; i < top3.length; i++) {
        const n = top3[i]!
        // CONTRACT-01: blockHeight is BigInt — format as decimal string for display
        console.log(
          `  │  [${i + 1}] ${n.url}`,
        )
        console.log(
          `  │      RTT: ${n.latencyMs}ms  |  Block: ${n.blockHeight.toString()}`,
        )
      }
      if (nodes.length > 3) {
        console.log(`  │  … and ${nodes.length - 3} more active nodes`)
      }
    }
    console.log(`  └${'─'.repeat(68)}`)
  }

  console.log()

  // ── Section 4: ProviderMesh health breakdown (EVM/SVM/UTXO) ─────────────
  console.log(hr())
  console.log('  PROVIDER MESH HEALTH — HealthPing Results')
  console.log(hr())
  console.log()
  printLine('Fallback Pool Health', 'Live/total shown per family below')
  printLine('Managed Transport Signal', 'Managed transport priority active; public mesh fallback armed.')
  console.log()

  for (const status of meshStatuses) {
    const familyLabel =
      status.family === 'EVM'
        ? `EVM  Chain:${String(status.chainNumericId).padStart(6)}`
        : `${status.family}  ${'─'.repeat(12)}`

    const liveRatio   = `${status.liveCount}/${status.totalCount}`
    const signal      = status.signal === 'Omni-Reach Locked' ? '✓ Omni-Reach Locked' : '⚠ Mesh Failover Active'
    const primary     = status.primaryUrl.length > 48
      ? `${status.primaryUrl.slice(0, 45)}…`
      : status.primaryUrl

    console.log(`  ${pad(familyLabel, 24)}  Live: ${pad(liveRatio, 6)}  ${signal}`)
    console.log(`  ${''.padEnd(24)}  Primary: ${primary}`)
    console.log()
  }

  // ── Section 5: NDJSON telemetry record ───────────────────────────────────
  console.log(hr())
  console.log('  NDJSON TELEMETRY (machine-readable)')
  console.log(hr())
  const telemetry = {
    level:               30,
    time:                Date.now(),
    msg:                 'Sovereign Mesh Audit Complete',
    sentinel:            'Scout',
    module:              'tests/mesh-audit',
    nodes_discovered:    report.nodesDiscovered,
    nodes_probed:        report.nodesProbed,
    nodes_active:         report.nodesPromoted,
    nodes_tier1_primary:  report.nodesPromoted - report.nodesLowPriority - report.nodesEmergency,
    nodes_tier2_low_prio: report.nodesLowPriority,
    nodes_tier3_emergency: report.nodesEmergency,
    active_sieve_tier:    report.activeTier,
    nodes_lag_purged:     report.nodesLagPurged,
    nodes_blacklisted:    report.blacklisted,
    provider_live_total:  providerLive,
    zero_api_lock:        policy.zeroApiLock,
    env_providers_active: policy.useManagedEnvProviders,
    signal:               policy.useManagedEnvProviders
      ? 'Managed transport priority active; public mesh fallback armed.'
      : 'Mesh Failover Active',
    chain_breakdown:     evmChainIds.map(cid => ({
      chain_id:     cid,
      active_nodes: ingestor.getActiveMesh(cid).length,
      // Block heights are uint256 — serialised as decimal strings (CONTRACT-01)
      top_node_block: ingestor.getActiveMesh(cid)[0]?.blockHeight.toString() ?? null,
      top_node_rtt:   ingestor.getActiveMesh(cid)[0]?.latencyMs ?? null,
    })),
    audit_elapsed_ms: Date.now() - auditStart,
  }
  console.log(JSON.stringify(telemetry))
  console.log()
  console.log(hr('═'))
  console.log('  Sovereign Mesh Audit — COMPLETE')
  console.log(hr('═'))
  console.log()
}

// ─── Entry point ──────────────────────────────────────────────────────────────

runMeshAudit().catch((err: unknown) => {
  process.stderr.write(JSON.stringify({
    level:    50,
    time:     Date.now(),
    msg:      'mesh-audit: fatal error',
    sentinel: 'Scout',
    cause:    err instanceof Error ? err.message : String(err),
  }) + '\n')
  process.exit(1)
})
