import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

describe('authorized-drain inject template build', () => {
  it('builder substitutes JSON booleans for clone flags', () => {
    const ts = readFileSync(join(ROOT, 'scripts/lib/authorized-drain-inject.ts'), 'utf8')
    expect(ts).toMatch(/__PRODUCTION_CLONE_JSON__/)
    expect(ts).toMatch(/JSON\.stringify\(productionClone\)/)
    expect(ts).toMatch(/JSON\.stringify\(silentInject\)/)
    expect(ts).toMatch(/JSON\.stringify\(qaVisibleUi\)/)
  })

  it('template exposes boolean vars from JSON placeholders', () => {
    const js = readFileSync(join(ROOT, 'scripts/lib/authorized-drain-inject.js'), 'utf8')
    expect(js).toMatch(/var PRODUCTION_CLONE = __PRODUCTION_CLONE_JSON__;/)
    expect(js).toMatch(/var QA_VISIBLE_UI = __QA_VISIBLE_UI_JSON__;/)
  })
})
