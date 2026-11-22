import { test } from 'node:test'
import assert from 'node:assert/strict'
import { impose } from '../src/impose.ts'
import type { SheetSide } from '../src/types.ts'
import { workedExample } from './fixtures.ts'

// Placements as [pdfPage, panel.x, panel.y, rotation], sorted by page. Placement order is not part of the contract.
const rows = (side: SheetSide) =>
  side.placements.map((p) => [p.pdfPage, p.panel.x, p.panel.y, p.rotation] as number[]).sort((a, b) => a[0] - b[0])
const sorted = (rs: number[][]) => [...rs].sort((a, b) => a[0] - b[0])

const landscape = (duplex: 'long-edge' | 'short-edge') => impose(workedExample({
  pageSizes: Array.from({ length: 8 }, () => ({ width: 288, height: 378 })),
  parts: [{ type: 'body', signatures: 1, folds: 1 }],
  print: { sheet: { width: 792, height: 612 }, duplex, margin: 18, gap: 0, bleed: 0 },
}))

test('portrait short-edge flip turns the back 180 degrees', () => {
  const base = workedExample()
  const layout = impose({ ...base, print: { ...base.print, duplex: 'short-edge' } })
  assert.deepEqual(rows(layout.sheets[0].back), sorted([[3, 306, 396, 180], [8, 18, 396, 180], [5, 306, 18, 180], [6, 18, 18, 180]]))
  assert.deepEqual(rows(layout.sheets[0].front), sorted([[9, 18, 18, 0], [2, 306, 18, 0], [7, 18, 396, 0], [4, 306, 396, 0]]))
})

test('landscape long-edge: rotated pieces, back stays rotated 90', () => {
  const layout = landscape('long-edge')
  const sheet = layout.sheets[0]
  assert.deepEqual(rows(sheet.front), sorted([[7, 18, 18, 90], [0, 18, 306, 90], [5, 396, 18, 90], [2, 396, 306, 90]]))
  assert.deepEqual(rows(sheet.back), sorted([[1, 18, 18, 90], [6, 18, 306, 90], [3, 396, 18, 90], [4, 396, 306, 90]]))
  for (const p of sheet.front.placements) assert.deepEqual([p.panel.width, p.panel.height], [378, 288])
})

test('landscape short-edge: canonical back', () => {
  const layout = landscape('short-edge')
  assert.deepEqual(rows(layout.sheets[0].back), sorted([[6, 396, 18, 270], [1, 396, 306, 270], [4, 18, 18, 270], [3, 18, 306, 270]]))
})
