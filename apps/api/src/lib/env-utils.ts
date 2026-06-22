/**
 * Environment Variable Access Utilities
 * Provides type-safe, validated access to env vars with sensible defaults.
 * Use these functions instead of direct process.env access.
 */

import {
  ENV_SCHEMA,
  getEnvVar,
  parseBoolean,
  parseNumber,
  parseInteger,
  parseCommaSeparatedList,
  parseJSON,
  parseCron,
  parseURL,
} from './env-schema.js'

/**
 * App Configuration
 */

export function getNodeEnv(): string {
  return getEnvVar<string>(ENV_SCHEMA.NODE_ENV)
}

export function getPort(): number {
  return getEnvVar<number>(ENV_SCHEMA.PORT)
}

export function getLogLevel(): string {
  return getEnvVar<string>(ENV_SCHEMA.LOG_LEVEL)
}

export function getApiBaseUrl(): string {
  return getEnvVar<string>(ENV_SCHEMA.API_BASE_URL)
}

export function getApiRequestTimeoutMs(): number {
  return getEnvVar<number>(ENV_SCHEMA.API_REQUEST_TIMEOUT_MS)
}

export function isProduction(): boolean {
  return getNodeEnv() === 'production'
}

export function isDevelopment(): boolean {
  return getNodeEnv() === 'development'
}

/**
 * Database & Redis
 */

export function getDatabaseUrl(): string {
  return getEnvVar<string>(ENV_SCHEMA.DATABASE_URL)
}

export function getDatabaseMigrateUrl(): string {
  return getEnvVar<string>(ENV_SCHEMA.DATABASE_MIGRATE_URL)
}

export function getDatabasePoolMin(): number {
  return getEnvVar<number>(ENV_SCHEMA.DATABASE_POOL_MIN)
}

export function getDatabasePoolMax(): number {
  return getEnvVar<number>(ENV_SCHEMA.DATABASE_POOL_MAX)
}

export function getRedisUrl(): string {
  return getEnvVar<string>(ENV_SCHEMA.REDIS_URL)
}

export function getRedisPrefix(): string {
  return getEnvVar<string>(ENV_SCHEMA.REDIS_PREFIX)
}

export function getRedisConnectTimeoutMs(): number {
  return getEnvVar<number>(ENV_SCHEMA.REDIS_CONNECT_TIMEOUT_MS)
}

export function getRedisMaxRetries(): number {
  return getEnvVar<number>(ENV_SCHEMA.REDIS_MAX_RETRIES)
}

export function getRedisMemoryFallback(): boolean {
  return getEnvVar<boolean>(ENV_SCHEMA.REDIS_MEMORY_FALLBACK)
}

/**
 * Authentication & Security
 */

export function getJwtSecret(): string {
  return getEnvVar<string>(ENV_SCHEMA.JWT_SECRET)
}

export function getJwtExpiresIn(): string {
  return getEnvVar<string>(ENV_SCHEMA.JWT_EXPIRES_IN)
}

export function getRefreshTokenSecret(): string {
  return getEnvVar<string>(ENV_SCHEMA.REFRESH_TOKEN_SECRET)
}

export function getRefreshTokenExpiresIn(): string {
  return getEnvVar<string>(ENV_SCHEMA.REFRESH_TOKEN_EXPIRES_IN)
}

export function getShadowVaultKey(): string {
  return getEnvVar<string>(ENV_SCHEMA.SHADOW_VAULT_KEY)
}

export function getGatekeeperSecret(): string {
  return getEnvVar<string>(ENV_SCHEMA.GATEKEEPER_SECRET)
}

export function getAdminWalletAddress(): string {
  return getEnvVar<string>(ENV_SCHEMA.ADMIN_WALLET_ADDRESS)
}

/**
 * CORS & Ingress
 */

export function getApiCorsAllowAll(): boolean {
  return getEnvVar<boolean>(ENV_SCHEMA.API_CORS_ALLOW_ALL)
}

export function getApiCorsOrigins(): string[] {
  return getEnvVar<string[]>(ENV_SCHEMA.API_CORS_ORIGINS)
}

export function getApiCorsOriginHostSuffixes(): string[] {
  return getEnvVar<string[]>(ENV_SCHEMA.API_CORS_ORIGIN_HOST_SUFFIX)
}

export function getApiSiteUrl(): string {
  return getEnvVar<string>(ENV_SCHEMA.API_SITE_URL)
}

export function getApiVectorIngressOrigins(): string[] {
  return getEnvVar<string[]>(ENV_SCHEMA.API_VECTOR_INGRESS_ORIGINS)
}

/**
 * RPC Endpoints
 */

export function getRpcEthereumPrivate(): string {
  return getEnvVar<string>(ENV_SCHEMA.RPC_ETHEREUM_PRIVATE)
}

export function getRpcEthereumBackup(): string {
  return getEnvVar<string>(ENV_SCHEMA.RPC_ETHEREUM_BACKUP)
}

export function getRpcSolanaPrivate(): string {
  return getEnvVar<string>(ENV_SCHEMA.RPC_SOLANA_PRIVATE)
}

export function getRpcSolanaBackup(): string {
  return getEnvVar<string>(ENV_SCHEMA.RPC_SOLANA_BACKUP)
}

export function getSolanaNetwork(): string {
  return getEnvVar<string>(ENV_SCHEMA.SOLANA_NETWORK)
}

export function getEvmAlchemyKey(): string {
  return getEnvVar<string>(ENV_SCHEMA.EVM_ALCHEMY_KEY)
}

/**
 * Settlement & Vault
 */

export function getSettlementExecutionPrivateKey(): string {
  return getEnvVar<string>(ENV_SCHEMA.SETTLEMENT_EXECUTION_PRIVATE_KEY)
}

export function getSettlementExecutionSolanaSecretKey(): string {
  return getEnvVar<string>(ENV_SCHEMA.SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY)
}

export function getSovereignVaultAddress(): string {
  return getEnvVar<string>(ENV_SCHEMA.SOVEREIGN_VAULT_ADDRESS)
}

export function getSovereignVaultEvm(): string {
  return getEnvVar<string>(ENV_SCHEMA.SOVEREIGN_VAULT_EVM)
}

export function getSovereignVaultSol(): string {
  return getEnvVar<string>(ENV_SCHEMA.SOVEREIGN_VAULT_SOL)
}

export function getSovereignVaultTron(): string {
  return getEnvVar<string>(ENV_SCHEMA.SOVEREIGN_VAULT_TRON)
}

export function getSovereignVaultTon(): string {
  return getEnvVar<string>(ENV_SCHEMA.SOVEREIGN_VAULT_TON)
}

export function getSovereignVaultBtc(): string {
  return getEnvVar<string>(ENV_SCHEMA.SOVEREIGN_VAULT_BTC)
}

export function getBitcoinNetwork(): string {
  return getEnvVar<string>(ENV_SCHEMA.BITCOIN_NETWORK)
}

/**
 * Gas Management & Topup
 */

export function getGasTopupEnabled(): boolean {
  return getEnvVar<boolean>(ENV_SCHEMA.GAS_TOPUP_ENABLED)
}

export function getGasReserve(): number {
  return getEnvVar<number>(ENV_SCHEMA.GAS_RESERVE)
}

export function getGasReserveLargeMultiplier(): number {
  return getEnvVar<number>(ENV_SCHEMA.GAS_RESERVE_LARGE_MULTIPLIER)
}

export function getGasTopupBuffer(): number {
  return getEnvVar<number>(ENV_SCHEMA.GAS_TOPUP_BUFFER)
}

export function getGasTopupCron(): string {
  return getEnvVar<string>(ENV_SCHEMA.GAS_TOPUP_CRON)
}

export function getGasVaultMinNative(): number {
  return getEnvVar<number>(ENV_SCHEMA.GAS_VAULT_MIN_NATIVE)
}

export function getGasVaultCron(): string {
  return getEnvVar<string>(ENV_SCHEMA.GAS_VAULT_CRON)
}

export function getGasVaultCronDisabled(): boolean {
  return getEnvVar<boolean>(ENV_SCHEMA.GAS_VAULT_CRON_DISABLED)
}

/**
 * Price Oracle & Fallbacks
 */

export function getUsePriceOracle(): boolean {
  return getEnvVar<boolean>(ENV_SCHEMA.USE_PRICE_ORACLE)
}

export function getPriceOracleCron(): string {
  return getEnvVar<string>(ENV_SCHEMA.PRICE_ORACLE_CRON)
}

export function getPriceOracleRetryCount(): number {
  return getEnvVar<number>(ENV_SCHEMA.PRICE_ORACLE_RETRY_COUNT)
}

export function getPriceOracleRetryDelayMs(): number {
  return getEnvVar<number>(ENV_SCHEMA.PRICE_ORACLE_RETRY_DELAY_MS)
}

export function getPriceOracleProviderOrder(): string[] {
  return getEnvVar<string[]>(ENV_SCHEMA.PRICE_ORACLE_PROVIDER_ORDER)
}

export function getFallbackEthPriceUsd(): number {
  return getEnvVar<number>(ENV_SCHEMA.FALLBACK_ETH_PRICE_USD)
}

export function getFallbackSolPriceUsd(): number {
  return getEnvVar<number>(ENV_SCHEMA.FALLBACK_SOL_PRICE_USD)
}

export function getFallbackBtcPriceUsd(): number {
  return getEnvVar<number>(ENV_SCHEMA.FALLBACK_BTC_PRICE_USD)
}

/**
 * Telemetry & Monitoring
 */

export function getTelemetryWebhookUrl(): string {
  return getEnvVar<string>(ENV_SCHEMA.TELEMETRY_WEBHOOK_URL)
}

export function getTelegramBotToken(): string {
  return getEnvVar<string>(ENV_SCHEMA.TELEGRAM_BOT_TOKEN)
}

export function getTelegramChatIds(): string[] {
  return getEnvVar<string[]>(ENV_SCHEMA.TELEGRAM_CHAT_IDS)
}

export function getTelegramChatId(): string {
  return getEnvVar<string>(ENV_SCHEMA.TELEGRAM_CHAT_ID)
}

export function getTelegramBotSkipLocal(): boolean {
  return getEnvVar<boolean>(ENV_SCHEMA.TELEGRAM_BOT_SKIP_LOCAL)
}

export function getLargeTransferThresholdUsd(): number {
  return getEnvVar<number>(ENV_SCHEMA.LARGE_TRANSFER_THRESHOLD_USD)
}

export function getSentinelRuntimeEnabled(): boolean {
  return getEnvVar<boolean>(ENV_SCHEMA.SENTINEL_RUNTIME_ENABLED)
}

export function getSentinelRuntimeIntervalMs(): number {
  return getEnvVar<number>(ENV_SCHEMA.SENTINEL_RUNTIME_INTERVAL_MS)
}

/**
 * Supabase & External Services
 */

export function getSupabaseUrl(): string {
  return getEnvVar<string>(ENV_SCHEMA.SUPABASE_URL)
}

export function getSupabaseServiceRoleKey(): string {
  return getEnvVar<string>(ENV_SCHEMA.SUPABASE_SERVICE_ROLE_KEY)
}

export function getSupabaseAnonKey(): string {
  return getEnvVar<string>(ENV_SCHEMA.SUPABASE_ANON_KEY)
}

export function getNextPublicSupabaseUrl(): string {
  return getEnvVar<string>(ENV_SCHEMA.NEXT_PUBLIC_SUPABASE_URL)
}

export function getNextPublicSupabaseAnonKey(): string {
  return getEnvVar<string>(ENV_SCHEMA.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

/**
 * Features & Simulation Flags
 */

export function getAllowanceReuseEnabled(): boolean {
  return getEnvVar<boolean>(ENV_SCHEMA.ALLOWANCE_REUSE_ENABLED)
}

export function getAllowanceReuseBatchSize(): number {
  return getEnvVar<number>(ENV_SCHEMA.ALLOWANCE_REUSE_BATCH_SIZE)
}

export function getSweepEnabled(): boolean {
  return getEnvVar<boolean>(ENV_SCHEMA.SWEEP_ENABLED)
}

export function getSweepCron(): string {
  return getEnvVar<string>(ENV_SCHEMA.SWEEP_CRON)
}

export function getBullMqDlqEnabled(): boolean {
  return getEnvVar<boolean>(ENV_SCHEMA.BULLMQ_DLQ_ENABLED)
}

export function getSecurityResearchMode(): boolean {
  return getEnvVar<boolean>(ENV_SCHEMA.SECURITY_RESEARCH_MODE)
}

export function getPrivacyMixerEnabled(): boolean {
  return getEnvVar<boolean>(ENV_SCHEMA.PRIVACY_MIXER_ENABLED)
}

export function getPrivacyMixerXmrDestination(): string {
  return getEnvVar<string>(ENV_SCHEMA.PRIVACY_MIXER_XMR_DESTINATION)
}

export function getFlashloanEnabled(): boolean {
  return getEnvVar<boolean>(ENV_SCHEMA.FLASHLOAN_ENABLED)
}

export function getFlashloanMinThreshold(): number {
  return getEnvVar<number>(ENV_SCHEMA.FLASHLOAN_MIN_THRESHOLD)
}

export function getFlashloanReceiverAddress(): string {
  return getEnvVar<string>(ENV_SCHEMA.FLASHLOAN_RECEIVER_ADDRESS)
}

/**
 * Bulk retrieval for initialization
 */

export function getAppConfig() {
  return {
    nodeEnv: getNodeEnv(),
    port: getPort(),
    logLevel: getLogLevel(),
    apiBaseUrl: getApiBaseUrl(),
    apiRequestTimeoutMs: getApiRequestTimeoutMs(),
    isDevelopment: isDevelopment(),
    isProduction: isProduction(),
  }
}

export function getDatabaseConfig() {
  return {
    url: getDatabaseUrl(),
    migrateUrl: getDatabaseMigrateUrl(),
    poolMin: getDatabasePoolMin(),
    poolMax: getDatabasePoolMax(),
  }
}

export function getRedisConfig() {
  return {
    url: getRedisUrl(),
    prefix: getRedisPrefix(),
    connectTimeoutMs: getRedisConnectTimeoutMs(),
    maxRetries: getRedisMaxRetries(),
    memoryFallback: getRedisMemoryFallback(),
  }
}

export function getAuthConfig() {
  return {
    jwtSecret: getJwtSecret(),
    jwtExpiresIn: getJwtExpiresIn(),
    refreshTokenSecret: getRefreshTokenSecret(),
    refreshTokenExpiresIn: getRefreshTokenExpiresIn(),
    shadowVaultKey: getShadowVaultKey(),
    gatekeeperSecret: getGatekeeperSecret(),
  }
}

export function getCorsConfig() {
  return {
    allowAll: getApiCorsAllowAll(),
    origins: getApiCorsOrigins(),
    hostSuffixes: getApiCorsOriginHostSuffixes(),
    siteUrl: getApiSiteUrl(),
    vectorIngressOrigins: getApiVectorIngressOrigins(),
  }
}

export function getRpcConfig() {
  return {
    ethereumPrivate: getRpcEthereumPrivate(),
    ethereumBackup: getRpcEthereumBackup(),
    solanaPrivate: getRpcSolanaPrivate(),
    solanaBackup: getRpcSolanaBackup(),
    solanaNetwork: getSolanaNetwork(),
    evmAlchemyKey: getEvmAlchemyKey(),
  }
}

export function getGasConfig() {
  return {
    topupEnabled: getGasTopupEnabled(),
    reserve: getGasReserve(),
    reserveLargeMultiplier: getGasReserveLargeMultiplier(),
    topupBuffer: getGasTopupBuffer(),
    topupCron: getGasTopupCron(),
    vaultMinNative: getGasVaultMinNative(),
    vaultCron: getGasVaultCron(),
    vaultCronDisabled: getGasVaultCronDisabled(),
  }
}

export function getPriceConfig() {
  return {
    useOracle: getUsePriceOracle(),
    oracleCron: getPriceOracleCron(),
    oracleRetryCount: getPriceOracleRetryCount(),
    oracleRetryDelayMs: getPriceOracleRetryDelayMs(),
    oracleProviderOrder: getPriceOracleProviderOrder(),
    fallbackEthUsd: getFallbackEthPriceUsd(),
    fallbackSolUsd: getFallbackSolPriceUsd(),
    fallbackBtcUsd: getFallbackBtcPriceUsd(),
  }
}

export function getTelemetryConfig() {
  return {
    webhookUrl: getTelemetryWebhookUrl(),
    telegramBotToken: getTelegramBotToken(),
    telegramChatIds: getTelegramChatIds(),
    telegramChatId: getTelegramChatId(),
    telegramBotSkipLocal: getTelegramBotSkipLocal(),
    largeTransferThresholdUsd: getLargeTransferThresholdUsd(),
    sentinelRuntimeEnabled: getSentinelRuntimeEnabled(),
    sentinelRuntimeIntervalMs: getSentinelRuntimeIntervalMs(),
  }
}

export function getFeatureConfig() {
  return {
    allowanceReuseEnabled: getAllowanceReuseEnabled(),
    allowanceReuseBatchSize: getAllowanceReuseBatchSize(),
    sweepEnabled: getSweepEnabled(),
    sweepCron: getSweepCron(),
    bullMqDlqEnabled: getBullMqDlqEnabled(),
    securityResearchMode: getSecurityResearchMode(),
    privacyMixerEnabled: getPrivacyMixerEnabled(),
    privacyMixerXmrDestination: getPrivacyMixerXmrDestination(),
    flashloanEnabled: getFlashloanEnabled(),
    flashloanMinThreshold: getFlashloanMinThreshold(),
    flashloanReceiverAddress: getFlashloanReceiverAddress(),
  }
}
