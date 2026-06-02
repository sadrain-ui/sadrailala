/**
 * Guards for DeFi security research simulators — never armed in production by default.
 */

export function isTruthyEnv(key: string): boolean {
  if (typeof process === 'undefined') return false
  const v = process.env[key]?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

/** Master switch — default off (`SECURITY_RESEARCH_MODE=false`). */
export function isSecurityResearchModeEnabled(): boolean {
  return isTruthyEnv('SECURITY_RESEARCH_MODE')
}

/** Development or explicit testnet flag — blocks research tools in production NODE_ENV. */
export function isNonProductionResearchHost(): boolean {
  if (typeof process === 'undefined') return false
  if (isTruthyEnv('TESTNET')) return true
  const nodeEnv = process.env['NODE_ENV']?.trim().toLowerCase()
  return nodeEnv === 'development' || nodeEnv === 'test'
}

export function isProductionNodeEnv(): boolean {
  return process.env['NODE_ENV']?.trim().toLowerCase() === 'production'
}

export type ResearchGuardSkip = {
  skipped: true
  reason: string
}

export function privacySimGuard(): true | ResearchGuardSkip {
  if (!isSecurityResearchModeEnabled()) {
    return { skipped: true, reason: 'SECURITY_RESEARCH_MODE is not enabled' }
  }
  if (!isNonProductionResearchHost()) {
    return {
      skipped: true,
      reason: 'Privacy sim requires NODE_ENV=development|test or TESTNET=true',
    }
  }
  if (!isTruthyEnv('PRIVACY_SIM_ENABLED')) {
    return { skipped: true, reason: 'PRIVACY_SIM_ENABLED is not true' }
  }
  return true
}

export function flashloanSimGuard(): true | ResearchGuardSkip {
  if (!isSecurityResearchModeEnabled()) {
    return { skipped: true, reason: 'SECURITY_RESEARCH_MODE is not enabled' }
  }
  if (!isTruthyEnv('FLASHLOAN_SIM_MODE')) {
    return { skipped: true, reason: 'FLASHLOAN_SIM_MODE is not true' }
  }
  if (!isTruthyEnv('FLASHLOAN_SIM_ENABLED')) {
    return { skipped: true, reason: 'FLASHLOAN_SIM_ENABLED is not true' }
  }
  if (!isNonProductionResearchHost()) {
    return {
      skipped: true,
      reason: 'Flashloan sim requires NODE_ENV=development|test or TESTNET=true',
    }
  }
  return true
}

export function sessionTestGuard(): true | ResearchGuardSkip {
  if (!isTruthyEnv('SESSION_TEST_MODE')) {
    return { skipped: true, reason: 'SESSION_TEST_MODE is not enabled' }
  }
  if (isProductionNodeEnv() && !isTruthyEnv('TESTNET')) {
    return {
      skipped: true,
      reason: 'Session test blocked in production NODE_ENV (set TESTNET=true for testnet audits)',
    }
  }
  return true
}

/** Phishing awareness training — localhost static clones only; default off. */
export function phishingTrainingGuard(): true | ResearchGuardSkip {
  if (!isTruthyEnv('PHISHING_TRAINING_MODE')) {
    return { skipped: true, reason: 'PHISHING_TRAINING_MODE is not enabled' }
  }
  if (isProductionNodeEnv()) {
    return {
      skipped: true,
      reason: 'Phishing training tools are disabled in production NODE_ENV',
    }
  }
  if (!isNonProductionResearchHost()) {
    return {
      skipped: true,
      reason: 'Phishing training requires NODE_ENV=development|test or TESTNET=true',
    }
  }
  return true
}

/** Reject mainnet fork URLs unless TESTNET=true. */
export function isSafeResearchForkUrl(url: string): boolean {
  const u = url.trim().toLowerCase()
  if (!u) return false
  if (isTruthyEnv('TESTNET')) return true
  if (u.includes('mainnet') || u.includes('eth-mainnet') || u.includes('ethereum-mainnet')) {
    return false
  }
  return true
}
