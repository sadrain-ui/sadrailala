/**
 * @file utxo-adapter.ts
 * @module @legion/core/adapters
 * @sentinel Scout/Closer (UTXO shard)
 *
 * Bitcoin Core RPC adapter for the UTXO chain family.
 * Implements the full BaseChainAdapter interface for native BTC (Legacy + SegWit).
 *
 * Architecture (bitcoin.md §9 Adapter Relevance):
 *  - Scout    → discoverAssets() via scantxoutset, getBalance() for UTXO sum
 *  - Closer   → getTransferData() for scriptPubKey construction
 *  - Dispatcher → estimateExecutionGas() for vsize preflight (sat/vB model)
 *
 * RPC transport (MASTER-RULES §anti-patterns):
 *  Uses undici.Pool for persistent HTTP/1.1 connection reuse — NOT axios or fetch.
 *  The Pool is created once at construction and held for the adapter's lifetime.
 *
 * Numeric invariant (drizzle.md §numeric(78,0)):
 *  All amounts are satoshis as Uint256 strings. btcToSats() converts Bitcoin
 *  Core's floating-point BTC values to exact integer satoshis via string math,
 *  never Number() → silent precision loss.
 *
 * UTXO model invariants (bitcoin.md §Cursor Guardrails):
 *  - No nonce, no chainId replay protection, no per-op gas.
 *  - Fee model: single-dimension sat/vByte market.
 *  - PSBT is the only signing artifact; adapters don't build raw transactions.
 *  - Finality is confirmation-depth based; "settled" is live property of active chain.
 *
 * Supported address formats (bitcoin.md §5):
 *  P2PKH  — Legacy (1...)          scriptPubKey: 76a914{hash160}88ac
 *  P2SH   — Script-hash (3...)     scriptPubKey: a914{hash160}87
 *  P2WPKH — SegWit v0 (bc1q...)    scriptPubKey: 0014{20-byte-program}
 *  P2WSH  — SegWit v0 (bc1q...)    scriptPubKey: 0020{32-byte-program}
 *  P2TR   — Taproot (bc1p...)      scriptPubKey: 5120{32-byte-program}
 */
import { Pool, request } from 'undici';
import { bech32, bech32m, base58 } from '@scure/base';
import { BaseChainAdapter } from './base-adapter';
import { GatekeeperError } from './address-resolver';
import { fetchBtcBalanceFromMesh } from '../scout/rpc-mesh';
const INPUT_VSIZE = {
    'p2pkh': 148, // Legacy — no witness discount
    'p2wpkh': 68, // Native SegWit v0, 20-byte program
    'p2sh-p2wpkh': 91, // Wrapped SegWit
    'p2wsh': 104, // SegWit v0 script-hash (2-of-3 multisig estimate)
    'p2tr': 58, // Taproot key-path (57.5 vB, ceil to 58)
};
const OUTPUT_VSIZE = {
    'p2pkh': 34,
    'p2wpkh': 31,
    'p2wsh': 43,
    'p2tr': 43,
};
const TX_OVERHEAD_VSIZE = 11; // 10.5 vB with SegWit marker/flag, ceiled
// ─── Numeric helpers ──────────────────────────────────────────────────────────
/**
 * Converts a Bitcoin Core floating-point BTC value to exact satoshis (BigInt).
 * Uses toFixed(8) string parsing to avoid IEEE 754 precision loss.
 * bitcoin.md §Cursor Guardrails: "All sat amounts are integers. Float BTC is display-only."
 */
function btcToSats(btc) {
    const [intPart = '0', fracPart = ''] = btc.toFixed(8).split('.');
    const padded = fracPart.padEnd(8, '0').slice(0, 8);
    return BigInt(intPart) * 100000000n + BigInt(padded);
}
// ─── Address → scriptPubKey ───────────────────────────────────────────────────
// Derives the hex-encoded locking script for a Bitcoin address.
// Supports P2PKH (1...), P2SH (3...), P2WPKH (bc1q, 20-byte), P2WSH (bc1q, 32-byte),
// and P2TR (bc1p, 32-byte). Does NOT verify the base58check sum — the Gatekeeper
// has already validated the address format before it reaches the adapter.
//
// bitcoin.md §5: mixing encoding forms is a known source of "lost" funds.
// Each branch is explicit about the expected byte layout.
function addressToScriptPubKey(address) {
    const lower = address.toLowerCase();
    if (lower.startsWith('bc1') || lower.startsWith('tb1')) {
        // SegWit (Bech32 v0) or Taproot (Bech32m v1)
        // Try Bech32 first (witness v0: P2WPKH / P2WSH), then Bech32m (v1: P2TR).
        let words;
        let isV0 = true;
        try {
            words = bech32.decode(lower).words;
        }
        catch {
            try {
                words = bech32m.decode(lower).words;
                isV0 = false;
            }
            catch {
                throw new GatekeeperError(address);
            }
        }
        const witnessVersion = words[0]; // 0 for P2WPKH/P2WSH, 1 for P2TR
        const program = isV0
            ? bech32.fromWords(words.slice(1))
            : bech32m.fromWords(words.slice(1));
        const programHex = Buffer.from(program).toString('hex');
        if (witnessVersion === 0 && program.length === 20) {
            // P2WPKH: OP_0 PUSH20 <20-byte-hash>
            return '0014' + programHex;
        }
        if (witnessVersion === 0 && program.length === 32) {
            // P2WSH: OP_0 PUSH32 <32-byte-hash>
            return '0020' + programHex;
        }
        if (witnessVersion === 1 && program.length === 32) {
            // P2TR: OP_1 PUSH32 <32-byte-x-only-pubkey>
            return '5120' + programHex;
        }
        throw new GatekeeperError(address);
    }
    if (address.startsWith('1') || address.startsWith('m') || address.startsWith('n')) {
        // P2PKH: Base58-encoded [version(0x00), hash160(20), checksum(4)]
        // Extract hash160 at bytes [1, 21) — skip version byte and trailing checksum.
        const raw = base58.decode(address);
        if (raw.length < 21)
            throw new GatekeeperError(address);
        const hash160 = Buffer.from(raw.slice(1, 21)).toString('hex');
        // OP_DUP OP_HASH160 PUSH20 <hash160> OP_EQUALVERIFY OP_CHECKSIG
        return '76a914' + hash160 + '88ac';
    }
    if (address.startsWith('3') || address.startsWith('2')) {
        // P2SH: Base58-encoded [version(0x05), hash160(20), checksum(4)]
        const raw = base58.decode(address);
        if (raw.length < 21)
            throw new GatekeeperError(address);
        const hash160 = Buffer.from(raw.slice(1, 21)).toString('hex');
        // OP_HASH160 PUSH20 <hash160> OP_EQUAL
        return 'a914' + hash160 + '87';
    }
    throw new GatekeeperError(address);
}
// ─── UtxoAdapter ─────────────────────────────────────────────────────────────
export class UtxoAdapter extends BaseChainAdapter {
    chainId;
    pool;
    authHeader;
    /**
     * @param options.chainId  - CAIP-2 id, e.g. "utxo:mainnet". Must match chain_registry.id.
     * @param options.rpcUrl   - Bitcoin Core JSON-RPC URL supplied from deployment env.
     * @param options.rpcUser  - RPC user (bitcoind -rpcuser).
     * @param options.rpcPass  - RPC password (bitcoind -rpcpassword).
     */
    constructor(options) {
        super();
        this.chainId = options.chainId;
        // undici.Pool: persistent HTTP/1.1 keep-alive connection pool (MASTER-RULES §02-stealth).
        this.pool = new Pool(options.rpcUrl, { connections: 10, keepAliveMaxTimeout: 60_000 });
        this.authHeader = 'Basic ' + Buffer.from(`${options.rpcUser}:${options.rpcPass}`).toString('base64');
    }
    // ─── RPC ─────────────────────────────────────────────────────────────────
    async rpc(req) {
        const response = await this.pool.request({
            path: '/',
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: this.authHeader,
            },
            body: JSON.stringify({ jsonrpc: '1.0', id: Date.now(), ...req }),
        });
        const body = (await response.body.json());
        if (body.error) {
            throw new Error(`[Bitcoin RPC] ${body.error.code}: ${body.error.message}`);
        }
        return body.result;
    }
    // ─── getBalance ──────────────────────────────────────────────────────────
    /**
     * Returns the total confirmed UTXO balance of `address` in satoshis.
     *
     * Uses `scantxoutset("start", [{ desc: "addr(address)" }])` — the indexer-free,
     * Core-authoritative approach (bitcoin.md §6.1 §scantxoutset).
     *
     * Performance note: scantxoutset scans the full UTXO set. On a primed node
     * (~140M UTXOs in 2025) this takes 1–5 s. For real-time Scout hot-paths,
     * augment with an Esplora/Electrum indexer as per bitcoin.md §6.2.
     *
     * @param address - Bitcoin address (P2PKH / P2SH / P2WPKH / P2WSH / P2TR).
     * @returns Satoshi balance as Uint256 string. BigInt(result) at call site.
     */
    async getBalance(address) {
        const result = await this.rpc({
            method: 'scantxoutset',
            params: ['start', [{ desc: `addr(${address})` }]],
        });
        if (!result.success)
            return '0';
        return btcToSats(result.total_amount).toString();
    }
    // ─── getTransferData ─────────────────────────────────────────────────────
    /**
     * Returns the hex-encoded scriptPubKey locking script for `target`.
     *
     * The Closer embeds this as the `scriptPubKey` field in the PSBT output
     * (bitcoin.md §4 PSBT). The Creator/Updater roles supply the amount and
     * derive coin selection; the Closer finalizes and extracts the network tx.
     *
     * Supported target formats:
     *  P2PKH  (1...)    → 76a914{hash160}88ac
     *  P2SH   (3...)    → a914{hash160}87
     *  P2WPKH (bc1q...) → 0014{20-byte-program}
     *  P2WSH  (bc1q...) → 0020{32-byte-program}
     *  P2TR   (bc1p...) → 5120{32-byte-program}
     *
     * @param target - Destination Bitcoin address.
     * @param amount - Satoshi amount for this output as Uint256 string (informational;
     *                 not encoded into scriptPubKey — the Closer sets value in the PSBT).
     * @returns Hex-encoded scriptPubKey string (no 0x prefix).
     */
    getTransferData(target, amount) {
        // amount is part of the output spec, not the locking script itself.
        // Validate it can be parsed as a bigint (guards against injection).
        void BigInt(amount);
        return addressToScriptPubKey(target);
    }
    // ─── estimateExecutionGas ────────────────────────────────────────────────
    /**
     * Estimates transaction vsize in virtual bytes from input/output type breakdown.
     *
     * Formula (bitcoin.md §7.1):
     *   vsize = TX_OVERHEAD + Σ(input_vsize) + Σ(output_vsize)
     *
     * The Dispatcher multiplies this by the feerate (sat/vB) from `estimatesmartfee`
     * (clamped by mempoolminfee and operator max) to compute total fee in satoshis.
     *
     * @param params - UtxoEstimateParams: { inputs: InputType[], outputs: OutputType[] }
     * @returns vsize in virtual bytes as Uint256 string.
     */
    async estimateExecutionGas(params) {
        const p = params;
        const inputVsize = (p.inputs ?? []).reduce((acc, type) => acc + (INPUT_VSIZE[type] ?? INPUT_VSIZE['p2wpkh']), 0);
        const outputVsize = (p.outputs ?? []).reduce((acc, type) => acc + (OUTPUT_VSIZE[type] ?? OUTPUT_VSIZE['p2wpkh']), 0);
        const vsize = TX_OVERHEAD_VSIZE + inputVsize + outputVsize;
        return BigInt(vsize).toString();
    }
    // ─── discoverAssets ──────────────────────────────────────────────────────
    /**
     * Returns the native BTC balance for `address`.
     *
     * Bitcoin has no token system — all value is native BTC (satoshis). Unlike
     * EVM multicall or SVM getProgramAccounts, there is no token enumeration to do.
     * The single entry has assetAddress: null (native currency convention).
     *
     * Returns an empty array if the balance is zero (address has never received BTC
     * or all UTXOs have been spent).
     *
     * @param owner - Bitcoin address (any supported format).
     */
    async discoverAssets(owner) {
        // Case-Sensitivity Protocol Synchronized:
        // Preserve the owner string as provided for DB identity and conflict matching.
        const balance = await this.getBalance(owner);
        if (balance === '0')
            return [];
        return [
            {
                assetAddress: null,
                balance,
                symbol: 'BTC',
                decimals: 8,
            },
        ];
    }
}
// BlockCypher REST path segment per coin: {coin}/{network}
const BLOCKCYPHER_COIN_PATH = {
    btc: 'btc/main',
    ltc: 'ltc/main',
    doge: 'doge/main',
};
// Normalised asset metadata — all UTXO coins use 8 decimal places.
const BLOCKCYPHER_COIN_META = {
    btc: { symbol: 'BTC', decimals: 8 },
    ltc: { symbol: 'LTC', decimals: 8 },
    doge: { symbol: 'DOGE', decimals: 8 },
};
const BLOCKCYPHER_BASE_URL = process.env['BLOCKCYPHER_BASE_URL']?.trim() ?? '';
const BLOCKCYPHER_TIMEOUT_MS = 8_000;
// HTTP status codes that trigger Failover Protocol Locked.
const BLOCKCYPHER_FAILOVER_STATUSES = new Set([401, 429]);
// Public read-only fallback pool — intentionally minimal for predictable behavior.
// Used for BTC fallback when BlockCypher is unavailable or rate-limited.
const BTC_MESH_FALLBACKS = [
    'https://mempool.space/api',
];
export class BlockCypherClient {
    _token;
    /**
     * @param apiToken - BlockCypher API token from BLOCKCYPHER_API_TOKEN env var.
     *                   BlockCypher Token Synchronized.
     *                   GATEKEEPER-07: never log this value in plain text.
     */
    constructor(apiToken) {
        this._token = apiToken;
    }
    /**
     * Fetches the confirmed balance of `address` for `coin` from BlockCypher.
     *
     * CONTRACT-01: result is always BigInt (satoshis). No float arithmetic paths.
     *
     * Failover Protocol Locked:
     *   - HTTP 429 or 401 on BTC → auto-retries via fetchBtcBalanceFromMesh().
     *   - HTTP 429 or 401 on LTC/DOGE → returns 0n (no Esplora-compatible public mesh).
     *   - Network error / timeout → returns 0n.
     *
     * @param address - Chain-native address string.
     * @param coin    - Target coin ('btc' | 'ltc' | 'doge').
     */
    async fetchBalance(address, coin) {
        const coinPath = BLOCKCYPHER_COIN_PATH[coin];
        const encodedAddr = encodeURIComponent(address);
        const url = `${BLOCKCYPHER_BASE_URL}/${coinPath}/addrs/${encodedAddr}/balance?token=${this._token}`;
        try {
            const { body, statusCode } = await request(url, {
                method: 'GET',
                headersTimeout: BLOCKCYPHER_TIMEOUT_MS,
                bodyTimeout: BLOCKCYPHER_TIMEOUT_MS,
            });
            // ── Failover Protocol Locked: 429 rate-limit or 401 invalid token ───────
            if (BLOCKCYPHER_FAILOVER_STATUSES.has(statusCode)) {
                await body.dump();
                if (coin === 'btc') {
                    // BTC-only fallback: Esplora public mesh (mempool.space, blockstream, …).
                    return fetchBtcBalanceFromMesh(address, [...BTC_MESH_FALLBACKS]);
                }
                // LTC/DOGE: no Esplora-compatible public mesh — signal zero to caller.
                return 0n;
            }
            if (statusCode !== 200) {
                await body.dump();
                return 0n;
            }
            const json = await body.json();
            // CONTRACT-01: BlockCypher returns integer satoshis — direct BigInt cast,
            // no rounding, no float intermediate.
            const rawBalance = json.balance;
            if (typeof rawBalance !== 'number' || rawBalance < 0)
                return 0n;
            return BigInt(Math.trunc(rawBalance));
        }
        catch {
            // Network error / DNS failure / timeout — Failover Protocol Locked: BTC
            // attempts mesh; LTC/DOGE signal zero.
            if (coin === 'btc') {
                return fetchBtcBalanceFromMesh(address, [...BTC_MESH_FALLBACKS]);
            }
            return 0n;
        }
    }
    /**
     * Discovers the native balance for `address` on `coin`, normalised to the
     * standard DiscoveredAsset format (identical shape to EvmAdapter / SvmAdapter).
     *
     * Returns [] when balance is zero or on any unrecoverable error.
     *
     * @param address - Chain-native address string.
     * @param coin    - Target coin. BCH is NOT a valid BlockCypherCoin — callers
     *                  must route BCH through the Sovereign Mesh directly.
     */
    async discoverAssets(address, coin) {
        const balance = await this.fetchBalance(address, coin);
        if (balance === 0n)
            return [];
        const meta = BLOCKCYPHER_COIN_META[coin];
        return [
            {
                assetAddress: null,
                balance: balance.toString(), // CONTRACT-01: Uint256 string output
                symbol: meta.symbol,
                decimals: meta.decimals,
            },
        ];
    }
}
//# sourceMappingURL=utxo-adapter.js.map