/**
 * Headless browser fallback — puppeteer-extra + stealth full-page capture.
 * Served as static index.html when live proxy probe fails.
 */
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

export type HeadlessCaptureResult =
  | { ok: true; htmlPath: string; assetCount: number }
  | { ok: false; detail: string }

export async function captureMirrorWithHeadless(
  targetUrl: string,
  outDir: string,
): Promise<HeadlessCaptureResult> {
  try {
    const puppeteerExtra = await import('puppeteer-extra')
    const stealthMod = await import('puppeteer-extra-plugin-stealth')
    const StealthPlugin = stealthMod.default ?? stealthMod
    const puppeteer = puppeteerExtra.default ?? puppeteerExtra
    puppeteer.use(StealthPlugin())

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    })

    try {
      const page = await browser.newPage()
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      )
      await page.setViewport({ width: 1440, height: 900 })
      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 90_000 })

      const html = await page.content()
      const htmlPath = path.join(outDir, 'headless-capture.html')
      await writeFile(htmlPath, html, 'utf8')

      const assetDir = path.join(outDir, 'headless-assets')
      const { mkdir } = await import('node:fs/promises')
      await mkdir(assetDir, { recursive: true })

      const screenshotPath = path.join(assetDir, 'viewport.png')
      await page.screenshot({ path: screenshotPath, fullPage: false })

      return { ok: true, htmlPath, assetCount: 1 }
    } finally {
      await browser.close()
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('Cannot find module') || msg.includes('puppeteer')) {
      return {
        ok: false,
        detail: 'puppeteer-extra not installed — run: pnpm add -D puppeteer puppeteer-extra puppeteer-extra-plugin-stealth',
      }
    }
    return { ok: false, detail: msg }
  }
}
