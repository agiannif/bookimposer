import { test } from 'node:test'
import assert from 'node:assert/strict'
import { impose } from '../src/impose.ts'
import type { BookSpec, Layout, PrintSettings, Size } from '../src/types.ts'
import { workedExample } from './fixtures.ts'

const eightPages = (sizes: Partial<Record<number, Size>> = {}, print: Partial<PrintSettings> = {}): BookSpec => {
  const base = workedExample()
  const pageSizes = Array.from({ length: 8 }, (_, i) => sizes[i] ?? { width: 288, height: 378 })
  return { ...base, pageSizes, parts: [{ type: 'body', signatures: 1, folds: 1 }], print: { ...base.print, ...print } }
}

const assertEmpty = (layout: Layout) => {
  assert.deepEqual(layout.sheets, [])
  assert.deepEqual(layout.perSheet, [])
  assert.deepEqual(layout.allocations, [])
  assert.equal(layout.body, null)
  assert.deepEqual(layout.fillers, { count: 0, size: { width: 0, height: 0 } })
}

test('a zero-width first page with no gap reports invalid-page-size instead of hanging', () => {
  const layout = impose(eightPages(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, { width: 0, height: 378 }]))))
  assertEmpty(layout)
  assert.deepEqual(layout.issues.map((i) => [i.code, i.severity]), [['invalid-page-size', 'error']])
  assert.deepEqual(layout.issues[0].data, { pages: [0, 1, 2, 3, 4, 5, 6, 7] })
})

test('invalid-page-size lists every bad page in ascending order', () => {
  const layout = impose(eightPages({
    6: { width: 288, height: -1 },
    3: { width: 0, height: 0 },
    5: { width: NaN, height: 378 },
    1: { width: Infinity, height: 378 },
  }))
  assertEmpty(layout)
  assert.deepEqual(layout.issues.map((i) => i.code), ['invalid-page-size'])
  assert.deepEqual(layout.issues[0].data, { pages: [1, 3, 5, 6] })
})

const printCases: [string, Partial<PrintSettings>, string][] = [
  ['a gap of minus the piece width', { gap: -576 }, 'gap'],
  ['a NaN margin', { margin: NaN }, 'margin'],
  ['a negative bleed', { bleed: -5 }, 'bleed'],
  ['an infinite gap', { gap: Infinity }, 'gap'],
  ['a zero-width sheet', { sheet: { width: 0, height: 792 } }, 'sheet'],
  ['a NaN sheet height', { sheet: { width: 612, height: NaN } }, 'sheet'],
]

for (const [name, print, field] of printCases) {
  test(`${name} reports invalid-print-settings`, () => {
    const layout = impose(eightPages({}, print))
    assertEmpty(layout)
    assert.deepEqual(layout.issues.map((i) => [i.code, i.severity]), [['invalid-print-settings', 'error']])
    assert.match(layout.issues[0].message, new RegExp(`^Invalid print settings: ${field}\\.`))
  })
}

test('bad pages and bad print settings are both reported', () => {
  const layout = impose(eightPages({ 2: { width: 0, height: 378 } }, { bleed: -1 }))
  assertEmpty(layout)
  assert.deepEqual(layout.issues.map((i) => i.code), ['invalid-page-size', 'invalid-print-settings'])
})

test('zero margin, gap and bleed are valid', () => {
  const layout = impose(eightPages({}, { margin: 0, gap: 0, bleed: 0 }))
  assert.deepEqual(layout.issues, [])
  assert.equal(layout.sheets.length, 1)
})
