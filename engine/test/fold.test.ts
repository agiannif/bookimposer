import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foldTemplate, rightAngleFolds } from '../src/fold.ts'
import type { PieceTemplate } from '../src/fold.ts'

function cellAt(t: PieceTemplate, col: number, row: number) {
  const cell = t.cells.find((c) => c.col === col && c.row === row)
  assert.ok(cell, `no cell at ${col},${row}`)
  return cell
}

test('rightAngleFolds gives the fold sequence for each fold count', () => {
  assert.deepEqual(rightAngleFolds(1), ['vertical'])
  assert.deepEqual(rightAngleFolds(2), ['horizontal', 'vertical'])
  assert.deepEqual(rightAngleFolds(3), ['vertical', 'horizontal', 'vertical'])
})

test('one vertical fold makes a 2x1 folio', () => {
  const t = foldTemplate(['vertical'])
  assert.equal(t.cols, 2)
  assert.equal(t.rows, 1)
  assert.deepEqual(cellAt(t, 0, 0), { col: 0, row: 0, frontPage: 4, backPage: 3, rotation: 0 })
  assert.deepEqual(cellAt(t, 1, 0), { col: 1, row: 0, frontPage: 1, backPage: 2, rotation: 0 })
})

test('horizontal then vertical makes a 2x2 quarto', () => {
  const t = foldTemplate(['horizontal', 'vertical'])
  assert.equal(t.cols, 2)
  assert.equal(t.rows, 2)
  assert.deepEqual(cellAt(t, 0, 0), { col: 0, row: 0, frontPage: 5, backPage: 6, rotation: 180 })
  assert.deepEqual(cellAt(t, 1, 0), { col: 1, row: 0, frontPage: 4, backPage: 3, rotation: 180 })
  assert.deepEqual(cellAt(t, 0, 1), { col: 0, row: 1, frontPage: 8, backPage: 7, rotation: 0 })
  assert.deepEqual(cellAt(t, 1, 1), { col: 1, row: 1, frontPage: 1, backPage: 2, rotation: 0 })
})

test('three folds make a 4x2 octavo using pages 1..16 once each', () => {
  const t = foldTemplate(rightAngleFolds(3))
  assert.equal(t.cols, 4)
  assert.equal(t.rows, 2)
  assert.equal(t.cells.length, 8)
  const pages = t.cells.flatMap((c) => [c.frontPage, c.backPage]).sort((a, b) => a - b)
  assert.deepEqual(pages, Array.from({ length: 16 }, (_, i) => i + 1))
  for (const c of t.cells) {
    const lo = Math.min(c.frontPage, c.backPage)
    assert.equal(lo % 2, 1)
    assert.equal(Math.max(c.frontPage, c.backPage), lo + 1)
  }
  assert.equal(t.cells.filter((c) => c.rotation === 180).length, 4)
  const first = t.cells.find((c) => c.frontPage === 1 || c.backPage === 1)
  assert.equal(first?.col, 3)
  assert.equal(first?.row, 1)
  assert.equal(first?.rotation, 0)
})

test('cells are listed row-major in front view', () => {
  const t = foldTemplate(rightAngleFolds(3))
  assert.deepEqual(t.cells.map((c) => [c.row, c.col]), [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3]])
})

test('boundaries record which fold creates each flat-piece boundary', () => {
  assert.deepEqual(foldTemplate(rightAngleFolds(1)).boundaries, [{ axis: 'vertical', index: 1, fold: 0 }])
  assert.deepEqual(foldTemplate(rightAngleFolds(2)).boundaries, [
    { axis: 'vertical', index: 1, fold: 1 },
    { axis: 'horizontal', index: 1, fold: 0 },
  ])
  assert.deepEqual(foldTemplate(rightAngleFolds(3)).boundaries, [
    { axis: 'vertical', index: 1, fold: 2 },
    { axis: 'vertical', index: 2, fold: 0 },
    { axis: 'vertical', index: 3, fold: 2 },
    { axis: 'horizontal', index: 1, fold: 1 },
  ])
})
