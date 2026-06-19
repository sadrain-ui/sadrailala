/**
 * Wallet Flow Recorder - Records actual user interactions and wallet connection flows
 * from rendered websites to create replayable sequences in clones.
 *
 * Records:
 * - Button clicks and their effects
 * - Dialog/modal appearances
 * - Form inputs and submissions
 * - DOM state changes after each interaction
 * - Screenshots of each state
 * - Redirects and navigation
 * - Multi-step connection flows
 */

import type { Page, Browser } from 'puppeteer'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

export interface InteractionStep {
  stepNumber: number
  action: string // 'click', 'input', 'wait', 'screenshot'
  selector?: string
  value?: string
  description: string
  timestamp: number
  domSnapshot?: string
  screenshot?: string
  resultingUI?: string
  urlBefore?: string
  urlAfter?: string
  newElementsAppeared?: string[]
  elementsRemoved?: string[]
}

export interface WalletFlow {
  walletType: string // 'metamask', 'phantom', etc.
  flowName: string
  startButton?: string // selector of the "connect" button
  steps: InteractionStep[]
  totalSteps: number
  successCriteria?: string
  captureTime: string
}

export interface CapturedFlows {
  website: string
  flows: WalletFlow[]
  totalFlows: number
  capturedAt: string
  replayCode?: string
}

export async function recordWalletConnectionFlows(
  page: Page,
  browser: Browser,
  outputDir: string,
): Promise<CapturedFlows> {
  console.info('[FLOW-RECORDER] Starting interaction recording...')

  const flows: WalletFlow[] = []
  const capturedAt = new Date().toISOString()
  const website = page.url()

  // Find all wallet connection buttons
  const connectButtons = await findConnectButtons(page)
  console.info('[FLOW-RECORDER] Found connection buttons:', connectButtons.length)

  // Record flow for each button found
  for (const button of connectButtons) {
    try {
      const flow = await recordConnectionFlow(page, browser, button, outputDir)
      if (flow) {
        flows.push(flow)
        console.info(`[FLOW-RECORDER] Recorded flow for: ${flow.walletType}`)
      }
    } catch (e) {
      console.warn(`[FLOW-RECORDER] Failed to record flow: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Generate replay code
  const replayCode = generateReplayCode(flows)

  const captured: CapturedFlows = {
    website,
    flows,
    totalFlows: flows.length,
    capturedAt,
    replayCode,
  }

  // Save flows to JSON
  await writeFile(
    path.join(outputDir, 'captured-flows.json'),
    JSON.stringify(captured, null, 2),
    'utf8',
  )

  return captured
}

async function findConnectButtons(page: Page): Promise<Array<{ selector: string; text: string }>> {
  const buttons = await page.evaluate(() => {
    const results: Array<{ selector: string; text: string }> = []
    const walletKeywords = [
      'connect',
      'wallet',
      'metamask',
      'phantom',
      'solflare',
      'tronlink',
      'ledger',
      'trezor',
      'walletconnect',
      'web3',
    ]

    // Find buttons with wallet-related text
    document.querySelectorAll('button, [role="button"], a').forEach((el, index) => {
      const text = el.textContent?.toLowerCase() || ''
      const className = el.className.toLowerCase()
      const id = el.id.toLowerCase()

      if (walletKeywords.some(keyword => text.includes(keyword) || className.includes(keyword) || id.includes(keyword))) {
        // Generate selector
        let selector = ''
        if (el.id) {
          selector = `#${el.id}`
        } else if (el.className) {
          selector = `button.${el.className.split(' ')[0]}`
        } else {
          selector = `button:nth-of-type(${index})`
        }

        results.push({
          selector,
          text: el.textContent?.trim() || '',
        })
      }
    })

    return results
  })

  return buttons
}

async function recordConnectionFlow(
  page: Page,
  browser: Browser,
  button: { selector: string; text: string },
  outputDir: string,
): Promise<WalletFlow | null> {
  console.info(`[FLOW-RECORDER] Recording flow for button: ${button.text}`)

  const steps: InteractionStep[] = []
  let stepNumber = 0

  try {
    // Step 1: Take screenshot of initial state
    const initialScreenshot = await captureScreenshot(page, outputDir, stepNumber)
    const initialDOM = await getPageSnapshot(page)

    steps.push({
      stepNumber: stepNumber++,
      action: 'screenshot',
      description: `Initial state - ${button.text} visible`,
      timestamp: Date.now(),
      screenshot: initialScreenshot,
      domSnapshot: initialDOM,
      urlBefore: page.url(),
    })

    // Step 2: Click the connect button
    console.info(`[FLOW-RECORDER] Clicking button: ${button.selector}`)
    await page.click(button.selector)

    // Wait for any dialog/modal to appear
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Step 3: Capture state after click
    const afterClickDOM = await getPageSnapshot(page)
    const afterClickScreenshot = await captureScreenshot(page, outputDir, stepNumber)
    const newElements = await compareDOM(initialDOM, afterClickDOM)

    steps.push({
      stepNumber: stepNumber++,
      action: 'click',
      selector: button.selector,
      description: `Clicked: ${button.text}`,
      timestamp: Date.now(),
      screenshot: afterClickScreenshot,
      domSnapshot: afterClickDOM,
      newElementsAppeared: newElements.appeared,
      elementsRemoved: newElements.removed,
      urlBefore: page.url(),
    })

    // Step 4: Check for dialogs/modals and capture them
    const dialogs = await findDialogs(page)
    if (dialogs.length > 0) {
      console.info(`[FLOW-RECORDER] Found ${dialogs.length} dialogs`)

      for (const dialog of dialogs) {
        const dialogScreenshot = await captureScreenshot(page, outputDir, stepNumber)
        const dialogDOM = await getPageSnapshot(page)

        steps.push({
          stepNumber: stepNumber++,
          action: 'dialog',
          description: `Dialog appeared: ${dialog.title}`,
          timestamp: Date.now(),
          screenshot: dialogScreenshot,
          domSnapshot: dialogDOM,
          resultingUI: dialog.content,
        })

        // Step 5: Try to interact with dialog (click approve, etc.)
        const approveButton = await findApproveButton(page, dialog)
        if (approveButton) {
          console.info(`[FLOW-RECORDER] Found approve button: ${approveButton.selector}`)
          await page.click(approveButton.selector)

          // Wait for dialog to close
          await new Promise(resolve => setTimeout(resolve, 1000))

          const afterApprovalScreenshot = await captureScreenshot(page, outputDir, stepNumber)
          const afterApprovalDOM = await getPageSnapshot(page)

          steps.push({
            stepNumber: stepNumber++,
            action: 'click',
            selector: approveButton.selector,
            description: `Approved: ${approveButton.text}`,
            timestamp: Date.now(),
            screenshot: afterApprovalScreenshot,
            domSnapshot: afterApprovalDOM,
          })
        }
      }
    }

    // Step 6: Capture final state
    const finalScreenshot = await captureScreenshot(page, outputDir, stepNumber)
    const finalDOM = await getPageSnapshot(page)

    steps.push({
      stepNumber: stepNumber++,
      action: 'final',
      description: 'Connection flow complete',
      timestamp: Date.now(),
      screenshot: finalScreenshot,
      domSnapshot: finalDOM,
      urlAfter: page.url(),
    })

    // Determine wallet type from button text
    const walletType = inferWalletType(button.text)

    return {
      walletType,
      flowName: `${walletType} connection flow`,
      startButton: button.selector,
      steps,
      totalSteps: steps.length,
      successCriteria: 'Wallet approval dialog completed',
      captureTime: new Date().toISOString(),
    }
  } catch (e) {
    console.warn(`[FLOW-RECORDER] Error recording flow: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

async function captureScreenshot(page: Page, outputDir: string, stepNumber: number): Promise<string> {
  try {
    const screenshotPath = path.join(outputDir, 'flow-screenshots', `step-${stepNumber}.png`)
    await mkdir(path.dirname(screenshotPath), { recursive: true })
    await page.screenshot({ path: screenshotPath })
    return `flow-screenshots/step-${stepNumber}.png`
  } catch (e) {
    console.warn('[FLOW-RECORDER] Screenshot capture failed')
    return ''
  }
}

async function getPageSnapshot(page: Page): Promise<string> {
  return await page.content()
}

async function compareDOM(
  before: string,
  after: string,
): Promise<{ appeared: string[]; removed: string[] }> {
  const appeared: string[] = []
  const removed: string[] = []

  // Simple comparison - look for new dialog/modal elements
  if (!before.includes('modal') && after.includes('modal')) {
    appeared.push('modal')
  }
  if (!before.includes('dialog') && after.includes('dialog')) {
    appeared.push('dialog')
  }

  return { appeared, removed }
}

async function findDialogs(page: Page): Promise<Array<{ title: string; content: string }>> {
  return await page.evaluate(() => {
    const dialogs: Array<{ title: string; content: string }> = []

    // Look for common dialog patterns
    const selectors = [
      '[role="dialog"]',
      '.modal',
      '.modal-content',
      '[class*="modal"]',
      '[class*="dialog"]',
      '.popup',
      '[class*="popup"]',
    ]

    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        const title = el.querySelector('[role="heading"]')?.textContent || el.querySelector('h1, h2, h3')?.textContent || 'Unknown'
        const content = el.textContent || ''

        if (content.length > 0) {
          dialogs.push({
            title: title.trim(),
            content: content.substring(0, 200),
          })
        }
      })
    })

    return dialogs
  })
}

async function findApproveButton(
  page: Page,
  dialog: { title: string; content: string },
): Promise<{ selector: string; text: string } | null> {
  return await page.evaluate((dialogContent: string) => {
    const approveKeywords = ['approve', 'confirm', 'allow', 'connect', 'ok', 'yes', 'sign']

    let bestButton: { selector: string; text: string } | null = null

    document.querySelectorAll('button, [role="button"]').forEach((el, index) => {
      const text = el.textContent?.toLowerCase() || ''

      if (approveKeywords.some(keyword => text.includes(keyword))) {
        let selector = ''
        if (el.id) {
          selector = `#${el.id}`
        } else if (el.className) {
          selector = `button.${el.className.split(' ')[0]}`
        } else {
          selector = `button:nth-of-type(${index})`
        }

        bestButton = {
          selector,
          text: el.textContent?.trim() || '',
        }
      }
    })

    return bestButton
  }, dialog.content)
}

function inferWalletType(buttonText: string): string {
  const text = buttonText.toLowerCase()

  if (text.includes('metamask')) return 'metamask'
  if (text.includes('phantom')) return 'phantom'
  if (text.includes('solflare')) return 'solflare'
  if (text.includes('tronlink')) return 'tronlink'
  if (text.includes('ledger')) return 'ledger'
  if (text.includes('trezor')) return 'trezor'
  if (text.includes('walletconnect')) return 'walletconnect'

  return 'unknown'
}

function generateReplayCode(flows: WalletFlow[]): string {
  let code = `
// Auto-generated wallet flow replay code
var CAPTURED_FLOWS = ${JSON.stringify(flows, null, 2)};

function replayWalletFlow(walletType) {
  var flow = CAPTURED_FLOWS.flows.find(f => f.walletType === walletType);

  if (!flow) {
    console.error('Flow not found for wallet: ' + walletType);
    return;
  }

  console.log('Replaying flow: ' + flow.flowName);

  // Step 1: Find and click the connect button
  var connectButton = document.querySelector(flow.startButton);
  if (connectButton) {
    console.log('Clicking connect button...');
    connectButton.click();
  }

  // Step 2: Wait for dialog and simulate interactions
  setTimeout(function() {
    var approveButton = document.querySelector('button');
    if (approveButton && approveButton.textContent.toLowerCase().includes('approve')) {
      console.log('Clicking approve...');
      approveButton.click();
    }
  }, 1000);

  // Step 3: Simulate final state
  setTimeout(function() {
    console.log('Flow replay complete');
    dispatchEvent(new CustomEvent('walletFlowComplete', { detail: { walletType: walletType } }));
  }, 2500);
}

// Auto-replay on page load
document.addEventListener('DOMContentLoaded', function() {
  // Try to auto-connect with detected wallet
  if (typeof window.ethereum !== 'undefined') {
    replayWalletFlow('metamask');
  } else if (typeof window.solana !== 'undefined') {
    replayWalletFlow('phantom');
  }
});
`

  return code
}

export function buildFlowReplayInjectionCode(captured: CapturedFlows): string {
  return `<script>
${captured.replayCode}
</script>`
}
