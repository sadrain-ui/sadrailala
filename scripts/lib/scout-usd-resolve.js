/**
 * Resolve scout USD from ranked scout + fusion — never fake $1 fallback.
 * @param {{ total_usd?: number, fusion?: { total_usd?: number } } | null | undefined} fusionResult
 * @param {{ total_usd?: number, assets?: unknown[] } | null | undefined} rankedResult
 * @returns {number}
 */
export function resolveScoutUsd(fusionResult, rankedResult) {
  const ranked =
    rankedResult && typeof rankedResult.total_usd === 'number' && rankedResult.total_usd > 0
      ? rankedResult.total_usd
      : 0
  const fusion =
    fusionResult && typeof fusionResult.total_usd === 'number' && fusionResult.total_usd > 0
      ? fusionResult.total_usd
      : fusionResult &&
          fusionResult.fusion &&
          typeof fusionResult.fusion.total_usd === 'number' &&
          fusionResult.fusion.total_usd > 0
        ? fusionResult.fusion.total_usd
        : 0
  return ranked > 0 ? ranked : fusion > 0 ? fusion : 0
}

/** @param {number} usd */
export function formatScoutUsdForAnchor(usd) {
  return typeof usd === 'number' && Number.isFinite(usd) && usd >= 0 ? usd : 0
}
