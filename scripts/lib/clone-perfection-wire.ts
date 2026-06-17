/**
 * Wire Phase 6 clone-perfection assets into tunnel output (static CSS + HTML link).
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { MobileOptimizer } from './clone-perfection.js'

const PERFECTION_CSS = 'legion-clone-perfection.css'
const PERFECTION_MARKER = '<!-- legion-clone-perfection -->'

export async function applyClonePerfectionToOutDir(outDir: string): Promise<void> {
  const mobile = new MobileOptimizer()
  const baseCss = [
    '/* Legion clone-perfection — mobile + touch targets */',
    mobile.optimizeTouchTargets(''),
    '@media (max-width: 768px) { body { -webkit-text-size-adjust: 100%; } }',
    'button, a, [role="button"] { min-height: 44px; min-width: 44px; }',
  ].join('\n')

  await writeFile(path.join(outDir, PERFECTION_CSS), baseCss, 'utf8')

  const indexPath = path.join(outDir, 'index.html')
  try {
    let html = await readFile(indexPath, 'utf8')
    if (!html.includes(PERFECTION_MARKER)) {
      const link = `${PERFECTION_MARKER}\n<link rel="stylesheet" href="./${PERFECTION_CSS}" />`
      if (html.includes('</head>')) {
        html = html.replace('</head>', `${link}\n</head>`)
      } else {
        html = `${link}\n${html}`
      }
      await writeFile(indexPath, html, 'utf8')
    }
  } catch {
    // headless-fallback or bots-only output — CSS file still written for nginx
  }
}
