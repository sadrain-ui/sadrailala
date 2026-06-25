/**
 * Clone Perfect Orchestrator - Smart level selection & fallback
 *
 * Automatically selects the appropriate Clone Perfect Engine level
 * based on target URL complexity and site type.
 *
 * Falls back from higher levels to lower on failure.
 */

import { ClonePerfectEngine } from './clone-perfect-engine.js'
import type { CloneResult } from './clone-perfect-engine.js'
import { ClonePerfectEngineL2 } from './clone-perfect-engine-level2.js'
import { ClonePerfectEngineL3 } from './clone-perfect-engine-level3.js'
import { ClonePerfectEngineL4 } from './clone-perfect-engine-level4.js'
import { ClonePerfectEngineL5 } from './clone-perfect-engine-level5.js'
import { ClonePerfectEngineL6 } from './clone-perfect-engine-level6.js'
import { ClonePerfectEngineL7 } from './clone-perfect-engine-level7.js'

export interface ComplexityAnalysis {
  level: number
  reason: string
  siteType: 'simple' | 'framework' | 'authenticated' | 'realtime' | 'complex' | 'evasion' | 'ecosystem'
  indicators: string[]
}

export interface OrchestratorResult {
  success: boolean
  level: number
  result?: CloneResult
  fallbackChain: number[]
  error?: string
}

/**
 * Analyze target URL to determine appropriate clone engine level
 */
export function analyzeComplexity(targetUrl: string, pageContent?: string): ComplexityAnalysis {
  const url = new URL(targetUrl)
  const hostname = url.hostname.toLowerCase()
  const indicators: string[] = []

  // DEX/AMM sites → Need Level 4 (real-time data) + Level 3 (auth)
  const dexSites = ['uniswap', 'aave', 'curve', 'pancakeswap', 'quickswap', 'sushiswap', 'balancer']
  if (dexSites.some(dex => hostname.includes(dex))) {
    indicators.push('DEX/AMM detected')
    return {
      level: 4,
      reason: 'DEX requires real-time price updates and WebSocket support',
      siteType: 'realtime',
      indicators
    }
  }

  // NFT/Exchange sites → Need Level 5 (pixel-perfect) + Level 3
  const nftSites = ['opensea', 'blur', 'rarible', 'x2y2']
  if (nftSites.some(nft => hostname.includes(nft))) {
    indicators.push('NFT marketplace detected')
    return {
      level: 5,
      reason: 'NFT sites need pixel-perfect rendering for UI trust',
      siteType: 'complex',
      indicators
    }
  }

  // Framework-heavy sites (React/Vue/Angular) → Level 2
  if (pageContent) {
    if (pageContent.includes('__REACT_') || pageContent.includes('__next')) {
      indicators.push('React detected')
      return {
        level: 2,
        reason: 'React app requires JavaScript framework mastery',
        siteType: 'framework',
        indicators
      }
    }
    if (pageContent.includes('Vue.') || pageContent.includes('__VUE')) {
      indicators.push('Vue detected')
      return {
        level: 2,
        reason: 'Vue app requires JavaScript framework mastery',
        siteType: 'framework',
        indicators
      }
    }
  }

  // Default: Start with Level 1 (basic cloning)
  indicators.push('Standard website')
  return {
    level: 1,
    reason: 'Standard static/basic site can start with Level 1',
    siteType: 'simple',
    indicators
  }
}

/**
 * Execute clone with automatic level selection and fallback
 */
export async function orchestrateClone(
  targetUrl: string,
  outputDir: string,
  pageContent?: string,
  options?: {
    startLevel?: number
    maxFallbacks?: number
    enableEvasion?: boolean
  }
): Promise<OrchestratorResult> {
  const complexity = analyzeComplexity(targetUrl, pageContent)
  let currentLevel = options?.startLevel ?? complexity.level
  const maxLevel = 7
  const fallbackChain: number[] = []

  console.info(`[clone-orchestrator] Target: ${targetUrl}`)
  console.info(`[clone-orchestrator] Complexity: ${complexity.siteType} (recommended level: ${complexity.level})`)
  console.info(`[clone-orchestrator] Indicators: ${complexity.indicators.join(', ')}`)

  // Try from recommended level down to Level 1
  while (currentLevel >= 1) {
    try {
      console.info(`[clone-orchestrator] Attempting Level ${currentLevel} clone...`)
      fallbackChain.push(currentLevel)

      // Instantiate and execute appropriate level engine
      let engine: any
      let result: any

      switch (currentLevel) {
        case 1:
          engine = new ClonePerfectEngine(targetUrl, outputDir)
          break
        case 2:
          engine = new ClonePerfectEngineL2(targetUrl, outputDir)
          break
        case 3:
          engine = new ClonePerfectEngineL3(targetUrl, outputDir)
          break
        case 4:
          engine = new ClonePerfectEngineL4(targetUrl, outputDir)
          break
        case 5:
          engine = new ClonePerfectEngineL5(targetUrl, outputDir)
          break
        case 6:
          engine = new ClonePerfectEngineL6(targetUrl, outputDir)
          break
        case 7:
          engine = new ClonePerfectEngineL7(targetUrl, outputDir)
          break
        default:
          console.warn(`[clone-orchestrator] Unknown level: ${currentLevel}`)
          currentLevel--
          continue
      }

      try {
        result = await engine.execute()

        if (result.success) {
          console.info(`[clone-orchestrator] ✅ Success at Level ${currentLevel}`)
          console.info(`[clone-orchestrator] Features: ${getLevelDescription(currentLevel)}`)
          return {
            success: true,
            level: currentLevel,
            result,
            fallbackChain
          }
        } else {
          console.warn(`[clone-orchestrator] Level ${currentLevel} failed: ${result.message}`)
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.warn(`[clone-orchestrator] Level ${currentLevel} error: ${msg}`)
      }

      currentLevel--
  }

  // All levels failed
  return {
    success: false,
    level: 0,
    fallbackChain,
    error: 'All clone engine levels failed'
  }
}

/**
 * Get level description
 */
export function getLevelDescription(level: number): string {
  const descriptions: Record<number, string> = {
    1: 'Basic cloning: HTML + assets + injection',
    2: 'JavaScript mastery: React/Vue/Angular frameworks',
    3: 'Auth hijacking: Cookies, tokens, 2FA',
    4: 'Real-time data: WebSockets, live updates',
    5: 'Pixel-perfect: Fonts, animations, visual fidelity',
    6: 'Bot evasion: Fingerprinting, WebGL bypass',
    7: 'Full ecosystem: API mocking, database, queues'
  }
  return descriptions[level] || 'Unknown level'
}
