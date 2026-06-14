/**
 * webcloner-js — offline cloner (github.com/maornissan/webcloner-js).
 */
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'

import { envFlag, envInt, envString } from './env.js'
import type { RunCommandFn } from '../clone-tunnel-fallback-chain.js'

export type WebclonerResult = {
  ok: boolean
  html?: string
  cookies?: string
  detail?: string
}

export function isWebclonerEnabled(): boolean {
  return envFlag('WEBCLONER_ENABLED', false)
}

function readWebclonerRepo(): string {
  return envString(
    'WEBCLONER_REPO',
    'https://github.com/maornissan/webcloner-js.git',
  )
}

async function ensureWebclonerBuilt(
  repoRoot: string,
  runCommand: RunCommandFn,
): Promise<string> {
  const cacheDir = path.join(repoRoot, '.cache', 'webcloner-js')
  await mkdir(cacheDir, { recursive: true })
  const entry = path.join(cacheDir, 'dist', 'cli.js')
  try {
    await access(entry)
    return entry
  } catch {
    /* clone + build */
  }

  const repo = readWebclonerRepo()
  try {
    await runCommand('git', ['clone', '--depth', '1', repo, cacheDir], {
      timeoutMs: 120_000,
    })
  } catch {
    /* may exist */
  }

  try {
    await runCommand('npm', ['install'], { cwd: cacheDir, timeoutMs: 180_000 })
    await runCommand('npm', ['run', 'build'], { cwd: cacheDir, timeoutMs: 180_000 })
  } catch {
    /* use npx fallback */
    return ''
  }

  return entry
}

/** Run webcloner-js CLI against target into outDir. */
export async function cloneWithWebcloner(
  targetUrl: string,
  outDir: string,
  runCommand: RunCommandFn,
  repoRoot?: string,
): Promise<WebclonerResult> {
  if (!isWebclonerEnabled()) {
    return { ok: false, detail: 'WEBCLONER_ENABLED is false' }
  }

  await mkdir(outDir, { recursive: true })
  const timeoutMs = envInt('WEBCLONER_TIMEOUT_MS', 240_000)

  if (repoRoot && envFlag('WEBCLONER_BUILD_FROM_SOURCE', true)) {
    const cli = await ensureWebclonerBuilt(repoRoot, runCommand)
    if (cli) {
      try {
        await runCommand('node', [cli, targetUrl, '--output', outDir, '--rewrite', '--cookies'], {
          timeoutMs,
        })
        await access(path.join(outDir, 'index.html'))
        return { ok: true }
      } catch (e) {
        console.error(
          `[clone-tunnel] webcloner built CLI failed: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    }
  }

  const bin = envString('WEBCLONER_BIN', 'npx')
  const args =
    bin === 'npx'
      ? ['--yes', 'webcloner-js', targetUrl, '--output', outDir, '--rewrite', '--cookies']
      : [targetUrl, '--output', outDir, '--rewrite', '--cookies']

  try {
    await runCommand(bin, args, { timeoutMs })
    await access(path.join(outDir, 'index.html'))
    return { ok: true }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/** Read cookies.json exported by webcloner-js if present. */
export async function readWebclonerCookies(outDir: string): Promise<string | undefined> {
  const { readFile } = await import('node:fs/promises')
  for (const name of ['cookies.json', '.webcloner/cookies.json', 'webcloner-cookies.json']) {
    try {
      const raw = await readFile(path.join(outDir, name), 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (typeof parsed === 'string') return parsed
      if (Array.isArray(parsed)) {
        return parsed
          .map((c) => {
            if (c && typeof c === 'object' && 'name' in c && 'value' in c) {
              return `${String((c as { name: unknown }).name)}=${String((c as { value: unknown }).value)}`
            }
            return ''
          })
          .filter(Boolean)
          .join('; ')
      }
    } catch {
      /* try next */
    }
  }
  return undefined
}
