import { test } from 'node:test'
import assert from 'node:assert/strict'
import { impose } from '../src/impose.ts'
import type { BookSpec, MismatchPolicy } from '../src/types.ts'
import { workedExample } from './fixtures.ts'

const eightPages = (mismatch: MismatchPolicy, pageSize = { width: 288, height: 378 }, odd = { width: 300, height: 400 }, oddPage = 2): BookSpec => {
  const pageSizes = Array.from({ length: 8 }, () => pageSize)
  pageSizes[oddPage] = odd
  return workedExample({ pageSizes, parts: [{ type: 'body', signatures: 1, folds: 1 }], mismatch })
}

const landscape = (spec: BookSpec): BookSpec => ({ ...spec, print: { ...spec.print, sheet: { width: 792, height: 612 } } })

const placementOf = (layout: ReturnType<typeof impose>, pdfPage: number) =>
  layout.sheets.flatMap((s) => [...s.front.placements, ...s.back.placements]).find((p) => p.pdfPage === pdfPage)!

test('fit scales a mismatched page into the panel and warns once', () => {
  const layout = impose(eightPages('fit'))
  const p = placementOf(layout, 2)
  assert.deepEqual(p.content, { x: p.panel.x + 2.25, y: p.panel.y, width: 283.5, height: 378 })
  assert.deepEqual(layout.issues.map((i) => i.code), ['page-size-mismatch'])
  assert.equal(layout.issues[0].severity, 'warning')
  assert.deepEqual(layout.issues[0].data, { pages: [2] })
  const other = placementOf(layout, 3)
  assert.deepEqual(other.content, other.panel)
})

test('center keeps the page size and may overflow the panel', () => {
  const p = placementOf(impose(eightPages('center')), 2)
  assert.deepEqual(p.content, { x: p.panel.x - 6, y: p.panel.y - 11, width: 300, height: 400 })
})

test('fit on a back-side placement', () => {
  const layout = impose(eightPages('fit', undefined, undefined, 3))
  assert.ok(layout.sheets[0].back.placements.some((p) => p.pdfPage === 3))
  const p = placementOf(layout, 3)
  assert.deepEqual(p.content, { x: p.panel.x + 2.25, y: p.panel.y, width: 283.5, height: 378 })
})

test('fit on a rotated placement scales along the rotated axes', () => {
  const p = placementOf(impose(landscape(eightPages('fit'))), 2)
  assert.equal(p.rotation, 90)
  assert.deepEqual(p.content, { x: p.panel.x, y: p.panel.y + 2.25, width: 378, height: 283.5 })
})

test('center on a rotated back-side placement', () => {
  const layout = impose(landscape(eightPages('center', undefined, undefined, 3)))
  assert.ok(layout.sheets[0].back.placements.some((p) => p.pdfPage === 3))
  const p = placementOf(layout, 3)
  assert.equal(p.rotation, 90)
  assert.deepEqual(p.content, { x: p.panel.x - 11, y: p.panel.y - 6, width: 400, height: 300 })
})

test('a difference within half a point is not a mismatch', () => {
  const layout = impose(eightPages('fit', undefined, { width: 288.5, height: 377.5 }))
  assert.deepEqual(layout.issues, [])
})

test('spacing-reduces-fit warns when margin lowers the count per sheet', () => {
  const layout = impose(eightPages('fit', { width: 306, height: 396 }, { width: 306, height: 396 }))
  assert.deepEqual(layout.issues.map((i) => i.code), ['spacing-reduces-fit'])
  assert.equal(layout.issues[0].severity, 'warning')
  assert.deepEqual(layout.issues[0].data, { perSheet: 1, perSheetWithoutSpacing: 2 })
})

test('worked example raises no issues', () => {
  assert.deepEqual(impose(workedExample()).issues, [])
})
