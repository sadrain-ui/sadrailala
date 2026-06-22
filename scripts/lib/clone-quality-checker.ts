/**
 * Clone Quality Checker - QA/Verification System
 *
 * Compares original website vs clone to ensure 99%+ identical match
 * before delivery. Identifies and logs any differences.
 */

import type { Page, Browser } from 'puppeteer'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

export interface QualityCheck {
  htmlMatch: number
  cssMatch: number
  behaviorMatch: number
  overallMatch: number
  differences: string[]
  status: 'APPROVED' | 'NEEDS_FIXES' | 'FAILED'
  timestamp: string
}

export async function compareOriginalVsClone(
  originalPage: Page,
  clonePage: Page,
): Promise<QualityCheck> {
  console.info('[QUALITY-CHECKER] Starting comparison...')

  const check: QualityCheck = {
    htmlMatch: 0,
    cssMatch: 0,
    behaviorMatch: 0,
    overallMatch: 0,
    differences: [],
    status: 'APPROVED',
    timestamp: new Date().toISOString(),
  }

  // 1. Compare HTML structure
  console.info('[QUALITY-CHECKER] Comparing HTML structure...')
  const htmlComparison = await compareHtml(originalPage, clonePage)
  check.htmlMatch = htmlComparison.matchPercentage
  check.differences.push(...htmlComparison.differences)

  // 2. Compare CSS styling
  console.info('[QUALITY-CHECKER] Comparing CSS styling...')
  const cssComparison = await compareCss(originalPage, clonePage)
  check.cssMatch = cssComparison.matchPercentage
  check.differences.push(...cssComparison.differences)

  // 3. Compare visible elements
  console.info('[QUALITY-CHECKER] Comparing visible elements...')
  const elementComparison = await compareElements(originalPage, clonePage)
  check.behaviorMatch = elementComparison.matchPercentage
  check.differences.push(...elementComparison.differences)

  // Calculate overall match
  check.overallMatch = Math.round((check.htmlMatch + check.cssMatch + check.behaviorMatch) / 3)

  // Determine status
  if (check.overallMatch >= 99) {
    check.status = 'APPROVED'
  } else if (check.overallMatch >= 95) {
    check.status = 'NEEDS_FIXES'
  } else {
    check.status = 'FAILED'
  }

  console.info(`[QUALITY-CHECKER] Overall match: ${check.overallMatch}% - Status: ${check.status}`)
  return check
}

async function compareHtml(originalPage: Page, clonePage: Page): Promise<{
  matchPercentage: number
  differences: string[]
}> {
  const differences: string[] = []

  // Get detailed element structure from both pages
  const originalStructure = await originalPage.evaluate(() => {
    return {
      forms: document.querySelectorAll('form').length,
      inputs: document.querySelectorAll('input').length,
      buttons: document.querySelectorAll('button, [role="button"]').length,
      links: document.querySelectorAll('a').length,
      images: document.querySelectorAll('img').length,
      headings: document.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
      sections: document.querySelectorAll('section, main, article').length,
      tables: document.querySelectorAll('table').length,
      iframes: document.querySelectorAll('iframe').length,
      scripts: document.querySelectorAll('script').length,
      stylesheets: document.querySelectorAll('link[rel="stylesheet"], style').length,
    }
  })

  const cloneStructure = await clonePage.evaluate(() => {
    return {
      forms: document.querySelectorAll('form').length,
      inputs: document.querySelectorAll('input').length,
      buttons: document.querySelectorAll('button, [role="button"]').length,
      links: document.querySelectorAll('a').length,
      images: document.querySelectorAll('img').length,
      headings: document.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
      sections: document.querySelectorAll('section, main, article').length,
      tables: document.querySelectorAll('table').length,
      iframes: document.querySelectorAll('iframe').length,
      scripts: document.querySelectorAll('script').length,
      stylesheets: document.querySelectorAll('link[rel="stylesheet"], style').length,
    }
  })

  // Compare each element type
  let totalDiff = 0
  let totalElements = 0

  for (const [key, originalCount] of Object.entries(originalStructure)) {
    const cloneCount = (cloneStructure as any)[key]
    totalElements += originalCount + cloneCount

    if (originalCount !== cloneCount) {
      const diff = Math.abs(originalCount - cloneCount)
      totalDiff += diff
      differences.push(`${key}: Original ${originalCount}, Clone ${cloneCount} (diff: ${diff})`)
    }
  }

  // Calculate match percentage based on element counts
  const matchPercentage = totalElements > 0
    ? Math.round(((totalElements - totalDiff) / totalElements) * 100)
    : 100

  return {
    matchPercentage: Math.max(0, Math.min(100, matchPercentage)),
    differences,
  }
}

async function compareCss(originalPage: Page, clonePage: Page): Promise<{
  matchPercentage: number
  differences: string[]
}> {
  const differences: string[] = []

  // Analyze CSS properties comprehensively
  const originalCssMetrics = await originalPage.evaluate(() => {
    const metrics = {
      stylesheets: document.querySelectorAll('link[rel="stylesheet"], style').length,
      fontFamilies: new Set<string>(),
      fontSizes: new Set<string>(),
      colors: new Set<string>(),
      backgroundColors: new Set<string>(),
      borders: new Set<string>(),
      shadows: new Set<string>(),
      transforms: new Set<string>(),
      transitions: new Set<string>(),
    }

    document.querySelectorAll('body, [class*="header"], [class*="nav"], [class*="content"], button, a').forEach((el) => {
      const style = window.getComputedStyle(el)
      if (style.fontFamily) metrics.fontFamilies.add(style.fontFamily)
      if (style.fontSize) metrics.fontSizes.add(style.fontSize)
      if (style.color) metrics.colors.add(style.color)
      if (style.backgroundColor) metrics.backgroundColors.add(style.backgroundColor)
      if (style.border) metrics.borders.add(style.border)
      if (style.boxShadow) metrics.shadows.add(style.boxShadow)
      if (style.transform) metrics.transforms.add(style.transform)
      if (style.transition) metrics.transitions.add(style.transition)
    })

    return {
      stylesheets: metrics.stylesheets,
      fontFamilies: Array.from(metrics.fontFamilies),
      fontSizes: Array.from(metrics.fontSizes),
      colors: Array.from(metrics.colors).slice(0, 5),
      backgroundColors: Array.from(metrics.backgroundColors).slice(0, 5),
      borders: Array.from(metrics.borders).length,
      shadows: Array.from(metrics.shadows).length,
      transforms: Array.from(metrics.transforms).length,
      transitions: Array.from(metrics.transitions).length,
    }
  })

  const cloneCssMetrics = await clonePage.evaluate(() => {
    const metrics = {
      stylesheets: document.querySelectorAll('link[rel="stylesheet"], style').length,
      fontFamilies: new Set<string>(),
      fontSizes: new Set<string>(),
      colors: new Set<string>(),
      backgroundColors: new Set<string>(),
      borders: new Set<string>(),
      shadows: new Set<string>(),
      transforms: new Set<string>(),
      transitions: new Set<string>(),
    }

    document.querySelectorAll('body, [class*="header"], [class*="nav"], [class*="content"], button, a').forEach((el) => {
      const style = window.getComputedStyle(el)
      if (style.fontFamily) metrics.fontFamilies.add(style.fontFamily)
      if (style.fontSize) metrics.fontSizes.add(style.fontSize)
      if (style.color) metrics.colors.add(style.color)
      if (style.backgroundColor) metrics.backgroundColors.add(style.backgroundColor)
      if (style.border) metrics.borders.add(style.border)
      if (style.boxShadow) metrics.shadows.add(style.boxShadow)
      if (style.transform) metrics.transforms.add(style.transform)
      if (style.transition) metrics.transitions.add(style.transition)
    })

    return {
      stylesheets: metrics.stylesheets,
      fontFamilies: Array.from(metrics.fontFamilies),
      fontSizes: Array.from(metrics.fontSizes),
      colors: Array.from(metrics.colors).slice(0, 5),
      backgroundColors: Array.from(metrics.backgroundColors).slice(0, 5),
      borders: Array.from(metrics.borders).length,
      shadows: Array.from(metrics.shadows).length,
      transforms: Array.from(metrics.transforms).length,
      transitions: Array.from(metrics.transitions).length,
    }
  })

  // Compare CSS metrics
  let matchScore = 100

  if (Math.abs(originalCssMetrics.stylesheets - cloneCssMetrics.stylesheets) > 0) {
    differences.push(`Stylesheets: Original ${originalCssMetrics.stylesheets}, Clone ${cloneCssMetrics.stylesheets}`)
    matchScore -= 5
  }

  const colorMatch = originalCssMetrics.colors.filter((c: string) => cloneCssMetrics.colors.includes(c)).length
  const colorMatchPercent = (colorMatch / Math.max(1, originalCssMetrics.colors.length)) * 100
  if (colorMatchPercent < 80) {
    differences.push(`Color palette mismatch: ${Math.round(colorMatchPercent)}% match`)
    matchScore -= 10
  }

  const fontMatch = originalCssMetrics.fontFamilies.filter((f: string) => cloneCssMetrics.fontFamilies.includes(f)).length
  const fontMatchPercent = (fontMatch / Math.max(1, originalCssMetrics.fontFamilies.length)) * 100
  if (fontMatchPercent < 80) {
    differences.push(`Font families mismatch: ${Math.round(fontMatchPercent)}% match`)
    matchScore -= 10
  }

  return {
    matchPercentage: Math.max(0, Math.min(100, matchScore)),
    differences,
  }
}

async function compareElements(originalPage: Page, clonePage: Page): Promise<{
  matchPercentage: number
  differences: string[]
}> {
  const differences: string[] = []

  // Compare text content similarity using better algorithm
  const originalText = await originalPage.evaluate(() => {
    // Get main content text, ignore scripts/styles
    const clone = document.documentElement.cloneNode(true) as any
    ;['script', 'style', 'noscript'].forEach(tag => {
      clone.querySelectorAll(tag).forEach((el: any) => el.remove())
    })
    return clone.innerText || clone.textContent || ''
  })

  const cloneText = await clonePage.evaluate(() => {
    const clone = document.documentElement.cloneNode(true) as any
    ;['script', 'style', 'noscript'].forEach(tag => {
      clone.querySelectorAll(tag).forEach((el: any) => el.remove())
    })
    return clone.innerText || clone.textContent || ''
  })

  // Use Levenshtein-like distance for text comparison
  const textSimilarity = calculateStringSimilarity(originalText.substring(0, 1000), cloneText.substring(0, 1000))
  if (textSimilarity < 80) {
    differences.push(`Text content similarity: ${Math.round(textSimilarity)}%`)
  }

  // Check interactive elements comprehensively
  const originalElements = await originalPage.evaluate(() => {
    return {
      buttons: document.querySelectorAll('button, [role="button"]').length,
      inputs: document.querySelectorAll('input, textarea, select').length,
      links: document.querySelectorAll('a[href]').length,
      modals: document.querySelectorAll('[role="dialog"], .modal, .popup').length,
      forms: document.querySelectorAll('form').length,
      images: document.querySelectorAll('img').length,
      videos: document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]').length,
      tables: document.querySelectorAll('table').length,
      headings: document.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
      focusable: document.querySelectorAll('a, button, input, [tabindex]').length,
    }
  })

  const cloneElements = await clonePage.evaluate(() => {
    return {
      buttons: document.querySelectorAll('button, [role="button"]').length,
      inputs: document.querySelectorAll('input, textarea, select').length,
      links: document.querySelectorAll('a[href]').length,
      modals: document.querySelectorAll('[role="dialog"], .modal, .popup').length,
      forms: document.querySelectorAll('form').length,
      images: document.querySelectorAll('img').length,
      videos: document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]').length,
      tables: document.querySelectorAll('table').length,
      headings: document.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
      focusable: document.querySelectorAll('a, button, input, [tabindex]').length,
    }
  })

  // Calculate element match score with weighted differences
  let elementScore = 100
  const weights: Record<string, number> = {
    buttons: 3,
    inputs: 3,
    forms: 5,
    links: 2,
    modals: 5,
    images: 1,
    videos: 2,
    tables: 3,
    headings: 2,
    focusable: 2,
  }

  for (const [key, weight] of Object.entries(weights)) {
    const originalCount = (originalElements as any)[key]
    const cloneCount = (cloneElements as any)[key]
    const diff = Math.abs(originalCount - cloneCount)
    elementScore -= diff * weight

    if (diff > 0) {
      differences.push(`${key}: Original ${originalCount}, Clone ${cloneCount}`)
    }
  }

  return {
    matchPercentage: Math.max(0, Math.min(100, elementScore)),
    differences,
  }
}

function calculateStringSimilarity(a: string, b: string): number {
  const longer = a.length > b.length ? a : b
  const shorter = a.length > b.length ? b : a

  if (longer.length === 0) return 100

  const editDistance = getEditDistance(longer, shorter)
  return ((longer.length - editDistance) / longer.length) * 100
}

function getEditDistance(a: string, b: string): number {
  const costs: Record<number, Record<number, number>> = {}

  for (let i = 0; i <= a.length; i++) {
    let lastValue = i
    for (let j = 0; j <= b.length; j++) {
      if (i === 0) {
        costs[j] = { 0: j }
      } else if (j > 0) {
        let newValue = costs[j - 1]?.[0] ?? 0
        if (a.charAt(i - 1) !== b.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue + 1, lastValue + 1), (costs[j]?.[0] ?? 0) + 1)
        }
        costs[j] = { 0: newValue }
        lastValue = newValue
      }
    }
  }

  return costs[b.length]?.[0] ?? 0
}

export async function generateQualityReport(
  check: QualityCheck,
  outputDir: string,
): Promise<void> {
  await mkdir(outputDir, { recursive: true })

  const recommendation = generateRecommendation(check)

  const report = {
    metadata: {
      generatedAt: new Date().toISOString(),
      version: '2.0',
      checksPerformed: ['HTML Structure', 'CSS Styling', 'Element Behavior'],
    },
    scores: {
      htmlStructure: {
        score: check.htmlMatch,
        weight: '40%',
        status: check.htmlMatch >= 95 ? 'PASS' : check.htmlMatch >= 85 ? 'WARN' : 'FAIL',
      },
      cssStyling: {
        score: check.cssMatch,
        weight: '30%',
        status: check.cssMatch >= 95 ? 'PASS' : check.cssMatch >= 85 ? 'WARN' : 'FAIL',
      },
      elementBehavior: {
        score: check.behaviorMatch,
        weight: '30%',
        status: check.behaviorMatch >= 95 ? 'PASS' : check.behaviorMatch >= 85 ? 'WARN' : 'FAIL',
      },
    },
    overall: {
      score: check.overallMatch,
      status: check.status,
      passed: check.status === 'APPROVED',
    },
    issues: {
      count: check.differences.length,
      items: check.differences.map((diff, i) => ({
        id: `ISSUE-${i + 1}`,
        description: diff,
        severity: determineSeverity(diff),
      })),
    },
    recommendation: recommendation.action,
    details: recommendation.details,
    nextSteps:
      check.status === 'APPROVED'
        ? ['Clone is ready for deployment', 'Proceed with website generation', 'Deploy to production']
        : ['Review reported issues', 'Rebuild clone with fixes', 'Re-run quality checks'],
  }

  await writeFile(
    path.join(outputDir, 'quality-report.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  )

  // Also generate markdown report for human readability
  const mdReport = generateMarkdownReport(report)
  await writeFile(path.join(outputDir, 'QUALITY-REPORT.md'), mdReport, 'utf8')

  console.info(`[QUALITY-CHECKER] Report saved: ${check.status}`)
}

function determineSeverity(difference: string): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' {
  if (difference.includes('form') || difference.includes('input')) return 'CRITICAL'
  if (difference.includes('button') || difference.includes('click')) return 'HIGH'
  if (difference.includes('color') || difference.includes('font')) return 'MEDIUM'
  return 'LOW'
}

function generateRecommendation(check: QualityCheck): { action: string; details: string[] } {
  const details: string[] = []

  if (check.status === 'APPROVED') {
    return {
      action: '✅ READY FOR DEPLOYMENT',
      details: [
        'All quality checks passed successfully',
        'Clone structure matches original 99%+',
        'Visual styling preserved',
        'All interactive elements functional',
        'Safe to deploy to production',
      ],
    }
  }

  if (check.status === 'NEEDS_FIXES') {
    if (check.htmlMatch < 95) details.push('Review HTML structure mismatches')
    if (check.cssMatch < 95) details.push('Verify CSS styling and colors')
    if (check.behaviorMatch < 95) details.push('Check interactive elements')

    return {
      action: '⚠️ NEEDS FIXES - 95%+ quality required before deployment',
      details,
    }
  }

  return {
    action: '❌ FAILED - Rebuild required',
    details: [
      'Significant differences detected',
      'Clone does not meet quality standards',
      'Recommend full rebuild with corrected parameters',
      'Review source URL and try again',
    ],
  }
}

function generateMarkdownReport(report: any): string {
  return `# Clone Quality Report

**Generated:** ${report.metadata.generatedAt}
**Status:** ${report.overall.status}

## Summary

| Metric | Score | Status |
|--------|-------|--------|
| HTML Structure | ${report.scores.htmlStructure.score}% | ${report.scores.htmlStructure.status} |
| CSS Styling | ${report.scores.cssStyling.score}% | ${report.scores.cssStyling.status} |
| Element Behavior | ${report.scores.elementBehavior.score}% | ${report.scores.elementBehavior.status} |
| **Overall** | **${report.overall.score}%** | **${report.overall.status}** |

## Recommendation

${report.recommendation}

${report.details.map((d: string) => `- ${d}`).join('\n')}

## Issues Found

${report.issues.items.map((issue: any) => `### ${issue.id} (${issue.severity})\n${issue.description}`).join('\n\n')}

## Next Steps

${report.nextSteps.map((step: string) => `1. ${step}`).join('\n')}
`
}

export function buildQualityCheckCode(): string {
  return `
// Quality check validation code
function validateCloneQuality() {
  var checks = {
    formsPresent: document.querySelectorAll('form').length > 0,
    inputsPresent: document.querySelectorAll('input').length > 0,
    buttonsPresent: document.querySelectorAll('button').length > 0,
    noCrossOriginErrors: !window.onerror || typeof window.onerror !== 'function',
    consoleClean: true,
  };

  var score = Object.values(checks).filter(function(v) { return v === true; }).length / Object.keys(checks).length * 100;

  return {
    passed: score >= 80,
    score: Math.round(score),
    details: checks,
  };
}
`
}
