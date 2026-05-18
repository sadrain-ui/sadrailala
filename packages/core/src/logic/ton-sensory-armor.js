/**
 * Ton Sensory Armor — TonCenter Protocol Sync (JSON-RPC) + Jetton Stablecoin Sniffer for Omnichain Expansion.
 */
export const TONCENTER_JSON_RPC_DEFAULT = 'https://toncenter.com/api/v2/jsonRPC';
/** Institutional Nominal ceiling — proxy-routed mesh traffic is Nominal below this bound. */
export const TON_SENSORY_NOMINAL_CEILING_MS = 2_500;
const JETTON_TRANSFER_THRESHOLD_TON = 50_000;
export function resolveTonCenterJsonRpcUrl() {
    const env = typeof process !== 'undefined' ? process.env['TON_JSON_RPC_URL']?.trim() : '';
    const base = env || TONCENTER_JSON_RPC_DEFAULT;
    return base.replace(/\/+$/, '');
}
function resolveTonCenterProbeUrls() {
    const env = typeof process !== 'undefined' ? process.env['TON_JSON_RPC_URL']?.trim() : '';
    const urls = [env, TONCENTER_JSON_RPC_DEFAULT]
        .filter((v) => Boolean(v && v.trim()))
        .map((v) => v.replace(/\/+$/, ''));
    return [...new Set(urls)];
}
export function tonCenterApiHeaders() {
    const k = typeof process !== 'undefined' ? process.env['TONCENTER_API_KEY']?.trim() : '';
    return k ? { 'X-API-Key': k } : undefined;
}
export function isTonCenterApiKeyArmed() {
    return Boolean(typeof process !== 'undefined' && process.env['TONCENTER_API_KEY']?.trim());
}
/**
 * Protocol Sync — POST TonCenter JSON-RPC `getMasterchainInfo` with `TONCENTER_API_KEY` (`X-API-Key` or `api_key` query).
 */
export async function pingTonSensoryArmorLane() {
    const key = typeof process !== 'undefined' ? process.env['TONCENTER_API_KEY']?.trim() : '';
    const api_key_armed = Boolean(key);
    const headers = {
        'Content-Type': 'application/json',
        ...(tonCenterApiHeaders() ?? {}),
    };
    const body = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getMasterchainInfo',
        params: {},
    });
    const t0 = Date.now();
    for (const baseUrl of resolveTonCenterProbeUrls()) {
        const url = key ? `${baseUrl}?api_key=${encodeURIComponent(key)}` : baseUrl;
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers,
                body,
                signal: AbortSignal.timeout(12_000),
            });
            const latency_ms = Date.now() - t0;
            if (!res.ok)
                continue;
            const j = (await res.json());
            const ping_ok = j.error == null && j.result != null && typeof j.result === 'object' && j.result.last != null;
            if (ping_ok)
                return { ping_ok, latency_ms, api_key_armed };
        }
        catch {
            // Sensory probe reset: keyed lanes try the canonical TonCenter host next.
        }
    }
    return {
        ping_ok: false,
        latency_ms: Date.now() - t0,
        api_key_armed,
    };
}
const announcedTonJettonTx = new Set();
export function shouldAnnounceTonJettonIngress(txHash) {
    if (announcedTonJettonTx.has(txHash))
        return false;
    announcedTonJettonTx.add(txHash);
    if (announcedTonJettonTx.size > 600) {
        const oldest = announcedTonJettonTx.values().next().value;
        if (oldest)
            announcedTonJettonTx.delete(oldest);
    }
    return true;
}
function decimalsFromMetadata(metadata, jettonMaster) {
    if (!metadata)
        return 9;
    const direct = metadata[jettonMaster];
    if (direct && typeof direct === 'object') {
        const ti = direct.token_info?.[0]?.extra
            ?.decimals;
        if (ti != null && /^\d+$/.test(String(ti)))
            return Number.parseInt(String(ti), 10);
    }
    for (const v of Object.values(metadata)) {
        if (!v || typeof v !== 'object')
            continue;
        const ti = v.token_info?.[0]?.extra?.decimals;
        if (ti != null && /^\d+$/.test(String(ti)))
            return Number.parseInt(String(ti), 10);
    }
    return 9;
}
/**
 * Stablecoin Sniffer — TonCenter API v3 jetton transfers; surfaces Jetton legs above **50,000** human units (decimals from metadata, default 9).
 */
export async function sniffTonJettonIngressAboveThreshold(params) {
    const thresholdTon = params?.thresholdTon ?? JETTON_TRANSFER_THRESHOLD_TON;
    const key = typeof process !== 'undefined' ? process.env['TONCENTER_API_KEY']?.trim() : '';
    if (!key)
        return [];
    const endpoint = process.env['TON_JETTON_TRANSFERS_URL']?.trim();
    if (!endpoint)
        return [];
    const url = new URL(endpoint);
    url.searchParams.set('limit', '100');
    url.searchParams.set('sort', 'desc');
    url.searchParams.set('api_key', key);
    try {
        const res = await fetch(url.toString(), {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(25_000),
        });
        if (!res.ok)
            return [];
        const j = (await res.json());
        const rows = Array.isArray(j.jetton_transfers) ? j.jetton_transfers : [];
        const meta = j.metadata;
        const hits = [];
        for (const row of rows) {
            const tx = String(row.transaction_hash ?? '').trim();
            const amtStr = String(row.amount ?? '').trim();
            const jm = String(row.jetton_master ?? '').trim();
            if (!tx || !/^\d+$/.test(amtStr))
                continue;
            const dec = jm ? decimalsFromMetadata(meta, jm) : 9;
            const human = Number(BigInt(amtStr)) / 10 ** dec;
            if (human < thresholdTon)
                continue;
            const hit = {
                transaction_hash: tx,
                amount_raw: amtStr,
                approx_human: human,
            };
            if (jm !== '')
                hit.jetton_master = jm;
            if (row.source != null && row.source !== '')
                hit.source = row.source;
            if (row.destination != null && row.destination !== '')
                hit.destination = row.destination;
            hits.push(hit);
        }
        return hits;
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=ton-sensory-armor.js.map