import { isValidEvmExecutionPrivateKey } from '@legion/core'
import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

/** Resolve monorepo root whether cwd is repo root, apps/api, or dist/. */
function resolveRepoRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), '../..'),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd()),
    path.resolve(moduleDir, '../../../..'),
    path.resolve(moduleDir, '../../../../..'),
  ]

  for (const candidate of candidates) {
    const pkg = path.join(candidate, 'package.json')
    if (fs.existsSync(pkg)) {
      try {
        const raw = fs.readFileSync(pkg, 'utf8')
        const parsed = JSON.parse(raw) as { name?: string }
        if (parsed.name === 'legion-engine') return candidate
      } catch {
        /* try next */
      }
    }
  }

  return path.resolve(process.cwd(), '../..')
}

function isProductionMode(): boolean {
  return (
    process.env['NODE_ENV'] === 'production' ||
    process.env['PROD'] === '1' ||
    process.env['PROD']?.toLowerCase() === 'true'
  )
}

function loadEnvFiles(): void {
  const rootPath = resolveRepoRoot()
  const isProd = isProductionMode()

  const baseFiles = [
    path.join(rootPath, '.env'),
    path.join(rootPath, '.env.local'),
  ]

  for (const file of baseFiles) {
    if (fs.existsSync(file)) {
      dotenv.config({ path: file, override: !isProd })
      console.log(`[ENV] Loaded: ${file}`)
    }
  }

  if (!isProductionMode()) {
    const devFile = path.join(rootPath, '.env.development')
    if (fs.existsSync(devFile)) {
      dotenv.config({ path: devFile, override: true })
      console.log(`[ENV] Loaded: ${devFile}`)
    }
  }
}

function validateRequiredEnv(): void {
  const modeLabel = isProductionMode() ? 'production' : 'development'
  const required = {
    development: ['DATABASE_URL'],
    production: ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'SHADOW_VAULT_KEY'],
  }

  const requiredVars = isProductionMode() ? required.production : required.development
  const missing = requiredVars.filter((v) => !process.env[v]?.trim())

  if (missing.length > 0) {
    console.error(
      `FATAL_ENV_VALIDATION: Missing required environment variables for ${modeLabel}:\n` +
        missing.map((v) => `  - ${v}`).join('\n') +
        '\nSet them in .env, .env.local, .env.development (development only), platform env (Vercel/Railway), or: node --env-file=.env --env-file=.env.development dist/index.js',
    )
    process.exit(1)
  }
}

function validateSettlementEnv(): void {
  const prod = isProductionMode()
  const evmKey = process.env['SETTLEMENT_EXECUTION_PRIVATE_KEY']?.trim() ?? ''
  const solKey = process.env['SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY']?.trim() ?? ''

  if (prod) {
    if (!isValidEvmExecutionPrivateKey(evmKey)) {
      if (!evmKey) {
        console.error(
          'FATAL_ENV_VALIDATION: SETTLEMENT_EXECUTION_PRIVATE_KEY is required in production for EVM settlement broadcast.\n' +
            'Provide a dedicated hot-wallet key as 48–64 hexadecimal characters (optional 0x prefix; padded to 32 bytes).\n' +
            'Do not commit this value. Set it in platform env (Vercel/Railway) or .env with NODE_ENV=production.',
        )
      } else {
        console.error(
          'FATAL_ENV_VALIDATION: SETTLEMENT_EXECUTION_PRIVATE_KEY is invalid (expected 48–64 hex characters, optional 0x prefix).',
        )
      }
      process.exit(1)
    }
  } else if (!isValidEvmExecutionPrivateKey(evmKey)) {
    console.warn(
      'SETTLEMENT_WARNING: SETTLEMENT_EXECUTION_PRIVATE_KEY is unset or invalid — EVM on-chain settlement broadcast is disabled. Signature anchor and HTTP routes will still run.',
    )
  }

  if (!solKey) {
    console.warn(
      'SETTLEMENT_WARNING: SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY is unset — Solana settlement broadcast is disabled.',
    )
  }
}

export function loadEnvironment(): void {
  loadEnvFiles()
  validateRequiredEnv()
  validateSettlementEnv()
}
