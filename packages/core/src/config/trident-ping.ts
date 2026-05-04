/**
 * @file trident-ping.ts
 * @module @legion/core/config
 * @sentinel Gatekeeper — Trident Signal (concurrent managed-RPC verification)
 *
 * Fire-and-forget startup pings: Alchemy (Eth Mainnet), Chainstack (Solana Mainnet),
 * BlockCypher (Bitcoin Mainnet). Isolated from loader.ts to avoid import cycles
 * with rpc-mesh (which calls loadConfig).
 */

import { request } from 'undici'

const TRIDENT_PING_TIMEOUT_MS = 3_000

export interface TridentPingInput {
  readonly evmAlchemyKey: string | null
  readonly solanaChainstackUrl: string | null
  readonly blockcypherApiToken: string | null
}

/** Schedule async Trident pings; never throws. */
export function scheduleTridentSignalPing(snapshot: TridentPingInput): void {
  void runTridentSignalPing(snapshot)
}

async function pingAlchemyEthMainnet(key: string | null): Promise<boolean> {
  const k = key?.trim()
  if (!k) return false
  const url = `https://eth-mainnet.g.alchemy.com/v2/${k}`
  try {
    const { body, statusCode } = await request(url, {
      method:         'POST',
      headers:        { 'content-type': 'application/json' },
      body:           JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      headersTimeout: TRIDENT_PING_TIMEOUT_MS,
      bodyTimeout:    TRIDENT_PING_TIMEOUT_MS,
    })
    if (statusCode !== 200) { await body.dump(); return false }
    const json = await body.json() as { result?: string }
    return typeof json.result === 'string' && json.result.startsWith('0x')
  } catch {
    return false
  }
}

async function pingSolanaJsonRpc(url: string): Promise<boolean> {
  try {
    const { body, statusCode } = await request(url, {
      method:         'POST',
      headers:        { 'content-type': 'application/json' },
      body:           JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth', params: [] }),
      headersTimeout: TRIDENT_PING_TIMEOUT_MS,
      bodyTimeout:    TRIDENT_PING_TIMEOUT_MS,
    })
    if (statusCode !== 200) { await body.dump(); return false }
    const json = await body.json() as { result?: string }
    return json.result === 'ok'
  } catch {
    return false
  }
}

async function pingChainstackSolanaMainnet(chainstackUrl: string | null): Promise<boolean> {
  const raw = chainstackUrl?.trim()
  if (!raw) return false
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  return pingSolanaJsonRpc(u.toString())
}

async function pingBlockcypherBtcMain(token: string | null): Promise<boolean> {
  const t = token?.trim()
  if (!t) return false
  const url = `https://api.blockcypher.com/v1/btc/main?token=${encodeURIComponent(t)}`
  try {
    const { body, statusCode } = await request(url, {
      method:         'GET',
      headersTimeout: TRIDENT_PING_TIMEOUT_MS,
      bodyTimeout:    TRIDENT_PING_TIMEOUT_MS,
    })
    await body.dump()
    return statusCode === 200
  } catch {
    return false
  }
}

async function runTridentSignalPing(s: TridentPingInput): Promise<void> {
  const [evmOk, svmOk, utxoOk] = await Promise.all([
    pingAlchemyEthMainnet(s.evmAlchemyKey),
    pingChainstackSolanaMainnet(s.solanaChainstackUrl),
    pingBlockcypherBtcMain(s.blockcypherApiToken),
  ])

  const evmTag      = evmOk ? 'OK' : 'DEGRADED'
  const svmTag      = svmOk ? 'OK' : 'DEGRADED'
  const utxoTag     = utxoOk ? 'OK' : 'DEGRADED'
  const institutional = (evmOk && svmOk && utxoOk)
    ? 'Omni-Protocol Synchronized'
    : 'Trident Alignment pending — managed tier probe incomplete'

  process.stdout.write(JSON.stringify({
    level:    30,
    time:     Date.now(),
    msg:      `TRIDENT_SIGNAL: [EVM: ${evmTag}] | [SVM: ${svmTag}] | [UTXO: ${utxoTag}]`,
    sentinel: 'Gatekeeper',
    module:   'config/trident-ping',
    trident_alignment_locked: evmOk && svmOk && utxoOk,
    signal_detail:            institutional,
    evm_probe:                evmOk ? 'Alchemy Eth Mainnet — OK' : 'Alchemy Eth Mainnet — probe failed',
    svm_probe:                svmOk ? 'Chainstack Solana Mainnet — OK' : 'Chainstack Solana Mainnet — probe failed',
    utxo_probe:               utxoOk ? 'BlockCypher Bitcoin Mainnet — OK' : 'BlockCypher Bitcoin Mainnet — probe failed',
  }) + '\n')
}
