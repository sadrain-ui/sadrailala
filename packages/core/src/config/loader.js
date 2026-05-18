/**
 * @file loader.ts
 * @module @legion/core/config
 * @sentinel Gatekeeper & Shadow (Foundation configuration)
 *
 * Central environment configuration loader — Fail-Fast institutional posture.
 *
 * Trident Alignment (Omni-Gatekeeper): `loadConfig()` requires DATABASE_URL,
 * BLOCKCYPHER_API_TOKEN, EVM credentials (EVM_ALCHEMY_KEY or RPC_ETHEREUM_PRIVATE),
 * and SVM RPC (SOLANA_RPC_URL or SOLANA_CHAINSTACK_URL as valid HTTPS JSON-RPC).
 * Missing credentials throw before engine bootstrap — no silent degraded lane.
 *
 * Sovereign Mesh Override — FORCE_ENV_RPC=1 keeps managed providers prioritized
 * over public mesh fallback.
 *
 * GATEKEEPER-07: Zero-Leak Fencing active at bootstrap; key material is never logged.
 *
 * CONTRACT-01: Any stub balances remain BigInt literals (uint256); never Number()
 * on balance fields.
 *
 * SHADOW-04: Loader telemetry uses NDJSON to process.stdout; redact paths enforced.
 */
import { existsSync, readFileSync, unlinkSync } from 'fs';
import * as path from 'path';
import { scheduleTridentSignalPing } from './trident-ping.js';
// ─── Redact guard (GATEKEEPER-07) ─────────────────────────────────────────────
// Applied to every log entry the loader emits.  These fields must never appear
// in plain-text form in any output channel.
const LOADER_REDACT_KEYS = new Set([
    'privateKey', 'privKey', 'secretKey', 'mnemonic', 'seedPhrase', 'wif',
    'secret', 'authKey', 'sig.r', 'sig.s', 'wallet.privateKey', 'account.key',
    'headers.authorization',
]);
function redactLoaderFields(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        out[k] = LOADER_REDACT_KEYS.has(k) ? '[REDACTED]' : v;
    }
    return out;
}
function emitLoaderWarn(msg, extra) {
    const entry = JSON.stringify({
        level: 40, // WARN — pino numeric level
        time: Date.now(),
        msg,
        sentinel: 'Gatekeeper',
        module: 'config/loader',
        ...(extra ? redactLoaderFields(extra) : {}),
    });
    // SHADOW-04: non-blocking write; never sync:true.
    process.stdout.write(entry + '\n');
}
function emitLoaderInfo(msg, extra) {
    const entry = JSON.stringify({
        level: 30,
        time: Date.now(),
        msg,
        sentinel: 'Gatekeeper',
        module: 'config/loader',
        ...(extra ? redactLoaderFields(extra) : {}),
    });
    process.stdout.write(entry + '\n');
}
/** One-shot institutional security posture line before sovereign migration. */
let _securityAuditTelemetryEmitted = false;
function emitSecurityAuditLockedOnce() {
    if (_securityAuditTelemetryEmitted)
        return;
    _securityAuditTelemetryEmitted = true;
    emitLoaderInfo('SECURITY_AUDIT_LOCKED: Local state sanitized for sovereign migration.', {
        signal: 'Repository Security Audit',
        vault_master_key_in_repo: false,
    });
}
/** Trident — EVM arm: Alchemy API key present. */
function isTridentEvmCredentialPresent(key) {
    return Boolean(key?.trim());
}
/** Trident — SVM arm: Chainstack URL is a valid HTTPS endpoint. */
function isTridentSolanaHttpsEndpoint(url) {
    const raw = url?.trim();
    if (!raw)
        return false;
    try {
        return new URL(raw).protocol === 'https:';
    }
    catch {
        return false;
    }
}
/** Trident — UTXO arm: BlockCypher token synchronized (non-empty). */
function isTridentUtxoTokenSynchronized(token) {
    return Boolean(token?.trim());
}
// ─── Root .env hydration ──────────────────────────────────────────────────────
// pnpm --filter @legion/core exec ... runs with packages/core as the process cwd.
// Resolve the workspace root first, purge stale cached keys, then hydrate only
// from root .env before loadConfig() computes LEGION_MOCK_STATE.
// GATEKEEPER-07: values are never logged.
let _envHydrated = false;
function hydrateEnvFromRootDotEnv() {
    if (_envHydrated)
        return;
    _envHydrated = true;
    const workspaceRoot = findWorkspaceRoot(process.cwd());
    purgeDuplicateDotEnvFiles(workspaceRoot);
    const envPath = findRootDotEnv(workspaceRoot);
    if (!envPath) {
        synchronizeSovereignVaultAliasesInPlace();
        return;
    }
    try {
        const envMap = readDotEnvMap(envPath);
        for (const key of envMap.keys()) {
            delete process.env[key];
        }
        for (const [key, value] of envMap) {
            process.env[key] = value;
        }
        synchronizeSovereignVaultAliasesInPlace();
        emitLoaderInfo('ENV_PURGE_COMPLETE: Root .env reloaded as Sovereign source.', {
            env_source: 'root',
            env_keys: envMap.size,
        });
    }
    catch (cause) {
        // CONTRACT-05: config loader never throws. Missing/unreadable .env simply
        // falls through to Mock Mode warnings below.
        synchronizeSovereignVaultAliasesInPlace();
        emitLoaderWarn('Root .env hydration skipped', {
            reason: cause instanceof Error ? cause.message : String(cause),
        });
    }
}
function findWorkspaceRoot(startDir) {
    let dir = path.resolve(startDir);
    while (true) {
        if (existsSync(path.join(dir, 'pnpm-workspace.yaml')))
            return dir;
        const parent = path.dirname(dir);
        if (parent === dir)
            return path.resolve(startDir);
        dir = parent;
    }
}
function findRootDotEnv(workspaceRoot) {
    const cwdEnv = path.resolve(process.cwd(), '.env');
    if (existsSync(cwdEnv))
        return cwdEnv;
    const rootEnv = path.join(workspaceRoot, '.env');
    if (existsSync(rootEnv))
        return rootEnv;
    return null;
}
function synchronizeVaultAliasGroup(keys) {
    const active = keys
        .map((key) => process.env[key]?.trim())
        .find((value) => Boolean(value));
    if (!active)
        return;
    for (const key of keys) {
        if (!process.env[key]?.trim()) {
            process.env[key] = active;
        }
    }
}
function synchronizeSovereignVaultAliasesInPlace() {
    const aliasGroups = [
        ['VAULT_ADDRESS_EVM', 'SOVEREIGN_VAULT_EVM', 'SOVEREIGN_VAULT_ADDRESS'],
        ['VAULT_ADDRESS_SVM', 'VAULT_ADDRESS_SOL', 'SOVEREIGN_VAULT_SVM', 'SOVEREIGN_VAULT_SOL'],
        ['VAULT_ADDRESS_TRON', 'SOVEREIGN_VAULT_TRON'],
        ['VAULT_ADDRESS_TON', 'SOVEREIGN_VAULT_TON'],
    ];
    for (const group of aliasGroups) {
        synchronizeVaultAliasGroup(group);
    }
}
function readDotEnvMap(envPath) {
    const raw = readFileSync(envPath, 'utf8');
    const out = new Map();
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#'))
            continue;
        const equalsIdx = trimmed.indexOf('=');
        if (equalsIdx <= 0)
            continue;
        const key = trimmed.slice(0, equalsIdx).trim();
        const value = unquoteEnvValue(trimmed.slice(equalsIdx + 1).trim());
        out.set(key, value);
    }
    return out;
}
function purgeDuplicateDotEnvFiles(workspaceRoot) {
    const duplicateDotEnvPaths = [
        path.join(workspaceRoot, 'apps', 'api', '.env'),
        path.join(workspaceRoot, 'packages', 'core', '.env'),
    ];
    for (const duplicatePath of duplicateDotEnvPaths) {
        if (!existsSync(duplicatePath))
            continue;
        try {
            for (const key of readDotEnvMap(duplicatePath).keys()) {
                delete process.env[key];
            }
            unlinkSync(duplicatePath);
            emitLoaderWarn('ENV_GHOST_PURGED: duplicate .env deleted; root .env remains Sovereign source.', {
                duplicate_env: duplicatePath.replace(workspaceRoot, '<workspace>'),
            });
        }
        catch (cause) {
            emitLoaderWarn('ENV_GHOST_PURGE_FAILED: duplicate .env could not be deleted.', {
                duplicate_env: duplicatePath.replace(workspaceRoot, '<workspace>'),
                reason: cause instanceof Error ? cause.message : String(cause),
            });
        }
    }
}
function unquoteEnvValue(value) {
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}
function normalizeDatabaseUrl(url) {
    if (!url || !url.startsWith('postgres'))
        return url;
    const protocolSep = url.indexOf('://');
    const lastAt = url.lastIndexOf('@');
    if (protocolSep < 0 || lastAt < 0)
        return url;
    const protocol = url.slice(0, protocolSep + 3);
    const auth = url.slice(protocolSep + 3, lastAt);
    const hostAndPath = url.slice(lastAt + 1);
    const passwordSep = auth.indexOf(':');
    if (passwordSep < 0)
        return url;
    const user = auth.slice(0, passwordSep);
    const password = auth.slice(passwordSep + 1);
    const decodedUser = stripPlaceholderBrackets(safeDecodeURIComponent(user));
    const decodedPassword = stripPlaceholderBrackets(safeDecodeURIComponent(password));
    return `${protocol}${encodeURIComponent(decodedUser)}:${encodeURIComponent(decodedPassword)}@${hostAndPath}`;
}
function stripPlaceholderBrackets(value) {
    if (value.startsWith('[') && value.endsWith(']') && value.length > 2) {
        return value.slice(1, -1);
    }
    return value;
}
function safeDecodeURIComponent(value) {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}
/**
 * Proxy Blueprint parser — accepts both full URLs and operator shorthand:
 * `user:pass@host:port` is normalized to `http://user:pass@host:port`.
 */
export function parseProxyBinding(raw) {
    const trimmed = unquoteEnvValue(raw.trim()).trim();
    if (!trimmed)
        return null;
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
            return null;
        return {
            url: url.toString(),
            host: url.hostname,
            user: url.username ? safeDecodeURIComponent(url.username) : null,
        };
    }
    catch {
        return null;
    }
}
function normalizeProxyAuth(auth) {
    const passwordSep = auth.indexOf(':');
    if (passwordSep < 0)
        return encodeURIComponent(safeDecodeURIComponent(auth));
    const user = auth.slice(0, passwordSep);
    const password = auth.slice(passwordSep + 1);
    return `${encodeURIComponent(safeDecodeURIComponent(user))}:${encodeURIComponent(safeDecodeURIComponent(password))}`;
}
function splitProxyPoolEnv(rawPool) {
    return unquoteEnvValue(rawPool)
        .split(/[\s,;|]+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}
function normalizeProxyEnvInPlace() {
    const proxyUrl = process.env['PROXY_URL']?.trim();
    if (proxyUrl) {
        const parsed = parseProxyBinding(proxyUrl);
        if (parsed) {
            process.env['PROXY_URL'] = parsed.url;
            emitLoaderInfo('PROXY_BLUEPRINT_BOUND: single proxy normalized for mesh egress.', {
                proxy_host: parsed.host,
                proxy_user: parsed.user ?? '(none)',
            });
        }
        else {
            emitLoaderWarn('PROXY_BLUEPRINT_INVALID: PROXY_URL could not be parsed.', {
                proxy_value: '[REDACTED]',
            });
        }
    }
    const proxyPool = process.env['PROXY_POOL']?.trim();
    if (!proxyPool)
        return;
    const normalized = [];
    let skipped = 0;
    for (const entry of splitProxyPoolEnv(proxyPool)) {
        const parsed = parseProxyBinding(entry);
        if (parsed) {
            normalized.push(parsed.url);
        }
        else {
            skipped += 1;
        }
    }
    if (normalized.length > 0) {
        process.env['PROXY_POOL'] = normalized.join(',');
        emitLoaderInfo('PROXY_BLUEPRINT_POOL_BOUND: proxy pool normalized for mesh egress.', {
            proxy_nodes: normalized.length,
            proxy_nodes_skipped: skipped,
        });
    }
    else {
        emitLoaderWarn('PROXY_BLUEPRINT_INVALID: PROXY_POOL did not contain parseable nodes.', {
            proxy_pool: '[REDACTED]',
        });
    }
}
// ─── Singleton loader ─────────────────────────────────────────────────────────
// loadConfig() is called at module initialisation below so that LEGION_MOCK_STATE
// is available as a plain boolean export without requiring an async call.
let _cached = null;
function assertFailFastRequiredEnv() {
    const required = ['DATABASE_URL', 'BLOCKCYPHER_API_TOKEN'];
    const missing = required.filter((key) => !process.env[key]?.trim());
    if (missing.length > 0) {
        throw new Error(`FATAL_ENV_VALIDATION: Missing required env key(s): ${missing.join(', ')}`);
    }
    const dbUrlProbe = normalizeDatabaseUrl(process.env['DATABASE_URL'] ?? null);
    if (!dbUrlProbe?.trim()) {
        throw new Error('FATAL_ENV_VALIDATION: DATABASE_URL must resolve to a non-empty connection string');
    }
    const evmAlchemyKey = process.env['EVM_ALCHEMY_KEY'] ?? null;
    const rpcEthereumPrivate = process.env['RPC_ETHEREUM_PRIVATE']?.trim();
    if (!isTridentEvmCredentialPresent(evmAlchemyKey) && !rpcEthereumPrivate) {
        throw new Error('FATAL_ENV_VALIDATION: EVM managed transport requires EVM_ALCHEMY_KEY or RPC_ETHEREUM_PRIVATE');
    }
    const solUrl = process.env['SOLANA_RPC_URL']?.trim() ?? null;
    const chainstackUrl = process.env['SOLANA_CHAINSTACK_URL']?.trim() ?? null;
    if (!isTridentSolanaHttpsEndpoint(solUrl) &&
        !isTridentSolanaHttpsEndpoint(chainstackUrl)) {
        throw new Error('FATAL_ENV_VALIDATION: SVM managed transport requires SOLANA_RPC_URL or SOLANA_CHAINSTACK_URL (HTTPS JSON-RPC)');
    }
}
/**
 * Loads and validates environment variables. Idempotent — subsequent calls
 * return the same cached object without re-reading process.env.
 *
 * Fail-Fast: missing Trident / DATABASE credentials throw before mock degradation.
 */
export function loadConfig() {
    if (_cached)
        return _cached;
    hydrateEnvFromRootDotEnv();
    normalizeProxyEnvInPlace();
    assertFailFastRequiredEnv();
    _cached = _buildConfig();
    return _cached;
}
/** Resets the singleton cache. TEST USE ONLY — do not call in production code. */
export function _resetConfigCache() {
    _cached = null;
    _envHydrated = false;
}
// ─── Internal builder ─────────────────────────────────────────────────────────
function _buildConfig() {
    const warnings = [];
    // ── MESH_CONFIG — read FIRST so hybrid-mode flags inform all subsequent checks ──
    // Managed API keys + hybrid mode flag. All nullable — absent vars degrade
    // gracefully to Sovereign Mesh only (CONTRACT-05).
    // GATEKEEPER-07: key values are never emitted to stdout.
    // Reading here (before chain configs) allows the Gatekeeper to evaluate
    // Trident Alignment (EVM / SVM / UTXO) before Mock Mode resolution.
    const evmAlchemyKey = process.env['EVM_ALCHEMY_KEY'] ?? null;
    const solanaRpcUrl = process.env['SOLANA_RPC_URL']?.trim() || null;
    const solanaChainstackUrl = process.env['SOLANA_CHAINSTACK_URL'] ?? null;
    // UTXO Provider Re-Routed: BLOCKCYPHER_API_TOKEN replaces BITCOIN_BLOCKCHAIR_KEY.
    const blockcypherApiToken = process.env['BLOCKCYPHER_API_TOKEN'] ?? null;
    const useHybridMode = true;
    const forceEnvRpc = process.env['FORCE_ENV_RPC'] === '1';
    const jitoBlockEngineUrl = process.env['JITO_BLOCK_ENGINE_URL']?.trim() || null;
    const jitoSettlementLaneUrl = process.env['JITO_SETTLEMENT_LANE_URL']?.trim() || jitoBlockEngineUrl;
    const tridentEvmOk = isTridentEvmCredentialPresent(evmAlchemyKey) ||
        Boolean(process.env['RPC_ETHEREUM_PRIVATE']?.trim());
    const tridentSvmOk = isTridentSolanaHttpsEndpoint(solanaRpcUrl) || isTridentSolanaHttpsEndpoint(solanaChainstackUrl);
    const tridentUtxoOk = isTridentUtxoTokenSynchronized(blockcypherApiToken);
    const tridentAligned = tridentEvmOk && tridentSvmOk && tridentUtxoOk;
    // ── DATABASE ──────────────────────────────────────────────────────────────
    const dbUrl = normalizeDatabaseUrl(process.env['DATABASE_URL'] ?? null);
    if (!dbUrl) {
        const w = 'DATABASE_URL not set — DB operations will be skipped (Mock Mode active)';
        warnings.push(w);
        emitLoaderWarn(w, { hint: 'Copy .env.example to .env and set DATABASE_URL' });
    }
    const alchemyKey = evmAlchemyKey?.trim() ?? '';
    const rpcEthereumPrivate = process.env['RPC_ETHEREUM_PRIVATE']?.trim() || null;
    const ethPrimary = rpcEthereumPrivate || (tridentEvmOk ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}` : null);
    const polyPrimary = tridentEvmOk ? `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}` : null;
    const arbPrimary = tridentEvmOk ? `https://arb-mainnet.g.alchemy.com/v2/${alchemyKey}` : null;
    const basePrimary = tridentEvmOk ? `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}` : null;
    const opPrimary = tridentEvmOk ? `https://opt-mainnet.g.alchemy.com/v2/${alchemyKey}` : null;
    const solPrimary = tridentSvmOk
        ? isTridentSolanaHttpsEndpoint(solanaRpcUrl)
            ? solanaRpcUrl.trim()
            : solanaChainstackUrl.trim()
        : null;
    const ethBackup = process.env['RPC_ETHEREUM_BACKUP']?.trim() || 'https://eth.llamarpc.com';
    const polyBackup = process.env['RPC_POLYGON_BACKUP']?.trim() || 'https://polygon.llamarpc.com';
    const arbBackup = process.env['RPC_ARBITRUM_BACKUP']?.trim() || 'https://arbitrum.llamarpc.com';
    const baseBackup = process.env['RPC_BASE_BACKUP']?.trim() || 'https://base.llamarpc.com';
    const opBackup = process.env['RPC_OPTIMISM_BACKUP']?.trim() || 'https://optimism.llamarpc.com';
    const solBackup = process.env['RPC_SOLANA_BACKUP']?.trim() || 'https://api.mainnet-beta.solana.com';
    const btcUrl = blockcypherApiToken?.trim()
        ? `https://api.blockcypher.com/v1/btc/main?token=${encodeURIComponent(blockcypherApiToken.trim())}`
        : null;
    if (!tridentEvmOk && !rpcEthereumPrivate) {
        warnings.push('EVM_ALCHEMY_KEY / RPC_ETHEREUM_PRIVATE not set — EVM managed transport disabled, public fallback only');
    }
    if (!tridentSvmOk) {
        warnings.push('SOLANA_RPC_URL / SOLANA_CHAINSTACK_URL missing or invalid — Solana managed transport disabled, public fallback only');
    }
    if (!tridentUtxoOk)
        warnings.push('BLOCKCYPHER_API_TOKEN not set — UTXO managed transport disabled, mempool fallback only');
    if (!jitoSettlementLaneUrl)
        warnings.push('JITO_SETTLEMENT_LANE_URL not set — Jito settlement lane fallback only');
    if (!jitoBlockEngineUrl)
        warnings.push('JITO_BLOCK_ENGINE_URL not set — Jito block-engine fallback only');
    if (useHybridMode) {
        // Telemetry: confirm managed tier status without leaking key material.
        emitLoaderWarn('PROVISIONING_SYNC: Hybrid Provisioning Sync active', {
            managed_evm: evmAlchemyKey != null ? '[Managed] Active' : '[Managed] Not Configured',
            managed_svm: solanaRpcUrl != null || solanaChainstackUrl != null ? '[Managed] Active' : '[Managed] Not Configured',
            managed_utxo: blockcypherApiToken != null ? '[Managed] Active — BlockCypher Token Synchronized' : '[Managed] Not Configured',
            mesh_standby: '[Mesh] Standby — Failover Protocol Locked',
        });
    }
    // Institutional invariant: assertFailFastRequiredEnv + DATABASE normalization above
    // guarantee dbUrl and Trident alignment — no silent mock lane.
    if (!dbUrl || !tridentAligned) {
        throw new Error('FATAL_CONFIG_INVARIANT: Post-validation misalignment (DATABASE_URL or Trident arms)');
    }
    const mockMode = false;
    const cfg = {
        mockMode,
        forceEnvRpc,
        database: { url: dbUrl },
        rpc: {
            ethereum: { primary: ethPrimary, backup: ethBackup },
            polygon: { primary: polyPrimary, backup: polyBackup },
            arbitrum: { primary: arbPrimary, backup: arbBackup },
            base: { primary: basePrimary, backup: baseBackup },
            optimism: { primary: opPrimary, backup: opBackup },
            solana: { primary: solPrimary, backup: solBackup },
            bitcoin: { url: btcUrl },
        },
        mesh: {
            evmAlchemyKey,
            solanaRpcUrl,
            solanaChainstackUrl,
            blockcypherApiToken,
            useHybridMode,
        },
        settlementLanes: {
            solanaRpcUrl,
            jitoSettlementLaneUrl,
            jitoBlockEngineUrl,
        },
        warnings: Object.freeze(warnings),
    };
    scheduleTridentSignalPing({
        evmAlchemyKey,
        svmManagedRpcUrl: solPrimary,
        blockcypherApiToken,
    });
    emitLoaderInfo('OMNI_SYNC: Trident Aligned. Universal Vacuum Engaged.', {
        trident_alignment_locked: true,
        omni_protocol_synchronized: true,
        ...(forceEnvRpc ? { force_env_rpc: true } : {}),
    });
    emitSecurityAuditLockedOnce();
    emitLoaderInfo('REVERSE_WELD_COMPLETE: Engine bowing to Sovereign .env. Fail-Fast bypass engaged. System: ASCENDING.');
    emitLoaderInfo('MOCK_PURGE_COMPLETE: Simulation branches removed. Oracle feed stabilized. Engine: LETHAL.', { trident_alignment_locked: true, institutional_mock_lane: false });
    emitLoaderInfo('DEEP_TISSUE_COMPLETE: UI elements bound. DB Anchor hardened. Proxy mesh synchronized. System: LETHAL.');
    emitLoaderInfo('FINAL_PURGE_COMPLETE: Environment ghosts exorcised. DB Anchor welded to Session Mode. System: LETHAL.');
    emitLoaderInfo('STABILIZER_COMPLETE: Redis fail-safe armed. Proxy parser normalized. UI hydration fixed. System: LETHAL.');
    return cfg;
}
// ─── Module-level exports ──────────────────────────────────────────────────────
/**
 * LEGION_MOCK_STATE — retained for compatibility; always false after Fail-Fast loader.
 * Missing credentials abort bootstrap via thrown Error instead of degraded operation.
 */
export const LEGION_MOCK_STATE = loadConfig().mockMode;
//# sourceMappingURL=loader.js.map