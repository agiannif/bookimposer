import { test } from 'node:test'
import assert from 'node:assert/strict'
import { impose } from '../src/impose.ts'
import type { SheetSide } from '../src/types.ts'
import { workedExample } from './fixtures.ts'

const rows = (side: SheetSide) => side.placements.map((p) => [p.pdfPage, p.panel.x, p.panel.y, p.rotation])

test('worked example fills 10 sheets', () => {
  const layout = impose(workedExample())
  assert.equal(layout.sheets.length, 10)
  assert.deepEqual(layout.perSheet, [{ partIndexes: [1, 0, 2], perSheet: 2, sheets: 10 }])
  assert.deepEqual(rows(layout.sheets[0].front), [[9, 18, 18, 0], [2, 306, 18, 0], [7, 18, 396, 0], [4, 306, 396, 0]])
  assert.deepEqual(rows(layout.sheets[0].back), [[3, 18, 18, 0], [8, 306, 18, 0], [5, 18, 396, 0], [6, 306, 396, 0]])
  assert.deepEqual(rows(layout.sheets[9].front), [[0, 18, 18, 0], [1, 306, 18, 0], [74, 18, 396, 0], [75, 306, 396, 0]])
  assert.deepEqual(layout.sheets[9].back.placements, [])
  assert.deepEqual(layout.fillers, { count: 2, size: { width: 288, height: 378 } })
  assert.deepEqual(layout.issues, [])
  const p = layout.sheets[0].front.placements[0]
  assert.deepEqual(p.panel, { x: 18, y: 18, width: 288, height: 378 })
  assert.deepEqual(p.content, p.panel)
  assert.deepEqual(p.clip, p.panel)
  assert.equal(layout.sheets[0].cutLines.length, 7)
  assert.equal(layout.sheets[0].foldLines.length, 2)
})

test('an edge shared by two touching pieces is one cut line', () => {
  const { cutLines } = impose(workedExample()).sheets[0]
  assert.deepEqual(cutLines, [
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

test('a board gets its own group after the body sheets', () => {
  const layout = impose(workedExample({
    pageSizes: Array.from({ length: 10 }, () => ({ width: 288, height: 378 })),
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
  assert.deepEqual(layout.fillers, { count: 0, size: { width: 0, height: 0 } })
  assert.equal(layout.issues[0].code, 'no-body')
})
