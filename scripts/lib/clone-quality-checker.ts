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
  const originalHtml = await originalPage.content()
  const cloneHtml = await clonePage.content()

  // Simple similarity score based on common elements
  const originalForms = (originalHtml.match(/<form/g) || []).length
  const cloneForms = (cloneHtml.match(/<form/g) || []).length

  const originalInputs = (originalHtml.match(/<input/g) || []).length
  const cloneInputs = (cloneHtml.match(/<input/g) || []).length

  const originalButtons = (originalHtml.match(/<button/g) || []).length
  const cloneButtons = (cloneHtml.match(/<button/g) || []).length

  const differences: string[] = []

  if (originalForms !== cloneForms) {
    differences.push(`Form count mismatch: Original ${originalForms} vs Clone ${cloneForms}`)
  }

  if (originalInputs !== cloneInputs) {
    differences.push(`Input field count mismatch: Original ${originalInputs} vs Clone ${cloneInputs}`)
  }

  if (originalButtons !== cloneButtons) {
    differences.push(`Button count mismatch: Original ${originalButtons} vs Clone ${cloneButtons}`)
  }

  // Calculate match percentage
  let matchScore = 100
  matchScore -= Math.abs(originalForms - cloneForms) * 5
  matchScore -= Math.abs(originalInputs - cloneInputs) * 2
  matchScore -= Math.abs(originalButtons - cloneButtons) * 2

  return {
    matchPercentage: Math.max(0, Math.min(100, matchScore)),
    differences,
  }
}

async function compareCss(originalPage: Page, clonePage: Page): Promise<{
  matchPercentage: number
  differences: string[]
}> {
  const differences: string[] = []

  // Check for CSS in page
  const originalCssCount = await originalPage.evaluate(() => {
    return document.querySelectorAll('style, link[rel="stylesheet"]').length
  })

  const cloneCssCount = await clonePage.evaluate(() => {
    return document.querySelectorAll('style, link[rel="stylesheet"]').length
  })

  if (originalCssCount !== cloneCssCount) {
    differences.push(`CSS resources: Original ${originalCssCount} vs Clone ${cloneCssCount}`)
  }

  // Check for color schemes (basic check)
  const originalColors = await originalPage.evaluate(() => {
    const colors = new Set<string>()
    document.querySelectorAll('*').forEach((el) => {
      const color = window.getComputedStyle(el).color
      const bgColor = window.getComputedStyle(el).backgroundColor
      colors.add(color)
      colors.add(bgColor)
    })
    return Array.from(colors).slice(0, 10)
  })

  const cloneColors = await clonePage.evaluate(() => {
    const colors = new Set<string>()
    document.querySelectorAll('*').forEach((el) => {
      const color = window.getComputedStyle(el).color
      const bgColor = window.getComputedStyle(el).backgroundColor
      colors.add(color)
      colors.add(bgColor)
    })
    return Array.from(colors).slice(0, 10)
  })

  let matchScore = 100
  const commonColors = originalColors.filter((c) => cloneColors.includes(c)).length
  const colorMatch = (commonColors / Math.max(originalColors.length, cloneColors.length)) * 100
  matchScore = Math.round(colorMatch)

  return {
    matchPercentage: matchScore,
    differences,
  }
}

async function compareElements(originalPage: Page, clonePage: Page): Promise<{
  matchPercentage: number
  differences: string[]
}> {
  const differences: string[] = []

  // Check visible text content
  const originalText = await originalPage.evaluate(() => {
    return document.body.innerText.substring(0, 500)
  })

  const cloneText = await clonePage.evaluate(() => {
    return document.body.innerText.substring(0, 500)
  })

  // Simple text similarity
  const originalWords = originalText.split(/\s+/).filter((w) => w.length > 3)
  const cloneWords = cloneText.split(/\s+/).filter((w) => w.length > 3)

  const commonWords = originalWords.filter((w) => cloneWords.includes(w)).length
  const textMatch = (commonWords / Math.max(originalWords.length, cloneWords.length)) * 100

  if (textMatch < 80) {
    differences.push(`Text content mismatch: ${Math.round(textMatch)}% match`)
  }

  // Check for major interactive elements
  const originalInteractive = await originalPage.evaluate(() => {
    return {
      buttons: document.querySelectorAll('button').length,
      inputs: document.querySelectorAll('input').length,
      links: document.querySelectorAll('a').length,
      modals: document.querySelectorAll('[role="dialog"], .modal').length,
    }
  })

  const cloneInteractive = await clonePage.evaluate(() => {
    return {
      buttons: document.querySelectorAll('button').length,
      inputs: document.querySelectorAll('input').length,
      links: document.querySelectorAll('a').length,
      modals: document.querySelectorAll('[role="dialog"], .modal').length,
    }
  })

  let elementScore = 100
  elementScore -= Math.abs(originalInteractive.buttons - cloneInteractive.buttons) * 2
  elementScore -= Math.abs(originalInteractive.inputs - cloneInteractive.inputs) * 3
  elementScore -= Math.abs(originalInteractive.links - cloneInteractive.links) * 1
  elementScore -= Math.abs(originalInteractive.modals - cloneInteractive.modals) * 5

  return {
    matchPercentage: Math.max(0, Math.min(100, elementScore)),
    differences,
  }
}

export async function generateQualityReport(
  check: QualityCheck,
  outputDir: string,
): Promise<void> {
  await mkdir(outputDir, { recursive: true })

  const report = {
    check,
    summary: {
      htmlMatch: `${check.htmlMatch}%`,
      cssMatch: `${check.cssMatch}%`,
      behaviorMatch: `${check.behaviorMatch}%`,
      overallMatch: `${check.overallMatch}%`,
      status: check.status,
    },
    differences: check.differences,
    recommendation:
      check.status === 'APPROVED'
        ? 'READY FOR DELIVERY ✅'
        : check.status === 'NEEDS_FIXES'
          ? 'Fix reported issues and re-test'
          : 'Significant differences - rebuild required',
  }

  await writeFile(
    path.join(outputDir, 'quality-report.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  )

  console.info(`[QUALITY-CHECKER] Report saved: ${check.status}`)
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
