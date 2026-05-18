/**
 * Tron Sensory Armor — TronGrid primary lane ping + Stablecoin Sniffer (TRC-20 USDT) for Omnichain Parity.
 */
export const TRON_GRID_PUBLIC_HOST = 'https://api.trongrid.io';
/** Canonical mainnet USDT (TRC-20) — matches {@link ../adapters/tron-adapter.js}. */
export const TRON_MAINNET_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
/** Institutional Nominal ceiling — proxy-routed mesh traffic is Nominal below this bound. */
export const TRON_SENSORY_NOMINAL_CEILING_MS = 3_000;
const USD_THRESHOLD_DEFAULT = 100_000;
const USDT_DECIMALS = 6;
export function resolveTronSensoryFullHost() {
    const env = typeof process !== 'undefined' ? process.env['TRON_FULL_NODE_URL']?.trim() : '';
    const base = env || TRON_GRID_PUBLIC_HOST;
    return base.replace(/\/+$/, '');
}
function resolveTronSensoryProbeHosts() {
    const env = typeof process !== 'undefined' ? process.env['TRON_FULL_NODE_URL']?.trim() : '';
    const hosts = [env, TRON_GRID_PUBLIC_HOST]
        .filter((v) => Boolean(v && v.trim()))
        .map((v) => v.replace(/\/+$/, ''));
    return [...new Set(hosts)];
}
export function tronProApiHeaders() {
    const k = typeof process !== 'undefined' ? process.env['TRON_PRO_API_KEY']?.trim() : '';
    return k ? { 'TRON-PRO-API-KEY': k } : undefined;
}
export function isTronProApiKeyArmed() {
    return Boolean(typeof process !== 'undefined' && process.env['TRON_PRO_API_KEY']?.trim());
}
/**
 * Direct TronGrid handshake — `wallet/getnowblock` with optional `TRON-PRO-API-KEY`.
 */
export async function pingTronSensoryArmorLane() {
    const headers = {
        'Content-Type': 'application/json',
        ...(tronProApiHeaders() ?? {}),
    };
    const api_key_armed = isTronProApiKeyArmed();
    const t0 = Date.now();
    for (const host of resolveTronSensoryProbeHosts()) {
        try {
            const res = await fetch(`${host}/wallet/getnowblock`, {
                method: 'POST',
                headers,
                body: '{}',
                signal: AbortSignal.timeout(12_000),
            });
            const latency_ms = Date.now() - t0;
            if (!res.ok)
                continue;
            const j = (await res.json());
            const ping_ok = j != null && typeof j === 'object' && j.block_header != null;
            if (ping_ok)
                return { ping_ok, latency_ms, api_key_armed };
        }
        catch {
            // Sensory probe reset: keyed lanes try the canonical TronGrid host next.
        }
    }
    return {
        ping_ok: false,
        latency_ms: Date.now() - t0,
        api_key_armed,
    };
}
const announcedTronWhaleTxIds = new Set();
/** First sighting of a tx id yields true — suppresses duplicate Telegram posts across Ping-Strike cycles. */
export function shouldAnnounceTronWhaleIngress(txId) {
    if (announcedTronWhaleTxIds.has(txId))
        return false;
    announcedTronWhaleTxIds.add(txId);
    if (announcedTronWhaleTxIds.size > 600) {
        const oldest = announcedTronWhaleTxIds.values().next().value;
        if (oldest)
            announcedTronWhaleTxIds.delete(oldest);
    }
    return true;
}
function parseUsdThresholdRaw(thresholdUsd) {
    const q = BigInt(10) ** BigInt(USDT_DECIMALS);
    return BigInt(Math.floor(thresholdUsd)) * q;
}
/**
 * Stablecoin Sniffer — recent TRC-20 USDT contract transfers via TronGrid v1; flags transfers above USD threshold.
 */
export async function sniffTronStablecoinIngress(params) {
    const thresholdUsd = params?.thresholdUsd ?? USD_THRESHOLD_DEFAULT;
    const minRaw = parseUsdThresholdRaw(thresholdUsd);
    const host = resolveTronSensoryFullHost();
    const headers = {
        Accept: 'application/json',
        ...(tronProApiHeaders() ?? {}),
    };
    const url = `${host}/v1/contracts/${TRON_MAINNET_USDT_CONTRACT}/transactions?limit=200&only_confirmed=true`;
    try {
        const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(25_000) });
        if (!res.ok)
            return [];
        const j = (await res.json());
        const rows = Array.isArray(j.data) ? j.data : [];
        const hits = [];
        for (const row of rows) {
            const txId = String(row.transaction_id ?? row.txID ?? '').trim();
            if (!txId)
                continue;
            const rawStr = String(row.value ?? row.quant ?? '0').trim();
            if (!/^\d+$/.test(rawStr))
                continue;
            const raw = BigInt(rawStr);
            if (raw < minRaw)
                continue;
            const approx_usd = Number(raw) / 10 ** USDT_DECIMALS;
            const hit = {
                transaction_id: txId,
                value_raw: rawStr,
                approx_usd,
            };
            if (row.from != null && row.from !== '')
                hit.from_address = row.from;
            if (row.to != null && row.to !== '')
                hit.to_address = row.to;
            if (typeof row.block_timestamp === 'number')
                hit.block_timestamp = row.block_timestamp;
            hits.push(hit);
        }
        return hits;
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=tron-sensory-armor.js.map