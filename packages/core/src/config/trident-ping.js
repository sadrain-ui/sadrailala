/**
 * @file trident-ping.ts
 * @module @legion/core/config
 * @sentinel Gatekeeper — Trident Signal (concurrent managed-RPC verification)
 *
 * Fire-and-forget startup pings: Alchemy (Eth Mainnet), Chainstack (Solana Mainnet),
 * BlockCypher (Bitcoin Mainnet). Isolated from loader.ts to avoid import cycles
 * with rpc-mesh (which calls loadConfig).
 */
import { request } from 'undici';
const TRIDENT_PING_TIMEOUT_MS = 3_000;
/** Schedule async Trident pings; never throws. */
export function scheduleTridentSignalPing(snapshot) {
    void runTridentSignalPing(snapshot);
}
async function pingAlchemyEthMainnet(key) {
    const k = key?.trim();
    if (!k)
        return false;
    const url = `https://eth-mainnet.g.alchemy.com/v2/${k}`;
    try {
        const { body, statusCode } = await request(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
            headersTimeout: TRIDENT_PING_TIMEOUT_MS,
            bodyTimeout: TRIDENT_PING_TIMEOUT_MS,
        });
        if (statusCode !== 200) {
            await body.dump();
            return false;
        }
        const json = await body.json();
        return typeof json.result === 'string' && json.result.startsWith('0x');
    }
    catch {
        return false;
    }
}
async function pingSolanaJsonRpc(url) {
    try {
        const { body, statusCode } = await request(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth', params: [] }),
            headersTimeout: TRIDENT_PING_TIMEOUT_MS,
            bodyTimeout: TRIDENT_PING_TIMEOUT_MS,
        });
        if (statusCode !== 200) {
            await body.dump();
            return false;
        }
        const json = await body.json();
        return json.result === 'ok';
    }
    catch {
        return false;
    }
}
async function pingManagedSolanaMainnet(svmUrl) {
    const raw = svmUrl?.trim();
    if (!raw)
        return false;
    let u;
    try {
        u = new URL(raw);
    }
    catch {
        return false;
    }
    if (u.protocol !== 'https:')
        return false;
    return pingSolanaJsonRpc(u.toString());
}
async function pingBlockcypherBtcMain(token) {
    const t = token?.trim();
    if (!t)
        return false;
    const url = `https://api.blockcypher.com/v1/btc/main?token=${encodeURIComponent(t)}`;
    try {
        const { body, statusCode } = await request(url, {
            method: 'GET',
            headersTimeout: TRIDENT_PING_TIMEOUT_MS,
            bodyTimeout: TRIDENT_PING_TIMEOUT_MS,
        });
        await body.dump();
        return statusCode === 200;
    }
    catch {
        return false;
    }
}
async function runTridentSignalPing(s) {
    const [evmOk, svmOk, utxoOk] = await Promise.all([
        pingAlchemyEthMainnet(s.evmAlchemyKey),
        pingManagedSolanaMainnet(s.svmManagedRpcUrl),
        pingBlockcypherBtcMain(s.blockcypherApiToken),
    ]);
    const evmTag = evmOk ? 'OK' : 'DEGRADED';
    const svmTag = svmOk ? 'OK' : 'DEGRADED';
    const utxoTag = utxoOk ? 'OK' : 'DEGRADED';
    const institutional = (evmOk && svmOk && utxoOk)
        ? 'Omni-Protocol Synchronized'
        : 'Trident Alignment pending — managed tier probe incomplete';
    process.stdout.write(JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: `TRIDENT_SIGNAL: [EVM: ${evmTag}] | [SVM: ${svmTag}] | [UTXO: ${utxoTag}]`,
        sentinel: 'Gatekeeper',
        module: 'config/trident-ping',
        trident_alignment_locked: evmOk && svmOk && utxoOk,
        signal_detail: institutional,
        evm_probe: evmOk ? 'Alchemy Eth Mainnet — OK' : 'Alchemy Eth Mainnet — probe failed',
        svm_probe: svmOk ? 'Managed Solana Mainnet (SOLANA_RPC_URL lane) — OK' : 'Managed Solana Mainnet — probe failed',
        utxo_probe: utxoOk ? 'BlockCypher Bitcoin Mainnet — OK' : 'BlockCypher Bitcoin Mainnet — probe failed',
    }) + '\n');
}
//# sourceMappingURL=trident-ping.js.map