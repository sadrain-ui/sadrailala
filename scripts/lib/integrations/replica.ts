/**
 * Replica — TLS-fingerprint reverse proxy (optional nginx replacement).
 * Image: ghcr.io/sarperavci/replica:latest
 */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { envFlag, envInt, envString } from './env.js'
import type { RunCommandFn } from '../clone-tunnel-fallback-chain.js'
import {
  probeLocalMirrorHealth,
  waitForDockerContainerHealthy,
} from '../clone-tunnel-resilience.js'

export function isReplicaEnabled(): boolean {
  return envFlag('USE_REPLICA', false)
}

export function readReplicaListenPort(): number {
  return envInt('REPLICA_PORT', 8081)
}

function parseRewriteRules(): string[] {
  const raw = envString('REPLICA_REWRITE_RULES', '')
  if (!raw.trim()) {
    return [
      'inject:legion-authorized-drain.css:link',
      'inject:legion-authorized-drain.js:script',
    ]
  }
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

export type ReplicaDeployOpts = {
  outDir: string
  targetUrl: string
  hostPort: number
  injectScriptPath?: string
  runCommand: RunCommandFn
}

/** Write Replica config + docker-compose overlay for the clone output dir. */
export async function writeReplicaMirrorArtifacts(opts: ReplicaDeployOpts): Promise<void> {
  const target = new URL(opts.targetUrl)
  const image = envString(
    'REPLICA_DOCKER_IMAGE',
    'ghcr.io/sarperavci/replica:latest',
  )
  const listenPort = readReplicaListenPort()
  const rewriteRules = parseRewriteRules()

  const config = {
    listen: `0.0.0.0:${listenPort}`,
    target: target.origin,
    target_host: target.host,
    tls_profile: envString('REPLICA_TLS_PROFILE', 'chrome120'),
    rewrite: true,
    rewrite_rules: rewriteRules,
    inject_head: [
      '<link rel="stylesheet" href="/legion-authorized-drain.css" />',
      '<script src="/legion-authorized-drain.js" defer></script>',
    ].join('\n'),
    static_dir: '/mirror/html',
    upstream_cookies: process.env['MIRROR_PROXY_COOKIES'] ?? undefined,
    upstream_user_agent: process.env['MIRROR_PROXY_USER_AGENT'] ?? undefined,
  }

  await mkdir(opts.outDir, { recursive: true })
  await writeFile(
    path.join(opts.outDir, 'replica-config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  )

  const compose = `# Replica TLS reverse proxy — USE_REPLICA=true
services:
  replica-proxy:
    image: ${image}
    command: ["--config", "/etc/replica/config.json", "--rewrite"]
    ports:
      - "${opts.hostPort}:${listenPort}"
    volumes:
      - ./replica-config.json:/etc/replica/config.json:ro
      - .:/mirror/html:ro
    environment:
      REPLICA_CONFIG: /etc/replica/config.json
      REPLICA_REWRITE_RULES: ${rewriteRules.join(';')}
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:${listenPort}/mirror-health || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 12
`
  await writeFile(path.join(opts.outDir, 'docker-compose.yml'), compose, 'utf8')
}

/** Start Replica docker stack and probe local health. */
export async function tryReplicaMirrorStack(opts: ReplicaDeployOpts): Promise<boolean> {
  if (!isReplicaEnabled()) return false
  if (!existsSync(path.join(opts.outDir, 'docker-compose.yml'))) return false

  try {
    try {
      await opts.runCommand('docker', ['compose', 'down'], {
        cwd: opts.outDir,
        timeoutMs: 30_000,
      })
    } catch {
      /* first run */
    }
    await opts.runCommand('docker', ['compose', 'up', '-d'], {
      cwd: opts.outDir,
      timeoutMs: 120_000,
    })
    const container = await waitForDockerContainerHealthy(opts.outDir)
    if (!container.ok) return false
    const health = await probeLocalMirrorHealth(opts.hostPort)
    return health.ok
  } catch (e) {
    console.error(
      `[clone-tunnel] Replica stack failed: ${e instanceof Error ? e.message : String(e)}`,
    )
    return false
  }
}
