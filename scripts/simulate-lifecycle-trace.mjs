#!/usr/bin/env node
/**
 * simulate-lifecycle-trace.mjs
 * Read-only architecture tracer — mock data only, no network, no repo mutations.
 *
 * Simulates: lure-ui ingress → Scout discovery → Dispatcher normalize → Closer gas matrix
 */

const DIVIDER = '─'.repeat(72)
const PHASE_RULE = '═'.repeat(72)

function section(title) {
  console.log(`\n${PHASE_RULE}`)
  console.log(`  ${title}`)
  console.log(PHASE_RULE)
}

function subsection(label) {
  console.log(`\n${DIVIDER}`)
  console.log(`  ${label}`)
  console.log(DIVIDER)
}

function printJson(label, obj) {
  console.log(`\n  [${label}]`)
  console.log(JSON.stringify(obj, null, 2).split('\n').map((l) => `    ${l}`).join('\n'))
}

function printTable(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)),
  )
  const line = (cells) =>
    '  │ ' + cells.map((c, i) => String(c).padEnd(widths[i])).join(' │ ') + ' │'
  console.log('  ┌' + widths.map((w) => '─'.repeat(w + 2)).join('┬') + '┐')
  console.log(line(headers))
  console.log('  ├' + widths.map((w) => '─'.repeat(w + 2)).join('┼') + '┤')
  for (const row of rows) console.log(line(row))
  console.log('  └' + widths.map((w) => '─'.repeat(w + 2)).join('┴') + '┘')
}

// ─── Phase 1: lure-ui mock connection payload ───────────────────────────────

section('PHASE 1 — LURE-UI CONNECTION PAYLOAD (MOCK)')

const connectionPayload = {
  source: '@legion/lure-ui',
  meshClient: 'lure',
  sessionId: 'sess_mock_7f3a9c2e-ingress-2026',
  wallet: {
    address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    chainNamespace: 'eip155',
    chainId: 1,
  },
  appKit: {
    projectId: 'mock_walletconnect_project_id',
    namespaces: ['eip155:1', 'solana:mainnet', 'tron:mainnet', 'ton:mainnet'],
  },
  handshake: {
    nonce: 'mock_siwe_nonce_a1b2c3d4',
    issuedAt: '2026-05-19T12:00:00.000Z',
    capabilities: ['permit2', 'eip712', 'svm_tx_sim_sign'],
  },
  ingress: {
    apiOrigin: 'https://legion-engine-api.mock.railway.app',
    corsOrigin: 'https://lure-ui.mock.vercel.app',
    vectorIngress: false,
  },
}

printJson('connectionPayload', connectionPayload)
console.log('\n  ✓ Phase 1 complete — ingress envelope accepted (simulated)')

// ─── Phase 2: Scout multi-chain balance discovery ─────────────────────────

section('PHASE 2 — SCOUT MULTI-CHAIN BALANCE DISCOVERY (MOCK)')

const scoutRegistry = {
  sentinel: 'Scout',
  module: '@legion/sentinels/scout',
  scannedAt: '2026-05-19T12:00:01.000Z',
  target: connectionPayload.wallet.address,
  chains: [
    { id: 'ethereum', family: 'evm', rpcLane: 'rpc_ethereum_primary', status: 'Active' },
    { id: 'solana', family: 'svm', rpcLane: 'rpc_solana_primary', status: 'Active' },
    { id: 'tron', family: 'tron', rpcLane: 'rpc_tron_primary', status: 'Active' },
    { id: 'ton', family: 'ton', rpcLane: 'rpc_ton_primary', status: 'Active' },
    { id: 'base', family: 'evm', rpcLane: 'rpc_evm_l2_mesh', status: 'Active' },
  ],
}

const discoveredBalances = [
  { chain: 'ethereum', asset: 'ETH', symbol: 'ETH', balanceRaw: '2500000000000000000', balanceUsd: 7500.0, protocol: null },
  { chain: 'ethereum', asset: 'USDC', symbol: 'USDC', balanceRaw: '12500000000', balanceUsd: 12500.0, protocol: 'erc20' },
  { chain: 'solana', asset: 'SOL', symbol: 'SOL', balanceRaw: '42000000000', balanceUsd: 5880.0, protocol: null },
  { chain: 'solana', asset: 'JitoSOL', symbol: 'JitoSOL', balanceRaw: '1500000000', balanceUsd: 3150.0, protocol: 'spl' },
  { chain: 'tron', asset: 'TRX', symbol: 'TRX', balanceRaw: '50000000000', balanceUsd: 1200.0, protocol: null },
  { chain: 'tron', asset: 'USDT', symbol: 'USDT', balanceRaw: '8000000000', balanceUsd: 8000.0, protocol: 'trc20' },
  { chain: 'ton', asset: 'TON', symbol: 'TON', balanceRaw: '1200000000000', balanceUsd: 6600.0, protocol: null },
  { chain: 'base', asset: 'ETH', symbol: 'ETH', balanceRaw: '800000000000000000', balanceUsd: 2400.0, protocol: null },
]

subsection('Scout registry (mock)')
printJson('scoutRegistry', scoutRegistry)

subsection('Discovered positions')
printTable(
  ['chain', 'asset', 'balanceUsd', 'protocol'],
  discoveredBalances.map((p) => [p.chain, p.asset, p.balanceUsd.toFixed(2), p.protocol ?? 'native']),
)

const totalUsd = discoveredBalances.reduce((s, p) => s + p.balanceUsd, 0)
const lethalityScore = Math.floor(totalUsd - 45.5) // mock gas estimate deduction
console.log(`\n  portfolioTotalUsd: ${totalUsd.toFixed(2)}`)
console.log(`  lethalityScore (mock): ${lethalityScore}`)
console.log('\n  ✓ Phase 2 complete — multi-chain telemetry synthesized (simulated)')

// ─── Phase 3: Dispatcher normalized candidates ────────────────────────────

section('PHASE 3 — DISPATCHER NORMALIZE (MOCK)')

const rawCandidates = [
  { laneId: 'lane_evm_usdc', chain: 'ethereum', asset: 'USDC', usd: 12500, priority: 2, meshEvent: 'Whale Alert' },
  { laneId: 'lane_tron_usdt', chain: 'tron', asset: 'USDT', usd: 8000, priority: 3, meshEvent: 'Whale Alert' },
  { laneId: 'lane_sol_jitosol', chain: 'solana', asset: 'JitoSOL', usd: 3150, priority: 4, meshEvent: 'Settlement' },
  { laneId: 'lane_ton_native', chain: 'ton', asset: 'TON', usd: 6600, priority: 5, meshEvent: 'Whale Alert' },
  { laneId: 'lane_base_eth', chain: 'base', asset: 'ETH', usd: 2400, priority: 6, meshEvent: 'Settlement' },
]

const normalizedDispatch = rawCandidates
  .map((c, idx) => ({
    candidateId: `dispatch_${String(idx + 1).padStart(3, '0')}`,
    laneId: c.laneId,
    chain: c.chain,
    asset: c.asset,
    extractionUsd: c.usd,
    priority: c.priority,
    meshHeader: { 'X-Legion-Mesh-Event': c.meshEvent },
    failover: { primary: 'nominal', backup: 'standby' },
    status: c.usd >= 5000 ? 'eligible' : 'deferred',
  }))
  .sort((a, b) => a.priority - b.priority)

subsection('Dispatcher log (normalized)')
for (const row of normalizedDispatch) {
  console.log(
    `  [DISPATCH] ${row.candidateId} | ${row.laneId} | ${row.chain}/${row.asset} | $${row.extractionUsd} | prio=${row.priority} | ${row.status} | mesh=${row.meshHeader['X-Legion-Mesh-Event']}`,
  )
}

printJson('normalizedDispatch', normalizedDispatch)
console.log(`\n  eligibleCount: ${normalizedDispatch.filter((d) => d.status === 'eligible').length}`)
console.log('\n  ✓ Phase 3 complete — dispatch candidates normalized (simulated)')

// ─── Phase 4: Closer gas optimization matrix ────────────────────────────────

section('PHASE 4 — CLOSER GAS OPTIMIZATION MATRIX (MOCK)')

const gasMatrix = normalizedDispatch
  .filter((d) => d.status === 'eligible')
  .map((d) => {
    const gasEstimateUsd =
      d.chain === 'ethereum' ? 12.5 : d.chain === 'tron' ? 3.2 : d.chain === 'solana' ? 0.8 : d.chain === 'ton' ? 1.1 : 0.6
    const netUsd = d.extractionUsd - gasEstimateUsd
    const closerPriority =
      netUsd >= 10000 ? 1 : netUsd >= 5000 ? 2 : netUsd >= 2000 ? 3 : 4
    return {
      candidateId: d.candidateId,
      chain: d.chain,
      asset: d.asset,
      grossUsd: d.extractionUsd,
      gasEstimateUsd,
      netUsd,
      closerPriority,
      bundleLane: d.chain === 'ethereum' ? 'flashbots_protect' : d.chain === 'solana' ? 'jito_block_engine' : 'public_rpc',
      sortKey: closerPriority * 10000 + netUsd,
    }
  })
  .sort((a, b) => a.closerPriority - b.closerPriority || b.netUsd - a.netUsd)

subsection('Gas matrix (Closer priority sort)')
printTable(
  ['prio', 'candidateId', 'chain', 'asset', 'gross$', 'gas$', 'net$', 'bundleLane'],
  gasMatrix.map((r) => [
    r.closerPriority,
    r.candidateId,
    r.chain,
    r.asset,
    r.grossUsd.toFixed(0),
    r.gasEstimateUsd.toFixed(1),
    r.netUsd.toFixed(0),
    r.bundleLane,
  ]),
)

const strikeOrder = gasMatrix.map((r, i) => ({ rank: i + 1, ...r }))
printJson('strikeOrder', strikeOrder)
console.log('\n  ✓ Phase 4 complete — closer matrix sorted (simulated)')

// ─── Final summary ───────────────────────────────────────────────────────────

section('LIFECYCLE SUMMARY (SIMULATED)')

const summary = {
  tracer: 'scripts/simulate-lifecycle-trace.mjs',
  mode: 'read-only-mock',
  phases: {
    phase1_lureUiConnection: { status: 'ok', sessionId: connectionPayload.sessionId },
    phase2_scoutDiscovery: {
      status: 'ok',
      chainsProbed: scoutRegistry.chains.length,
      positionsFound: discoveredBalances.length,
      portfolioUsd: totalUsd,
      lethalityScore,
    },
    phase3_dispatcher: {
      status: 'ok',
      candidatesTotal: normalizedDispatch.length,
      eligible: normalizedDispatch.filter((d) => d.status === 'eligible').length,
    },
    phase4_closer: {
      status: 'ok',
      strikeQueueDepth: strikeOrder.length,
      topStrike: strikeOrder[0]
        ? `${strikeOrder[0].chain}/${strikeOrder[0].asset} net=$${strikeOrder[0].netUsd}`
        : null,
    },
  },
  architectureWeld: [
    'lure-ui → handshake payload',
    '@legion/sentinels/scout → balance map',
    'dispatcher → normalized lanes',
    'closer → gas-sorted strike queue',
  ],
  verdict: 'LIFECYCLE_TRACE_COMPLETE',
}

printJson('summary', summary)

console.log('\n' + PHASE_RULE)
console.log('  SIMULATION COMPLETE — no files written, no network I/O')
console.log(PHASE_RULE + '\n')
