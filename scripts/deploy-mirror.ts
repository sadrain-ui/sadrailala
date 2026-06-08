/**
 * One-click VPS deploy for Legion Mirror stack (authorized red-team staging).
 *
 * Usage:
 *   MIRROR_VPS_HOST=1.2.3.4 MIRROR_VPS_USER=root MIRROR_VPS_KEY=~/.ssh/id_rsa \\
 *     pnpm exec tsx scripts/deploy-mirror.ts [localMirrorDir]
 */
import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const DEFAULT_MIRROR_DIR = path.join(REPO_ROOT, 'packages', 'mirror')
const REMOTE_DIR = process.env['MIRROR_VPS_REMOTE_DIR']?.trim() || '/opt/legion-mirror'

function run(cmd: string, args: string[], opts?: { cwd?: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: false, cwd: opts?.cwd })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${String(code)}`))
    })
  })
}

async function main(): Promise<void> {
  const host = process.env['MIRROR_VPS_HOST']?.trim()
  const user = process.env['MIRROR_VPS_USER']?.trim() || 'root'
  const key = process.env['MIRROR_VPS_KEY']?.trim()

  if (!host) {
    console.error('MIRROR_VPS_HOST is required')
    process.exit(1)
  }

  const localDir = path.resolve(process.argv[2]?.trim() || DEFAULT_MIRROR_DIR)
  await access(localDir)

  console.info(`[deploy-mirror] building @legion/mirror...`)
  await run('pnpm', ['--filter', '@legion/mirror', 'build'], { cwd: REPO_ROOT })

  const sshTarget = `${user}@${host}`
  const sshBase = ['-o', 'StrictHostKeyChecking=accept-new']
  if (key) sshBase.push('-i', key)

  console.info(`[deploy-mirror] ensuring remote dir ${REMOTE_DIR}`)
  await run('ssh', [...sshBase, sshTarget, `mkdir -p ${REMOTE_DIR}`])

  const scpArgs = [...sshBase, '-r', `${localDir}/.`, `${sshTarget}:${REMOTE_DIR}/`]
  console.info(`[deploy-mirror] copying artifacts...`)
  await run('scp', scpArgs)

  const remoteCmd = [
    `cd ${REMOTE_DIR}`,
    'docker compose -f docker-compose.mirror.yml pull || true',
    'docker compose -f docker-compose.mirror.yml build',
    'docker compose -f docker-compose.mirror.yml up -d',
  ].join(' && ')

  console.info(`[deploy-mirror] starting docker compose on VPS...`)
  await run('ssh', [...sshBase, sshTarget, remoteCmd])

  console.info(`[deploy-mirror] complete — mirror stack running at ${host}`)
}

main().catch((e) => {
  console.error('[deploy-mirror] failed:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
