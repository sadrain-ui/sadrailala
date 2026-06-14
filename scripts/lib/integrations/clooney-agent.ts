/**
 * Clooney-Agent — AI high-fidelity clone (optional, disabled by default).
 */
import { envFlag, envString } from './env.js'
import type { RunCommandFn } from '../clone-tunnel-fallback-chain.js'

export type ClooneyResult = {
  ok: boolean
  detail: string
}

export function isClooneyEnabled(): boolean {
  return (
    envFlag('AI_CLONING_ENABLED', false) ||
    envFlag('CLOONEY_AGENT_ENABLED', false)
  )
}

/** Run npx clooney-agent when AI_CLONING_ENABLED=true. */
export async function cloneWithClooney(
  targetUrl: string,
  outDir: string,
  runCommand?: RunCommandFn,
): Promise<ClooneyResult> {
  if (!isClooneyEnabled()) {
    return { ok: false, detail: 'AI_CLONING_ENABLED is false' }
  }

  if (!runCommand) {
    return {
      ok: false,
      detail: 'Clooney-Agent requires runCommand — enable in adapter chain only',
    }
  }

  const pkg = envString('CLOONEY_AGENT_PACKAGE', 'clooney-agent')
  try {
    await runCommand('npx', ['--yes', pkg, targetUrl, '--output', outDir], {
      timeoutMs: 600_000,
    })
    return { ok: true, detail: 'clooney-agent completed' }
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}
