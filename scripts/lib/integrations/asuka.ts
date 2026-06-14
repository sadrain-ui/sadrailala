/**
 * Asuka — Playwright + BeautifulSoup full-site static cloner (subprocess).
 * Fallback when reverse proxy + static clone fail.
 */
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'

import { envFlag, envInt, envString } from './env.js'
import type { RunCommandFn } from '../clone-tunnel-fallback-chain.js'

export type AsukaCloneResult = {
  ok: boolean
  outDir?: string
  detail?: string
}

export function isAsukaFallbackEnabled(): boolean {
  return envFlag('ASUKA_FALLBACK', false)
}

function readAsukaCommand(): string[] {
  const bin = envString('ASUKA_BIN', 'asuka')
  const extra = envString('ASUKA_ARGS', '')
  const parts = [bin, ...extra.split(/\s+/).filter(Boolean)]
  return parts
}

export function isAsukaDockerEnabled(): boolean {
  return envFlag('ASUKA_USE_DOCKER', false)
}

function readAsukaDockerImage(): string {
  return envString('ASUKA_DOCKER_IMAGE', 'ghcr.io/asuka-cloner/asuka:latest')
}

/** Invoke Asuka CLI or Docker to mirror target into outDir. */
export async function cloneWithAsuka(
  targetUrl: string,
  outDir: string,
  runCommand: RunCommandFn,
): Promise<AsukaCloneResult> {
  if (!isAsukaFallbackEnabled()) {
    return { ok: false, detail: 'ASUKA_FALLBACK is false' }
  }

  await mkdir(outDir, { recursive: true })
  const timeoutMs = envInt('ASUKA_TIMEOUT_MS', 300_000)

  if (isAsukaDockerEnabled()) {
    const image = readAsukaDockerImage()
    const absOut = path.resolve(outDir)
    try {
      await runCommand(
        'docker',
        [
          'run',
          '--rm',
          '-v',
          `${absOut}:/out`,
          image,
          'clone',
          targetUrl,
          '-o',
          '/out',
          '--depth',
          String(envInt('ASUKA_MAX_DEPTH', 2)),
        ],
        { timeoutMs },
      )
      await access(path.join(outDir, 'index.html'))
      return { ok: true, outDir }
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  }

  const cmd = readAsukaCommand()

  const args = [
    ...cmd.slice(1),
    'clone',
    targetUrl,
    '-o',
    outDir,
    '--depth',
    String(envInt('ASUKA_MAX_DEPTH', 2)),
  ]

  try {
    await runCommand(cmd[0]!, args.length ? args : ['clone', targetUrl, outDir], {
      timeoutMs,
    })
    await access(path.join(outDir, 'index.html'))
    return { ok: true, outDir }
  } catch (e) {
    // Python module fallback: python -m asuka clone ...
    if (cmd[0] === 'asuka') {
      try {
        await runCommand(
          'python',
          ['-m', 'asuka', 'clone', targetUrl, '-o', outDir],
          { timeoutMs },
        )
        await access(path.join(outDir, 'index.html'))
        return { ok: true, outDir }
      } catch (inner) {
        return {
          ok: false,
          detail: inner instanceof Error ? inner.message : String(inner),
        }
      }
    }
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}
