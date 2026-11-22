import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allocatePages } from '../src/allocate.ts'
import { bodyPieces, boardPiece } from '../src/pieces.ts'
import type { Piece } from '../src/pieces.ts'
import type { BookSpec, FoldCount } from '../src/types.ts'
import { workedExample } from './fixtures.ts'

function bodyPiecesOf(spec: BookSpec, folds: FoldCount): Piece[] {
  const { allocations, body } = allocatePages(spec)
  assert.ok(body)
  const alloc = allocations.find((a) => a.type === 'body')
  assert.ok(alloc)
  return bodyPieces(alloc, body, folds)
}

const pageAt = (panels: Piece['front'], col: number, row: number) => {
  const panel = panels.find((p) => p.col === col && p.row === row)
  assert.ok(panel, `no panel at ${col},${row}`)
  return panel.pdfPage
}

test('worked example body makes 18 pieces in reading order', () => {
  const pieces = bodyPiecesOf(workedExample(), 1)
  assert.equal(pieces.length, 18)
  assert.ok(pieces.every((p) => p.kind === 'body' && p.partIndex === 1 && p.cols === 2 && p.rows === 1))
  const p0 = pieces[0]
  assert.equal(pageAt(p0.front, 0, 0), 9)
  assert.equal(pageAt(p0.front, 1, 0), 2)
  assert.equal(pageAt(p0.back, 0, 0), 3)
  assert.equal(pageAt(p0.back, 1, 0), 8)
  const p1 = pieces[1]
  assert.equal(pageAt(p1.front, 0, 0), 7)
  assert.equal(pageAt(p1.front, 1, 0), 4)
  assert.equal(pageAt(p1.back, 0, 0), 5)
  assert.equal(pageAt(p1.back, 1, 0), 6)
  assert.equal(pageAt(pieces[2].front, 1, 0), 10)
})

test('2-fold body maps panels with rotation and mirrored back columns', () => {
  const spec = workedExample({
    pageSizes: Array.from({ length: 8 }, () => ({ width: 288, height: 378 })),
    parts: [{ type: 'body', signatures: 1, folds: 2 }],
  })
  const [piece, ...rest] = bodyPiecesOf(spec, 2)
  assert.equal(rest.length, 0)
  assert.deepEqual(piece.front.map((p) => [p.col, p.row, p.pdfPage, p.rotation]), [
    [0, 0, 4, 180], [1, 0, 3, 180], [0, 1, 7, 0], [1, 1, 0, 0],
  ])
  assert.deepEqual(piece.back.toSorted((a, b) => a.row - b.row || a.col - b.col).map((p) => [p.col, p.row, p.pdfPage, p.rotation]), [
    [0, 0, 2, 180], [1, 0, 5, 180], [0, 1, 1, 0], [1, 1, 6, 0],
  ])
})

test('fold lines for 1 fold: spine only', () => {
  const [piece] = bodyPiecesOf(workedExample(), 1)
  assert.deepEqual(piece.foldLines, [{ axis: 'vertical', index: 1, opensByTrim: false }])
})

test('fold lines for 2 folds: spine stays shut, horizontal opens by trim', () => {
  const spec = workedExample({
    pageSizes: Array.from({ length: 8 }, () => ({ width: 288, height: 378 })),
    parts: [{ type: 'body', signatures: 1, folds: 2 }],
  })
  const [piece] = bodyPiecesOf(spec, 2)
  assert.deepEqual(piece.foldLines, [
    { axis: 'vertical', index: 1, opensByTrim: false },
    { axis: 'horizontal', index: 1, opensByTrim: true },
  ])
})

test('fold lines for 3 folds: only the spine boundaries stay shut', () => {
  const spec = workedExample({
    pageSizes: Array.from({ length: 16 }, () => ({ width: 288, height: 378 })),
    parts: [{ type: 'body', signatures: 1, folds: 3 }],
  })
  const [piece] = bodyPiecesOf(spec, 3)
  assert.deepEqual(piece.foldLines, [
    { axis: 'vertical', index: 1, opensByTrim: false },
    { axis: 'vertical', index: 2, opensByTrim: true },
    { axis: 'vertical', index: 3, opensByTrim: false },
    { axis: 'horizontal', index: 1, opensByTrim: true },
  ])
})

test('boards are 2x1 with the pages on the front and nothing on the back', () => {
  const { allocations } = allocatePages(workedExample())
  const front = boardPiece(allocations[0])
  assert.equal(front.kind, 'board')
  assert.equal(front.partIndex, 0)
  assert.equal(front.cols, 2)
  assert.equal(front.rows, 1)
  assert.deepEqual(front.front, [
    { col: 0, row: 0, pdfPage: 0, rotation: 0 },
    { col: 1, row: 0, pdfPage: 1, rotation: 0 },
  ])
  assert.deepEqual(front.back, [])
  assert.deepEqual(front.foldLines, [{ axis: 'vertical', index: 1, opensByTrim: false }])
  const back = boardPiece(allocations[2])
  assert.deepEqual(back.front.map((p) => p.pdfPage), [74, 75])
  assert.deepEqual(back.back, [])
})

test('a short body pads the last signature with blank panels', () => {
  const spec = workedExample({
    pageSizes: Array.from({ length: 74 }, () => ({ width: 288, height: 378 })),
  })
  const pieces = bodyPiecesOf(spec, 1)
  // body pages 71 and 72 are blank; they sit on the outer piece of the last signature
  const outer = pieces[pieces.length - 2]
  assert.deepEqual([pageAt(outer.front, 0, 0), pageAt(outer.front, 1, 0)], [null, 66])
  assert.equal(pageAt(outer.back, 0, 0), 67)
  assert.equal(pageAt(outer.back, 1, 0), null)
  const blanks = pieces.flatMap((p) => [...p.front, ...p.back]).filter((p) => p.pdfPage === null)
  assert.equal(blanks.length, 2)
})
