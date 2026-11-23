import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitPieces, pieceSize } from '../src/fit.ts'
import type { PrintSettings } from '../src/types.ts'

const print: PrintSettings = { sheet: { width: 612, height: 792 }, duplex: 'long-edge', margin: 18, gap: 0, bleed: 0 }

test('pieceSize adds bleed on every side', () => {
  assert.deepEqual(pieceSize(2, 1, { width: 288, height: 378 }, 9), { width: 594, height: 396 })
})

test('two spreads stack on a portrait sheet', () => {
  const fit = fitPieces({ width: 576, height: 378 }, print)
  assert.deepEqual(fit, {
    rotated: false, across: 1, down: 2, perSheet: 2,
    slots: [{ x: 18, y: 18, width: 576, height: 378 }, { x: 18, y: 396, width: 576, height: 378 }],
  })
})

test('rotates the piece when that fits more', () => {
  const fit = fitPieces({ width: 576, height: 378 }, { ...print, sheet: { width: 792, height: 612 } })
  assert.deepEqual(fit, {
    rotated: true, across: 2, down: 1, perSheet: 2,
    slots: [{ x: 396, y: 18, width: 378, height: 576 }, { x: 18, y: 18, width: 378, height: 576 }],
  })
})

test('turned slots fill in the reading order of the turned pages', () => {
  // A turned piece's top faces the sheet's right edge, so as read the rows are the sheet's columns from
  // right to left, and each row runs down the sheet.
  const fit = fitPieces({ width: 100, height: 50 }, { ...print, sheet: { width: 100, height: 200 }, margin: 0 })
  assert.deepEqual([fit.rotated, fit.across, fit.down], [true, 2, 2])
  assert.deepEqual(fit.slots.map((s) => [s.x, s.y]), [[50, 0], [50, 100], [0, 0], [0, 100]])
})

test('margin decides whether a quarter-letter folio fits twice', () => {
  const piece = { width: 612, height: 396 }
  assert.equal(fitPieces(piece, print).perSheet, 1)
  assert.equal(fitPieces(piece, { ...print, margin: 0 }).perSheet, 2)
})

test('a piece larger than the sheet yields no slots', () => {
  const fit = fitPieces({ width: 1200, height: 800 }, print)
  assert.equal(fit.perSheet, 0)
  assert.deepEqual(fit.slots, [])
})

test('leftover space is split evenly around the grid', () => {
  const fit = fitPieces({ width: 594, height: 396 }, { ...print, sheet: { width: 700, height: 900 }, margin: 10 })
  assert.equal(fit.across, 1)
  assert.equal(fit.down, 2)
  assert.deepEqual(fit.slots[0], { x: 53, y: 54, width: 594, height: 396 })
  assert.deepEqual(fit.slots[1], { x: 53, y: 450, width: 594, height: 396 })
})

test('gap separates slots', () => {
  const fit = fitPieces({ width: 100, height: 100 }, { ...print, sheet: { width: 230, height: 120 }, margin: 10, gap: 10 })
  assert.equal(fit.across, 2)
  assert.deepEqual(fit.slots.map(s => s.x), [10, 120])
})

test('on a tie, the orientation needing fewer cuts wins', () => {
  // Upright fits 1 x 4 (3 cuts between pieces), turned fits 2 x 2 (2 cuts).
  const fit = fitPieces({ width: 100, height: 50 }, { ...print, sheet: { width: 100, height: 200 }, margin: 0 })
  assert.deepEqual([fit.rotated, fit.across, fit.down, fit.perSheet], [true, 2, 2, 4])
})

test('on a tie in count and cuts, the piece stays upright', () => {
  const fit = fitPieces({ width: 100, height: 100 }, { ...print, sheet: { width: 200, height: 200 }, margin: 0 })
  assert.deepEqual([fit.rotated, fit.across, fit.down], [false, 2, 2])
})

test('slots fill a grid row by row', () => {
  // Across: 3 x 100 + 2 x 5 fills the 310 between margins. Down: 2 x 80 + 5 leaves 15, split above and below.
  const fit = fitPieces({ width: 100, height: 80 }, { ...print, sheet: { width: 330, height: 200 }, margin: 10, gap: 5 })
  assert.deepEqual([fit.rotated, fit.across, fit.down], [false, 3, 2])
  assert.deepEqual(fit.slots.map((s) => [s.x, s.y]), [[10, 17.5], [115, 17.5], [220, 17.5], [10, 102.5], [115, 102.5], [220, 102.5]])
})
