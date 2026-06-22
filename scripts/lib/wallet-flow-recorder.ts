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
    try {
      await page.click(button.selector)
    } catch (e) {
      console.warn(`[FLOW-RECORDER] Click failed, trying alternative methods...`)
      // Try alternative click methods
      await page.evaluate((selector: string) => {
        const el = document.querySelector(selector)
        if (el) {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        }
      }, button.selector)
    }

    // Wait for dialog/modal with detection
    let dialogFound = false
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 500))
      const dialogs = await findDialogs(page)
      if (dialogs.length > 0) {
        dialogFound = true
        break
      }
    }

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

  // Extract unique element classes/ids from both versions
  const beforeElements = new Set(before.match(/(?:class|id)="([^"]+)"/g) || [])
  const afterElements = new Set(after.match(/(?:class|id)="([^"]+)"/g) || [])

  // Elements that appeared
  afterElements.forEach(el => {
    if (!beforeElements.has(el)) appeared.push(el.replace(/["']/g, ''))
  })

  // Elements that disappeared
  beforeElements.forEach(el => {
    if (!afterElements.has(el)) removed.push(el.replace(/["']/g, ''))
  })

  // Check for common dialog/modal patterns
  const dialogPatterns = ['modal', 'dialog', 'popup', 'overlay', 'backdrop', 'confirm']
  if (!before.match(/class="([^"]*modal[^"]*)"/i) && after.match(/class="([^"]*modal[^"]*)"/i)) {
    appeared.push('modal-dialog')
  }
  if (!before.match(/data-testid="([^"]*dialog[^"]*)"/i) && after.match(/data-testid="([^"]*dialog[^"]*)"/i)) {
    appeared.push('dialog-element')
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
  const flowsJson = JSON.stringify(flows, null, 2)

  let code = `
// Auto-generated wallet flow replay code - LEGION PROTOCOL
(function() {
  var CAPTURED_FLOWS = ${flowsJson};
  var CURRENT_STEP = 0;
  var CURRENT_FLOW = null;

  window.LEGION_WALLET_FLOWS = {
    flows: CAPTURED_FLOWS,
    currentFlow: null,
    currentStep: 0,
  };

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function executeStep(step) {
    console.log('[LEGION] Step ' + step.stepNumber + ': ' + step.action + ' - ' + step.description);

    switch(step.action) {
      case 'click':
        if (step.selector) {
          var element = document.querySelector(step.selector);
          if (element) {
            console.log('[LEGION] Clicking: ' + step.selector);
            element.click();
            await delay(300);
          } else {
            console.warn('[LEGION] Selector not found: ' + step.selector);
          }
        }
        break;

      case 'input':
        if (step.selector && step.value) {
          var input = document.querySelector(step.selector);
          if (input) {
            input.value = step.value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await delay(200);
          }
        }
        break;

      case 'wait':
        await delay(1500);
        break;

      case 'screenshot':
        // Screenshot markers for analysis
        console.log('[LEGION] State snapshot: ' + step.description);
        break;
    }
  }

  async function replayFlow(walletType) {
    var flow = CAPTURED_FLOWS.flows.find(f => f.walletType === walletType);

    if (!flow) {
      console.error('[LEGION] Flow not found: ' + walletType);
      return false;
    }

    console.log('[LEGION] Starting flow replay: ' + flow.flowName);
    CURRENT_FLOW = flow;
    CURRENT_STEP = 0;

    try {
      for (var i = 0; i < flow.steps.length; i++) {
        await executeStep(flow.steps[i]);
        CURRENT_STEP = i;
      }

      console.log('[LEGION] Flow complete: ' + flow.flowName);
      dispatchEvent(new CustomEvent('legionFlowComplete', {
        detail: {
          walletType: walletType,
          flowName: flow.flowName,
          totalSteps: flow.steps.length
        }
      }));

      return true;
    } catch (e) {
      console.error('[LEGION] Flow error: ' + e.message);
      return false;
    }
  }

  window.replayWalletFlow = replayWalletFlow;
  window.LEGION_WALLET_FLOWS.replay = replayFlow;

  // Auto-detect and replay on certain conditions
  document.addEventListener('DOMContentLoaded', function() {
    var isConnectPage = document.body.innerHTML.includes('Connect') ||
                       document.body.innerHTML.includes('connect');
    if (isConnectPage && typeof window.ethereum !== 'undefined') {
      console.log('[LEGION] Auto-detected MetaMask environment');
    }
  });
})();
`

  return code
}

export function buildFlowReplayInjectionCode(captured: CapturedFlows): string {
  return `<script>
${captured.replayCode}
</script>`
}
