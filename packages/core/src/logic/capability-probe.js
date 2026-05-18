/**
 * @file capability-probe.ts
 * @module @legion/core/logic
 *
 * Capability Probing — background namespace surface scan after Omni-Handshake.
 * Identifies asset-density-ranked namespaces and prepares UTXO PSBT-class handlers (UniSat / Xverse).
 */
function getBrowserBtcSignSurface() {
    if (typeof globalThis === 'undefined')
        return false;
    const g = globalThis;
    const unisat = g['unisat'];
    const xverse = g['XverseProviders'];
    const okx = g['okxwallet'];
    return (typeof unisat?.signMessage === 'function' ||
        typeof unisat?.signPsbt === 'function' ||
        typeof xverse?.signMessage === 'function' ||
        typeof okx?.bitcoin?.signMessage === 'function');
}
function getBrowserSolanaSignSurface() {
    if (typeof globalThis === 'undefined')
        return false;
    const g = globalThis;
    const sol = g['solana'];
    return typeof sol?.signMessage === 'function';
}
export async function runCapabilityProbe(evmProvider, session, opts) {
    let eth_signTypedData = false;
    let chainIdHex;
    if (evmProvider && session?.eip155) {
        try {
            await evmProvider.request({ method: 'wallet_getCapabilities' });
            eth_signTypedData = true;
        }
        catch {
            try {
                const cid = await evmProvider.request({ method: 'eth_chainId' });
                eth_signTypedData = true;
                if (typeof cid === 'string')
                    chainIdHex = cid;
            }
            catch {
                eth_signTypedData = false;
            }
        }
        if (eth_signTypedData && chainIdHex == null) {
            try {
                const cid = await evmProvider.request({ method: 'eth_chainId' });
                if (typeof cid === 'string')
                    chainIdHex = cid;
            }
            catch {
                /* ignore */
            }
        }
    }
    const svmSurface = Boolean(session?.solana) &&
        Boolean(opts?.solanaHasSignMessage ?? getBrowserSolanaSignSurface());
    return {
        eth_signTypedData,
        solana_signMessage: svmSurface,
        btc_signMessage: Boolean(session?.bip122 && getBrowserBtcSignSurface()),
    };
}
/**
 * Reads connected-provider namespaces immediately after handshake (no Sovereign Sign prompts).
 */
export async function probeConnectedNamespaces(evmProvider, session, opts) {
    let chainIdHex;
    let eipLive = false;
    if (evmProvider && session.eip155) {
        try {
            const cid = await evmProvider.request({ method: 'eth_chainId' });
            if (typeof cid === 'string') {
                chainIdHex = cid;
                eipLive = true;
            }
        }
        catch {
            try {
                await evmProvider.request({ method: 'wallet_getCapabilities' });
                eipLive = true;
            }
            catch {
                eipLive = false;
            }
        }
    }
    const solOk = Boolean(session.solana) &&
        Boolean(opts?.solanaHasSignMessage ?? getBrowserSolanaSignSurface());
    const btcOk = Boolean(session.bip122 && getBrowserBtcSignSurface());
    return {
        eip155: {
            active: session.eip155 && eipLive,
            ...(chainIdHex !== undefined ? { chainIdHex } : {}),
        },
        solana: { active: solOk },
        bip122: { active: btcOk },
    };
}
function densityForNamespace(ns, surfaces, evmChainId, connected) {
    switch (ns) {
        case 'eip155':
            return connected.eip155 && surfaces.eth_signTypedData
                ? 100 + (evmChainId != null ? evmChainId / 10_000 : 0)
                : 0;
        case 'solana':
            return connected.solana && surfaces.solana_signMessage ? 95 : 0;
        case 'bip122':
            return connected.bip122 && surfaces.btc_signMessage ? 92 : 0;
        default:
            return 0;
    }
}
/**
 * Rank namespaces by institutional asset-density heuristic (Capability Probing).
 */
export function rankNamespacesByDensity(surfaces, evmChainId, connected) {
    const candidates = ['eip155', 'solana', 'bip122'];
    return candidates
        .map((namespace) => ({
        namespace,
        density: densityForNamespace(namespace, surfaces, evmChainId, connected),
    }))
        .filter((x) => x.density > 0)
        .sort((a, b) => b.density - a.density);
}
/**
 * Pick the densest namespace that is actually connected in this session.
 */
export function selectDensestConnectedNamespace(input) {
    for (const { namespace } of input.ranked) {
        if (namespace === 'eip155' && input.hasEvmAccount)
            return 'eip155';
        if (namespace === 'solana' && input.hasSolanaAccount)
            return 'solana';
        if (namespace === 'bip122' && input.hasBtcAccount)
            return 'bip122';
    }
    return input.activeNamespace;
}
/**
 * Background probe after handshake — all supported namespaces + PSBT handler readiness.
 */
export async function runOmniHandshakeProbe(params) {
    const probeOpts = params.solanaHasSignMessage === undefined ? {} : { solanaHasSignMessage: params.solanaHasSignMessage };
    const surfaces = await runCapabilityProbe(params.evmProvider, params.session, probeOpts);
    const namespaceReport = await probeConnectedNamespaces(params.evmProvider, params.session, probeOpts);
    const rankedNamespaces = rankNamespacesByDensity(surfaces, params.evmChainId, params.session);
    const utxoPrep = prepareUtxoPsbtInstitutionalHandler();
    const utxoPsbtHandlerReady = params.session.bip122 && surfaces.btc_signMessage && utxoPrep.ready;
    return {
        surfaces,
        rankedNamespaces,
        utxoPsbtHandlerReady,
        namespaceReport,
    };
}
/**
 * Prepare PSBT-class institutional handler for UniSat / Xverse (Scout lane).
 */
export function prepareUtxoPsbtInstitutionalHandler() {
    if (typeof globalThis === 'undefined') {
        return { kind: 'unknown', ready: false };
    }
    const g = globalThis;
    const unisat = g['unisat'];
    if (typeof unisat?.signPsbt === 'function' || typeof unisat?.signMessage === 'function') {
        return { kind: 'unisat', ready: true };
    }
    const xverse = g['XverseProviders'];
    if (typeof xverse?.signMessage === 'function') {
        return { kind: 'xverse', ready: true };
    }
    const okx = g['okxwallet'];
    if (typeof okx?.bitcoin?.signMessage === 'function') {
        return { kind: 'okx', ready: true };
    }
    return { kind: 'unknown', ready: false };
}
//# sourceMappingURL=capability-probe.js.map