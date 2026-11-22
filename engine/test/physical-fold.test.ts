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
  ['worked example', { pageSizes: pages(76), parts: withBoards(9, 1), print: print(), mismatch: 'fit' }, 20],
  ['worked example short-edge', { pageSizes: pages(76), parts: withBoards(9, 1), print: print({ duplex: 'short-edge' }), mismatch: 'fit' }, 20],
  ['worked example bleed 9 gap 6', { pageSizes: pages(76, 270, 370), parts: withBoards(9, 1), print: print({ bleed: 9, gap: 6, margin: 10 }), mismatch: 'fit' }, 20],
]
const sheets: Size[] = [{ width: 612, height: 792 }, { width: 792, height: 612 }, { width: 1224, height: 792 }, { width: 792, height: 1224 }]
for (const duplex of ['long-edge', 'short-edge'] as DuplexFlip[]) {
  cases.push([`worked example landscape ${duplex}`, { pageSizes: pages(76), parts: withBoards(9, 1), print: print({ sheet: { width: 792, height: 612 }, duplex }), mismatch: 'fit' }, 20])
  for (const sheet of sheets) {
    const tag = `${sheet.width}x${sheet.height} ${duplex}`
    cases.push(
      [`quarto, 2 signatures, ${tag}`, { pageSizes: pages(4 + 16, 144, 189), parts: withBoards(2, 2), print: print({ sheet, duplex }), mismatch: 'fit' }, 4],
      [`quarto with bleed and gap, ${tag}`, { pageSizes: pages(4 + 30, 144, 189), parts: withBoards(2, 2), print: print({ sheet, duplex, bleed: 6, gap: 3 }), mismatch: 'fit' }, 6],
      [`octavo, 1 piece per signature, ${tag}`, { pageSizes: pages(4 + 32, 140, 180), parts: withBoards(2, 3), print: print({ sheet, duplex }), mismatch: 'fit' }, 4],
      [`octavo, 2 pieces per signature, ${tag}`, { pageSizes: pages(64, 140, 180), parts: [{ type: 'body', signatures: 2, folds: 3 }], print: print({ sheet, duplex }), mismatch: 'fit' }, 4],
      [`folio, 3 pieces per signature, bleed, ${tag}`, { pageSizes: pages(4 + 24, 200, 260), parts: withBoards(2, 1), print: print({ sheet, duplex, bleed: 5 }), mismatch: 'fit' }, 8],
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
  layout.sheets[0].foldLines[0].opensByTrim = true
  assert.notDeepEqual(checkPhysically(spec, layout).errors, [])
})
