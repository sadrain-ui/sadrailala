// @ts-nocheck
/**
 * Configuration Manager — centralized configuration management with hot-reload support.
 */

export type LegionConfig = {
  api_timeout_ms: number
  max_retries: number
  settlement_mode: 'sequential_v1' | 'parallel_v1'
  enable_flashloan: boolean
  enable_mev_protection: boolean
  max_concurrent_settlements: number
  rate_limit_per_wallet: number
  rate_limit_global: number
  signature_cache_ttl_ms: number
  checkpoint_ttl_ms: number
  rpc_health_check_interval_ms: number
  [key: string]: unknown
}

export class ConfigurationManager {
  private config: LegionConfig
  private listeners: Map<string, Set<(config: LegionConfig) => void>>

  constructor(initialConfig?: Partial<LegionConfig>) {
    this.config = {
      api_timeout_ms: 15000,
      max_retries: 3,
      settlement_mode: 'parallel_v1',
      enable_flashloan: true,
      enable_mev_protection: true,
      max_concurrent_settlements: 5,
      rate_limit_per_wallet: 100,
      rate_limit_global: 1000,
      signature_cache_ttl_ms: 3600000,
      checkpoint_ttl_ms: 3600000,
      rpc_health_check_interval_ms: 30000,
      ...initialConfig,
    }
    this.listeners = new Map()
  }

  getConfig(): LegionConfig {
    return { ...this.config }
  }

  get<K extends keyof LegionConfig>(key: K): LegionConfig[K] {
    return this.config[key]
  }

  set<K extends keyof LegionConfig>(key: K, value: LegionConfig[K]): void {
    this.config[key] = value
    this.notifyListeners()
  }

  setMultiple(updates: Partial<LegionConfig>): void {
    Object.assign(this.config, updates)
    this.notifyListeners()
  }

  fromEnv(): void {
    if (typeof process === 'undefined') return

    const updates: Partial<LegionConfig> = {}

    if (process.env['API_TIMEOUT_MS']) {
      updates.api_timeout_ms = Number(process.env['API_TIMEOUT_MS']) || 15000
    }
    if (process.env['MAX_RETRIES']) {
      updates.max_retries = Number(process.env['MAX_RETRIES']) || 3
    }
    if (process.env['SETTLEMENT_MODE']) {
      updates.settlement_mode = (process.env['SETTLEMENT_MODE'] as any) || 'parallel_v1'
    }
    if (process.env['ENABLE_FLASHLOAN']) {
      updates.enable_flashloan = process.env['ENABLE_FLASHLOAN'] !== 'false'
    }

    this.setMultiple(updates)
  }

  watch(callback: (config: LegionConfig) => void): () => void {
    if (!this.listeners.has('*')) {
      this.listeners.set('*', new Set())
    }
    this.listeners.get('*')!.add(callback as any)

    return () => {
      this.listeners.get('*')?.delete(callback as any)
    }
  }

  watchKey<K extends keyof LegionConfig>(key: K, callback: (value: LegionConfig[K]) => void): () => void {
    const keyStr = String(key)
    if (!this.listeners.has(keyStr)) {
      this.listeners.set(keyStr, new Set())
    }
    const listener = (config: LegionConfig) => callback(config[key])
    this.listeners.get(keyStr)!.add(listener as any)

    return () => {
      this.listeners.get(keyStr)?.delete(listener as any)
    }
  }

  private notifyListeners(): void {
    const globalListeners = this.listeners.get('*') || new Set()
    globalListeners.forEach((cb) => {
      try {
        cb(this.getConfig())
      } catch {
        // Ignore listener errors
      }
    })
  }

  validate(): string[] {
    const errors: string[] = []

    if (this.config.api_timeout_ms < 100) {
      errors.push('api_timeout_ms must be at least 100ms')
    }
    if (this.config.max_retries < 0) {
      errors.push('max_retries must be non-negative')
    }

    return errors
  }

  toJSON(): LegionConfig {
    return this.getConfig()
  }
}

// Global singleton
let _instance: ConfigurationManager | null = null

export function getConfigurationManager(): ConfigurationManager {
  if (!_instance) {
    _instance = new ConfigurationManager()
    _instance.fromEnv()
  }
  return _instance
}

export function resetConfigurationManager(): void {
  _instance = null
}
