/** Same relative stylesheet must emit identical module bytes in independent checkouts. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { compileCssModule } from '../scripts/css-modules.ts'

const iteration = vi.hoisted(() => ({ count: 0 }))
vi.mock('lightningcss', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lightningcss')>()
  return {
    ...actual,
    transform(options: Parameters<typeof actual.transform>[0]) {
      const result = actual.transform(options)
      const entries = Object.entries(result.exports ?? {}).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      // Rust HashMap order is unspecified. Alternate two allowed enumeration
      // orders deterministically while preserving the real compiler's values.
      if (iteration.count++ % 2 === 0) entries.reverse()
      return { ...result, exports: Object.fromEntries(entries) }
    },
  }
})

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('preserves CSS/class pairing with byte-identical exports across checkout roots and compiler map orders', () => {
  iteration.count = 0
  const source = '.zeta{color:red}.alpha{display:flex}.middle{font-weight:700}'
  const outputs = Array.from({ length: 2 }, () => {
    const root = mkdtempSync(join(tmpdir(), 'sidebar-css-checkout-'))
    roots.push(root)
    const filename = join(root, 'src', 'panel.module.css')
    mkdirSync(join(root, 'src'))
    writeFileSync(filename, source)
    const output = compileCssModule(filename, readFileSync(filename), root)
    for (const local of ['alpha', 'middle', 'zeta']) {
      expect(output.classMap[local]).toMatch(new RegExp(`_${local}$`))
      expect(output.cssText).toContain(`.${output.classMap[local]}`)
    }
    return output
  })
  expect(JSON.stringify(outputs[0])).toBe(JSON.stringify(outputs[1]))
  expect(Object.keys(outputs[0]!.classMap)).toEqual(['alpha', 'middle', 'zeta'])
})
