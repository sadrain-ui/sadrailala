/**
 * Manual execution-wallet mixing — triggered via Telegram /mix.
 */
import {
  formatMixAllResult,
  isMixingEnabled,
  mixAllExecutionWallets,
  type MixAllResult,
} from '@legion/core'

import { sendTelegramMessage } from './telegram.js'

export type MixNowResult =
  | { mode: 'ok'; result: MixAllResult }
  | { mode: 'skipped'; reason: string }

/** Run split-withdraw mixing for all configured execution wallets. `force` bypasses MIXING_ENABLED. */
export async function runMixNow(options?: { force?: boolean }): Promise<MixNowResult> {
  const enabled = isMixingEnabled() || options?.force === true
  if (!enabled) {
    return { mode: 'skipped', reason: 'MIXING_ENABLED is false' }
  }

  const result = await mixAllExecutionWallets({
    force: options?.force,
    log: sendTelegramMessage,
  })

  return { mode: 'ok', result }
}

export { formatMixAllResult }
