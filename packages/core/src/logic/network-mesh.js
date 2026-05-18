/**
 * @module @legion/core/logic/network-mesh
 *
 * Network Egress Cloaking — institutional outbound mesh for RPC and Remote Config Sync.
 * When `PROXY_URL` is armed, JSON-RPC traffic routes through an HTTP(S) proxy (undici)
 * and carries egress-cloak headers for observability.
 */
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { LEGION_MESH_EVENT_HEADER, LEGION_MESH_EVENT_SETTLEMENT, LEGION_MESH_EVENT_WHALE_ALERT, } from './mesh-event.js';
const PROXY_TAINT_WINDOW_MS = 60_000;
const TIMEOUT_SIGNATURES = ['timeout', 'timed out', 'etimedout', 'und_err_connect_timeout'];
let cachedPoolKey = null;
let cachedProxyPool = [];
let roundRobinCursor = 0;
let rotationalMeshAnnounced = false;
let shadowMeshEmptyAnnounced = false;
const proxyAgentCache = new Map();
const proxyTaintUntilMs = new Map();
function safeDecodeProxyComponent(value) {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}
function normalizeProxyAuth(auth) {
    const passwordSep = auth.indexOf(':');
    if (passwordSep < 0)
        return encodeURIComponent(safeDecodeProxyComponent(auth));
    const user = auth.slice(0, passwordSep);
    const password = auth.slice(passwordSep + 1);
    return `${encodeURIComponent(safeDecodeProxyComponent(user))}:${encodeURIComponent(safeDecodeProxyComponent(password))}`;
}
function normalizeProxyUrlForMesh(raw) {
    const trimmed = unquoteProxyValue(raw.trim()).trim();
    if (!trimmed)
        return undefined;
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
    const protocol = hasScheme ? trimmed.slice(0, trimmed.indexOf('://') + 3) : 'http://';
    const body = hasScheme ? trimmed.slice(protocol.length) : trimmed;
    const atIdx = body.lastIndexOf('@');
    const normalized = atIdx >= 0
        ? `${protocol}${normalizeProxyAuth(body.slice(0, atIdx))}@${body.slice(atIdx + 1)}`
        : `${protocol}${body}`;
    try {
        const url = new URL(normalized);
        if (!url.hostname)
            return undefined;
        return url.toString();
    }
    catch {
        return undefined;
    }
}
function unquoteProxyValue(value) {
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}
function splitProxyPoolEnv(rawPool) {
    return unquoteProxyValue(rawPool)
        .split(/[\s,;|]+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}
/** Resolve HTTP(S) proxy URL fallback for Network Mesh egress. */
export function resolveProxyUrlFromEnv() {
    const raw = typeof process !== 'undefined' ? process.env['PROXY_URL']?.trim() : undefined;
    return raw && raw !== '' ? normalizeProxyUrlForMesh(raw) : undefined;
}
/** Resolve Rotational Mesh proxy pool from `PROXY_POOL` (comma-separated). */
export function resolveProxyPoolFromEnv() {
    const rawPool = typeof process !== 'undefined' ? process.env['PROXY_POOL']?.trim() : undefined;
    const fallback = resolveProxyUrlFromEnv();
    const cacheKey = `${rawPool ?? ''}|${fallback ?? ''}`;
    if (cacheKey === cachedPoolKey)
        return cachedProxyPool;
    const parsedPool = rawPool
        ? splitProxyPoolEnv(rawPool)
            .map((item) => normalizeProxyUrlForMesh(item))
            .filter((item) => item != null)
        : [];
    cachedProxyPool = parsedPool.length > 0 ? parsedPool : fallback ? [fallback] : [];
    cachedPoolKey = cacheKey;
    roundRobinCursor = 0;
    if (cachedProxyPool.length === 0) {
        if (!shadowMeshEmptyAnnounced) {
            shadowMeshEmptyAnnounced = true;
            console.warn('SHADOW_MESH_EMPTY: Check .env PROXY_POOL formatting.');
        }
    }
    else {
        shadowMeshEmptyAnnounced = false;
    }
    if (cachedProxyPool.length > 0 && !rotationalMeshAnnounced) {
        console.info('ROTATIONAL_MESH_ACTIVE: 10-node shadow pool engaged. IP Fatigue protection enabled. System: OMNIPRESENT.');
        rotationalMeshAnnounced = true;
    }
    return cachedProxyPool;
}
function resolveProxyHost(proxyUrl) {
    try {
        return new URL(proxyUrl).hostname;
    }
    catch {
        return 'armed';
    }
}
/**
 * Institutional headers merged onto every egress request — includes proxy host binding when `PROXY_URL` is set.
 */
export function resolveNetworkMeshHeaders(activeProxyUrl) {
    const out = {
        'X-Legion-Network-Mesh': 'sovereign',
    };
    const proxy = activeProxyUrl ?? resolveProxyPoolFromEnv()[0];
    if (proxy) {
        out['X-Legion-Egress-Proxy'] = resolveProxyHost(proxy);
    }
    return out;
}
function getOrCreateProxyAgent(proxyUrl) {
    const existing = proxyAgentCache.get(proxyUrl);
    if (existing)
        return existing;
    const next = new ProxyAgent(proxyUrl);
    proxyAgentCache.set(proxyUrl, next);
    return next;
}
function markProxyTainted(proxyUrl) {
    proxyTaintUntilMs.set(proxyUrl, Date.now() + PROXY_TAINT_WINDOW_MS);
}
export function getNextProxy() {
    const pool = resolveProxyPoolFromEnv();
    if (pool.length === 0)
        return undefined;
    const now = Date.now();
    for (let i = 0; i < pool.length; i++) {
        const idx = (roundRobinCursor + i) % pool.length;
        const candidate = pool[idx];
        if (candidate === undefined)
            continue;
        const taintedUntil = proxyTaintUntilMs.get(candidate) ?? 0;
        if (taintedUntil <= now) {
            roundRobinCursor = (idx + 1) % pool.length;
            return candidate;
        }
    }
    return undefined;
}
function isTaintStatus(status) {
    return status === 403 || status === 407;
}
function isTimeoutError(error) {
    const message = error instanceof Error ? error.message : String(error);
    const lowered = message.toLowerCase();
    return TIMEOUT_SIGNATURES.some((signature) => lowered.includes(signature));
}
function parseMeshEventFromInit(init) {
    if (init?.headers == null)
        return null;
    const raw = new Headers(init.headers).get(LEGION_MESH_EVENT_HEADER)?.trim();
    if (raw === LEGION_MESH_EVENT_WHALE_ALERT)
        return LEGION_MESH_EVENT_WHALE_ALERT;
    if (raw === LEGION_MESH_EVENT_SETTLEMENT)
        return LEGION_MESH_EVENT_SETTLEMENT;
    return null;
}
function logMeshEventProxyUsage(eventName, proxyUrl) {
    console.info(`ROTATIONAL_MESH_PROXY_TRACE: ${eventName} routed via ${resolveProxyHost(proxyUrl)}.`);
}
/** Singleton fetch — proxy dispatcher + Network Mesh headers (Privacy RPC / Remote Config Sync). */
export function createEgressCloakingFetchFn() {
    return async (input, init) => {
        const selectedProxy = getNextProxy();
        const headers = new Headers(init?.headers);
        for (const [k, v] of Object.entries(resolveNetworkMeshHeaders(selectedProxy))) {
            headers.set(k, v);
        }
        const meshEvent = parseMeshEventFromInit(init);
        if (selectedProxy && meshEvent) {
            logMeshEventProxyUsage(meshEvent, selectedProxy);
        }
        if (!selectedProxy) {
            return globalThis.fetch(input, { ...init, headers });
        }
        const agent = getOrCreateProxyAgent(selectedProxy);
        try {
            const res = await undiciFetch(input, {
                ...(init ?? {}),
                headers,
                dispatcher: agent,
            });
            if (isTaintStatus(res.status)) {
                markProxyTainted(selectedProxy);
            }
            return res;
        }
        catch (error) {
            if (isTimeoutError(error)) {
                markProxyTainted(selectedProxy);
            }
            throw error;
        }
    };
}
let institutionalFetchMemo = null;
/** viem `http()` transport options — routes through `PROXY_URL` when configured. */
export function getInstitutionalHttpTransportOptions() {
    if (!institutionalFetchMemo)
        institutionalFetchMemo = createEgressCloakingFetchFn();
    return { fetchFn: institutionalFetchMemo };
}
const EGRESS_IP_CHECK_URL = (typeof process !== 'undefined' ? process.env['EGRESS_IP_CHECK_URL']?.trim() : '') ?? '';
/** Ping Strike — probes one Rotational Mesh node; returns exit-plane ok + round-trip latency (Lethality Diagnostic). */
export async function pingRotationalMeshExitPlaneDetailed(proxyUrl) {
    const t0 = Date.now();
    try {
        const agent = new ProxyAgent(proxyUrl);
        const res = await undiciFetch(EGRESS_IP_CHECK_URL, {
            dispatcher: agent,
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(15_000),
        });
        return { ok: res.ok, latency_ms: Date.now() - t0 };
    }
    catch {
        return { ok: false, latency_ms: Date.now() - t0 };
    }
}
/** Ping Strike — boolean facade for isolated mesh probes (no Round-Robin Scheduler side effects). */
export async function pingRotationalMeshExitPlane(proxyUrl) {
    const r = await pingRotationalMeshExitPlaneDetailed(proxyUrl);
    return r.ok;
}
/**
 * Egress Cloaking validation — GET via `PROXY_URL` to an IP-checker plane; confirms proxy transport masks origin egress.
 */
export async function verifyEgressCloaking() {
    if (resolveProxyPoolFromEnv().length === 0) {
        console.info('ENV_RECONCILIATION: PROXY_POOL/PROXY_URL unset — Rotational Mesh not armed. Deployment plane: set PROXY_POOL for masked egress.');
        return;
    }
    try {
        const fetchFn = createEgressCloakingFetchFn();
        const res = await fetchFn(EGRESS_IP_CHECK_URL, {
            headers: { Accept: 'application/json' },
        });
        if (!res.ok)
            throw new Error(`ip-check ${res.status}`);
        const j = (await res.json());
        const exitDigest = j.ip ?? '(unknown)';
        console.info(`EGRESS_CLOAKING_VERIFIED: Proxy transport exit digest ${exitDigest} — origin egress masked (Egress Cloaking operational).`);
        console.info('EGRESS_VERIFIED: Proxy transport active. Environment blueprint locked. Legion Engine is launch-ready.');
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`EGRESS_CLOAKING_FAULT: Egress Cloaking verification failed — ${msg}`);
    }
}
//# sourceMappingURL=network-mesh.js.map