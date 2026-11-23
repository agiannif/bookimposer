import { test } from 'node:test'
import assert from 'node:assert/strict'
import { impose } from '../src/impose.ts'
import type { SheetLine, SheetSide } from '../src/types.ts'
import { workedExample } from './fixtures.ts'

const rows = (side: SheetSide) => side.placements.map((p) => [p.pdfPage, p.panel.x, p.panel.y, p.rotation])

test('worked example fills 11 sheets', () => {
  const layout = impose(workedExample())
  assert.equal(layout.sheets.length, 11)
  assert.deepEqual(layout.perSheet, [{ partIndexes: [1, 0, 2], perSheet: 2, sheets: 11 }])
  // Sheet 1 holds the first signature, whose first leaf is the blank one the front board wraps
  // (1-based: front 8 | blank / 6 | 3, back blank | 7 / 4 | 5).
  assert.deepEqual(rows(layout.sheets[0].front), [[7, 18, 18, 0], [null, 306, 18, 0], [5, 18, 396, 0], [2, 306, 396, 0]])
  assert.deepEqual(rows(layout.sheets[0].back), [[null, 18, 18, 0], [6, 306, 18, 0], [3, 18, 396, 0], [4, 306, 396, 0]])
  assert.deepEqual(rows(layout.sheets[10].front), [[0, 18, 18, 0], [1, 306, 18, 0], [74, 18, 396, 0], [75, 306, 396, 0]])
  assert.deepEqual(layout.sheets[10].back.placements, [])
  assert.deepEqual(layout.issues, [])
  const p = layout.sheets[0].front.placements[0]
  assert.deepEqual(p.panel, { x: 18, y: 18, width: 288, height: 378 })
  assert.deepEqual(p.content, p.panel)
  assert.deepEqual(p.clip, p.panel)
  assert.equal(layout.sheets[0].front.guides.cut.length, 7)
  assert.equal(layout.sheets[0].front.guides.fold.length, 2)
})

test('each placement says which page of its part it holds; blank leaves and padding are told apart', () => {
  const layout = impose(workedExample())
  const parts = (side: SheetSide) => side.placements.map((p) => [p.partIndex, p.partPage])
  // Body pages 8 1 6 3 / 2 7 4 5 are the body allocation's indexes 7 0 5 2 / 1 6 3 4; index 0 and 1 are the leaf.
  assert.deepEqual(parts(layout.sheets[0].front), [[1, 7], [1, 0], [1, 5], [1, 2]])
  assert.deepEqual(parts(layout.sheets[0].back), [[1, 1], [1, 6], [1, 3], [1, 4]])
  assert.deepEqual(parts(layout.sheets[10].front), [[0, 0], [0, 1], [2, 0], [2, 1]])
  for (const sheet of layout.sheets) {
    for (const p of [...sheet.front.placements, ...sheet.back.placements]) {
      assert.equal(layout.allocations[p.partIndex].pdfPages[p.partPage], p.pdfPage)
    }
  }
})

test("the back's guide lines sit behind the front's", () => {
  for (const duplex of ['long-edge', 'short-edge'] as const) {
    const base = workedExample()
    const { front, back } = impose({ ...base, print: { ...base.print, duplex } }).sheets[0]
    // Long edge on a portrait sheet mirrors x; short edge mirrors y.
    const behind = ({ x1, y1, x2, y2 }: SheetLine) => duplex === 'long-edge'
      ? { x1: 612 - x2, y1, x2: 612 - x1, y2 }
      : { x1, y1: 792 - y2, x2, y2: 792 - y1 }
    assert.deepEqual(back.guides.cut, front.guides.cut.map(behind))
    assert.deepEqual(back.guides.fold, front.guides.fold.map((f) => ({ ...behind(f), opensByTrim: f.opensByTrim })))
  }
})

test('an edge shared by two touching pieces is one cut line', () => {
  const { cut } = impose(workedExample()).sheets[0].front.guides
  assert.deepEqual(cut, [
    { x1: 18, y1: 18, x2: 594, y2: 18 },
    { x1: 18, y1: 396, x2: 594, y2: 396 },
    { x1: 18, y1: 18, x2: 18, y2: 396 },
    { x1: 594, y1: 18, x2: 594, y2: 396 },
    { x1: 18, y1: 774, x2: 594, y2: 774 },
    { x1: 18, y1: 396, x2: 18, y2: 774 },
    { x1: 594, y1: 396, x2: 594, y2: 774 },
  ])
})

test('2 folds, 8 pages, one signature', () => {
  const layout = impose(workedExample({
    pageSizes: Array.from({ length: 8 }, () => ({ width: 288, height: 378 })),
    parts: [{ type: 'body', signatures: 1, folds: 2 }],
  }))
  assert.equal(layout.sheets.length, 1)
  assert.deepEqual(rows(layout.sheets[0].front), [[4, 18, 18, 180], [3, 306, 18, 180], [7, 18, 396, 0], [0, 306, 396, 0]])
  assert.deepEqual(rows(layout.sheets[0].back), [[2, 18, 18, 180], [5, 306, 18, 180], [1, 18, 396, 0], [6, 306, 396, 0]])
})

test('the panel takes the size of the first PDF page after the blank leaf', () => {
  const pageSizes = Array.from({ length: 10 }, (_, i) => (i < 2 ? { width: 200, height: 300 } : { width: 288, height: 378 }))
  const layout = impose(workedExample({ pageSizes, parts: [{ type: 'board' }, { type: 'body', signatures: 1, folds: 1 }] }))
  assert.deepEqual(layout.sheets[0].front.placements[0].panel, { x: 18, y: 18, width: 288, height: 378 })
})

test('a board gets its own group after the body sheets', () => {
  const layout = impose(workedExample({
    pageSizes: Array.from({ length: 8 }, () => ({ width: 288, height: 378 })),
    parts: [{ type: 'board' }, { type: 'body', signatures: 1, folds: 2 }],
  }))
  assert.equal(layout.perSheet.length, 2)
  assert.deepEqual(layout.perSheet[0], { partIndexes: [1], perSheet: 1, sheets: 1 })
  assert.deepEqual(layout.perSheet[1], { partIndexes: [0], perSheet: 2, sheets: 1 })
  assert.equal(layout.sheets.length, 2)
  assert.deepEqual(rows(layout.sheets[1].front), [[0, 18, 18, 0], [1, 306, 18, 0]])
  assert.deepEqual(layout.sheets[1].back.placements, [])
})

test('oversized pages report piece-does-not-fit', () => {
  const layout = impose(workedExample({ pageSizes: Array.from({ length: 76 }, () => ({ width: 600, height: 800 })) }))
  assert.deepEqual(layout.sheets, [])
  assert.deepEqual(layout.perSheet, [])
  assert.deepEqual(layout.issues.map((i) => [i.code, i.severity]), [['piece-does-not-fit', 'error']])
  assert.deepEqual(layout.issues[0].data, { width: 1200, height: 800 })
})

test('allocation errors return an empty layout', () => {
  const layout = impose(workedExample({ parts: [{ type: 'board' }] }))
  assert.deepEqual(layout.sheets, [])
  assert.equal(layout.issues[0].code, 'no-body')
})

test('too many signatures empties the layout like any error', () => {
  const layout = impose(workedExample({ parts: [{ type: 'board' }, { type: 'body', signatures: 9_000_000_000, folds: 1 }, { type: 'board' }] }))
  assert.equal(layout.issues[0]?.code, 'too-many-signatures')
  assert.deepEqual(layout.sheets, [])
  assert.deepEqual(layout.perSheet, [])
})
