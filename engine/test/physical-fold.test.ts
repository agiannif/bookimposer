import { test } from 'node:test'
import assert from 'node:assert/strict'
import { impose } from '../src/index.ts'
import type { BookSpec, DuplexFlip, FoldCount, PrintSettings, Size } from '../src/index.ts'
import { checkPhysically } from './physical-fold.ts'

const pages = (n: number, width = 288, height = 378): Size[] => Array.from({ length: n }, () => ({ width, height }))
const print = (o: Partial<PrintSettings> = {}): PrintSettings =>
  ({ sheet: { width: 612, height: 792 }, duplex: 'long-edge', margin: 18, gap: 0, bleed: 0, ...o })
const withBoards = (signatures: number, folds: FoldCount): BookSpec['parts'] =>
  [{ type: 'board' }, { type: 'body', signatures, folds }, { type: 'board' }]

const cases: [string, BookSpec, number][] = [
  ['worked example', { pageSizes: pages(76), parts: withBoards(10, 1), print: print(), mismatch: 'fit' }, 22],
  ['worked example short-edge', { pageSizes: pages(76), parts: withBoards(10, 1), print: print({ duplex: 'short-edge' }), mismatch: 'fit' }, 22],
  ['worked example bleed 9 gap 6', { pageSizes: pages(76, 270, 370), parts: withBoards(10, 1), print: print({ bleed: 9, gap: 6, margin: 10 }), mismatch: 'fit' }, 22],
]
const sheets: Size[] = [{ width: 612, height: 792 }, { width: 792, height: 612 }, { width: 1224, height: 792 }, { width: 792, height: 1224 }]
for (const duplex of ['long-edge', 'short-edge'] as DuplexFlip[]) {
  cases.push([`worked example landscape ${duplex}`, { pageSizes: pages(76), parts: withBoards(10, 1), print: print({ sheet: { width: 792, height: 612 }, duplex }), mismatch: 'fit' }, 22])
  for (const sheet of sheets) {
    const tag = `${sheet.width}x${sheet.height} ${duplex}`
    cases.push(
      [`quarto, 2 signatures, ${tag}`, { pageSizes: pages(16, 144, 189), parts: withBoards(2, 2), print: print({ sheet, duplex }), mismatch: 'fit' }, 4],
      [`quarto with bleed and gap, ${tag}`, { pageSizes: pages(30, 144, 189), parts: withBoards(2, 2), print: print({ sheet, duplex, bleed: 6, gap: 3 }), mismatch: 'fit' }, 6],
      [`octavo, 1 piece per signature, ${tag}`, { pageSizes: pages(32, 140, 180), parts: withBoards(2, 3), print: print({ sheet, duplex }), mismatch: 'fit' }, 4],
      [`front board only, ${tag}`, { pageSizes: pages(16, 144, 189), parts: [{ type: 'board' }, { type: 'body', signatures: 2, folds: 1 }], print: print({ sheet, duplex }), mismatch: 'fit' }, 5],
      [`back board only, ${tag}`, { pageSizes: pages(16, 144, 189), parts: [{ type: 'body', signatures: 2, folds: 1 }, { type: 'board' }], print: print({ sheet, duplex }), mismatch: 'fit' }, 5],
      [`octavo, 2 pieces per signature, ${tag}`, { pageSizes: pages(64, 140, 180), parts: [{ type: 'body', signatures: 2, folds: 3 }], print: print({ sheet, duplex }), mismatch: 'fit' }, 4],
      [`folio, 3 pieces per signature, bleed, ${tag}`, { pageSizes: pages(24, 200, 260), parts: withBoards(2, 1), print: print({ sheet, duplex, bleed: 5 }), mismatch: 'fit' }, 8],
    )
  }
}

for (const [name, spec, pieceCount] of cases) {
  test(`folds by hand into a readable book: ${name}`, () => {
    const layout = impose(spec)
    assert.deepEqual(layout.issues.filter((i) => i.severity === 'error'), [])
    assert.deepEqual(checkPhysically(spec, layout), { pieces: pieceCount, errors: [] })
  })
}

test('the physical check catches two swapped pages', () => {
  const spec = cases[0][1]
  const layout = impose(spec)
  const [a, b] = layout.sheets[0].front.placements
  ;[a.pdfPage, b.pdfPage] = [b.pdfPage, a.pdfPage]
  assert.notDeepEqual(checkPhysically(spec, layout).errors, [])
})

test('the physical check catches a page turned upside down', () => {
  const spec = cases[0][1]
  const layout = impose(spec)
  layout.sheets[0].back.placements[0].rotation = 180
  assert.notDeepEqual(checkPhysically(spec, layout).errors, [])
})

test('the physical check catches a spine marked as opening by trim', () => {
  const spec = cases[0][1]
  const layout = impose(spec)
  layout.sheets[0].front.guides.fold[0].opensByTrim = true
  assert.notDeepEqual(checkPhysically(spec, layout).errors, [])
})

test('the physical check catches a board missing its inside cover', () => {
  const spec = cases[0][1]
  const layout = impose(spec)
  const inside = layout.sheets[10].front.placements.find((p) => p.partIndex === 0 && p.pdfPage === 1)
  assert.ok(inside)
  inside.pdfPage = null
  assert.notDeepEqual(checkPhysically(spec, layout).errors, [])
})

test('the physical check catches a board with its cover and inside cover swapped', () => {
  for (const partIndex of [0, 2]) {
    const spec = cases[0][1]
    const layout = impose(spec)
    const [a, b] = layout.sheets[10].front.placements.filter((p) => p.partIndex === partIndex)
    ;[a.pdfPage, b.pdfPage] = [b.pdfPage, a.pdfPage]
    assert.deepEqual(checkPhysically(spec, layout).errors, [`sheet 10 part ${partIndex}: no folding reads ${JSON.stringify(partIndex === 0 ? [0, null, null, 1] : [74, null, null, 75])}`])
  }
})

test('the physical check catches a body without the blank leaf its front board wraps', () => {
  const spec = cases[0][1]
  const layout = impose(spec)
  const body = layout.allocations[1].pdfPages
  body.push(...body.splice(0, 2))
  assert.notDeepEqual(checkPhysically(spec, layout).errors, [])
})

test('the physical check catches body pages out of book order', () => {
  const spec = cases[0][1]
  const layout = impose(spec)
  const body = layout.allocations[1].pdfPages
  ;[body[2], body[3]] = [body[3], body[2]]
  assert.notDeepEqual(checkPhysically(spec, layout).errors, [])
})
