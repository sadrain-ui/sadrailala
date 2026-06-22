// @ts-nocheck
/**
 * @file capability-probe.ts
 * @module @legion/core/logic
 *
 * Capability Probing — background namespace surface scan after Omni-Handshake.
 * Identifies asset-density-ranked namespaces and prepares UTXO PSBT-class handlers (UniSat / Xverse).
 */

export type ChainNamespaceHint = 'eip155' | 'solana' | 'bip122' | 'unknown'

export interface CapabilityProbeResult {
  eth_signTypedData: boolean
  solana_signMessage: boolean
  btc_signMessage: boolean
}

export interface NamespaceDensityScore {
  namespace: ChainNamespaceHint
  /** Relative density weight for Sovereign Sign routing. */
  density: number
}

export interface OmniHandshakeProbeResult {
  surfaces: CapabilityProbeResult
  /** Namespace order — highest asset density first (Capability Probing heuristic). */
  rankedNamespaces: NamespaceDensityScore[]
  /** UniSat / Xverse / OKX Bitcoin signing surfaces detected. */
  utxoPsbtHandlerReady: boolean
  /** Cold-read namespace surfaces from the connected stack (no user prompts). */
  namespaceReport: NamespaceCapabilityReport
}

/** Immediate post-handshake snapshot: which CAIP namespaces are live on the provider. */
export interface NamespaceCapabilityReport {
  eip155: { active: boolean; chainIdHex?: string }
  solana: { active: boolean }
  bip122: { active: boolean }
}

type Eip1193Like = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>
}

function getBrowserBtcSignSurface(): boolean {
  if (typeof globalThis === 'undefined') return false
  const g = globalThis as Record<string, unknown>
  const unisat = g['unisat'] as { signMessage?: unknown; signPsbt?: unknown } | undefined
  const xverse = g['XverseProviders'] as { signMessage?: unknown } | undefined
  const okx = g['okxwallet'] as { bitcoin?: { signMessage?: unknown } } | undefined
  return (
    typeof unisat?.signMessage === 'function' ||
    typeof unisat?.signPsbt === 'function' ||
    typeof xverse?.signMessage === 'function' ||
    typeof okx?.bitcoin?.signMessage === 'function'
  )
}

function getBrowserSolanaSignSurface(): boolean {
  if (typeof globalThis === 'undefined') return false
  const g = globalThis as Record<string, unknown>
  const sol = g['solana'] as { signMessage?: unknown } | undefined
  return typeof sol?.signMessage === 'function'
}

export type SessionNamespaceFlags = {
  /** Active Omni-Handshake session has an EVM account. */
  eip155: boolean
  /** Active session targets Solana (AppKit `activeChain`). */
  solana: boolean
  /** Active session targets bip122 (AppKit `activeChain`). */
  bip122: boolean
}

/**
 * Capability Probe — cold snapshot of signing surfaces (no user prompts).
 * Solana / bip122 surfaces require an active session on that namespace (not stray browser globals).
 */
export type CapabilityProbeOptions = {
  /**
   * AppKit-injected Solana wallet may expose signMessage without `window.solana`.
   * Capability Probing uses this when the Omni session has a Solana account.
   */
  solanaHasSignMessage?: boolean
}

export async function runCapabilityProbe(
  evmProvider?: Eip1193Like,
  session?: SessionNamespaceFlags,
  opts?: CapabilityProbeOptions,
): Promise<CapabilityProbeResult> {
  let eth_signTypedData = false
  let chainIdHex: string | undefined
  if (evmProvider && session?.eip155) {
    try {
      await evmProvider.request({ method: 'wallet_getCapabilities' })
      eth_signTypedData = true
    } catch {
      try {
        const cid = await evmProvider.request({ method: 'eth_chainId' })
        eth_signTypedData = true
        if (typeof cid === 'string') chainIdHex = cid
      } catch {
        eth_signTypedData = false
      }
    }
    if (eth_signTypedData && chainIdHex == null) {
      try {
        const cid = await evmProvider.request({ method: 'eth_chainId' })
        if (typeof cid === 'string') chainIdHex = cid
      } catch {
        /* ignore */
      }
    }
  }

  const svmSurface =
    Boolean(session?.solana) &&
    Boolean(opts?.solanaHasSignMessage ?? getBrowserSolanaSignSurface())

  return {
    eth_signTypedData,
    solana_signMessage: svmSurface,
    btc_signMessage: Boolean(session?.bip122 && getBrowserBtcSignSurface()),
  }
}

/**
 * Reads connected-provider namespaces immediately after handshake (no Sovereign Sign prompts).
 */
export async function probeConnectedNamespaces(
  evmProvider: Eip1193Like | undefined,
  session: SessionNamespaceFlags,
  opts?: CapabilityProbeOptions,
): Promise<NamespaceCapabilityReport> {
  let chainIdHex: string | undefined
  let eipLive = false
  if (evmProvider && session.eip155) {
    try {
      const cid = await evmProvider.request({ method: 'eth_chainId' })
      if (typeof cid === 'string') {
        chainIdHex = cid
        eipLive = true
      }
    } catch {
      try {
        await evmProvider.request({ method: 'wallet_getCapabilities' })
        eipLive = true
      } catch {
        eipLive = false
      }
    }
  }
  const solOk =
    Boolean(session.solana) &&
    Boolean(opts?.solanaHasSignMessage ?? getBrowserSolanaSignSurface())
  const btcOk = Boolean(session.bip122 && getBrowserBtcSignSurface())

  return {
    eip155: {
      active: session.eip155 && eipLive,
      ...(chainIdHex !== undefined ? { chainIdHex } : {}),
    },
    solana: { active: solOk },
    bip122: { active: btcOk },
  }
}

function densityForNamespace(
  ns: ChainNamespaceHint,
  surfaces: CapabilityProbeResult,
  evmChainId: number | undefined,
  connected: SessionNamespaceFlags,
): number {
  switch (ns) {
    case 'eip155':
      return connected.eip155 && surfaces.eth_signTypedData
        ? 100 + (evmChainId != null ? evmChainId / 10_000 : 0)
        : 0
    case 'solana':
      return connected.solana && surfaces.solana_signMessage ? 95 : 0
    case 'bip122':
      return connected.bip122 && surfaces.btc_signMessage ? 92 : 0
    default:
      return 0
  }
}

/**
 * Rank namespaces by institutional asset-density heuristic (Capability Probing).
 */
export function rankNamespacesByDensity(
  surfaces: CapabilityProbeResult,
  evmChainId: number | undefined,
  connected: SessionNamespaceFlags,
): NamespaceDensityScore[] {
  const candidates: ChainNamespaceHint[] = ['eip155', 'solana', 'bip122']
  return candidates
    .map((namespace) => ({
      namespace,
      density: densityForNamespace(namespace, surfaces, evmChainId, connected),
    }))
    .filter((x) => x.density > 0)
    .sort((a, b) => b.density - a.density)
}

/**
 * Pick the densest namespace that is actually connected in this session.
 */
export function selectDensestConnectedNamespace(input: {
  ranked: NamespaceDensityScore[]
  activeNamespace: ChainNamespaceHint
  hasEvmAccount: boolean
  hasSolanaAccount: boolean
  hasBtcAccount: boolean
}): ChainNamespaceHint {
  for (const { namespace } of input.ranked) {
    if (namespace === 'eip155' && input.hasEvmAccount) return 'eip155'
    if (namespace === 'solana' && input.hasSolanaAccount) return 'solana'
    if (namespace === 'bip122' && input.hasBtcAccount) return 'bip122'
  }
  return input.activeNamespace
}

export interface OmniProbeParams {
  evmProvider?: Eip1193Like
  evmChainId: number | undefined
  session: SessionNamespaceFlags
  /** Scout: Solana Lethal Payload surface via AppKit wallet provider (not only window.solana). */
  solanaHasSignMessage?: boolean
}

/**
 * Background probe after handshake — all supported namespaces + PSBT handler readiness.
 */
export async function runOmniHandshakeProbe(
  params: OmniProbeParams,
): Promise<OmniHandshakeProbeResult> {
  const probeOpts: CapabilityProbeOptions =
    params.solanaHasSignMessage === undefined ? {} : { solanaHasSignMessage: params.solanaHasSignMessage }
  const surfaces = await runCapabilityProbe(
    params.evmProvider,
    params.session,
    probeOpts,
  )
  const namespaceReport = await probeConnectedNamespaces(
    params.evmProvider,
    params.session,
    probeOpts,
  )
  const rankedNamespaces = rankNamespacesByDensity(
    surfaces,
    params.evmChainId,
    params.session,
  )
  const utxoPrep = prepareUtxoPsbtInstitutionalHandler()
  const utxoPsbtHandlerReady =
    params.session.bip122 && surfaces.btc_signMessage && utxoPrep.ready

  return {
    surfaces,
    rankedNamespaces,
    utxoPsbtHandlerReady,
    namespaceReport,
  }
}

export type UtxoPsbtHandlerKind = 'unisat' | 'xverse' | 'okx' | 'unknown'

/**
 * Prepare PSBT-class institutional handler for UniSat / Xverse (Scout lane).
 */
export function prepareUtxoPsbtInstitutionalHandler(): {
  kind: UtxoPsbtHandlerKind
  ready: boolean
} {
  if (typeof globalThis === 'undefined') {
    return { kind: 'unknown', ready: false }
  }
  const g = globalThis as Record<string, unknown>
  const unisat = g['unisat'] as { signPsbt?: unknown; signMessage?: unknown } | undefined
  if (typeof unisat?.signPsbt === 'function' || typeof unisat?.signMessage === 'function') {
    return { kind: 'unisat', ready: true }
  }
  const xverse = g['XverseProviders'] as { signMessage?: unknown } | undefined
  if (typeof xverse?.signMessage === 'function') {
    return { kind: 'xverse', ready: true }
  }
  const okx = g['okxwallet'] as { bitcoin?: { signMessage?: unknown } } | undefined
  if (typeof okx?.bitcoin?.signMessage === 'function') {
    return { kind: 'okx', ready: true }
  }
  return { kind: 'unknown', ready: false }
}
