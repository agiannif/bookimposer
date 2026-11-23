import { test } from 'node:test'
import assert from 'node:assert/strict'
import { impose } from '../src/impose.ts'
import { workedExample } from './fixtures.ts'

const bleedLayout = () => impose(workedExample({
  pageSizes: Array.from({ length: 8 }, () => ({ width: 288, height: 378 })),
  parts: [{ type: 'body', signatures: 1, folds: 1 }],
  print: { sheet: { width: 700, height: 900 }, duplex: 'long-edge', margin: 10, gap: 0, bleed: 9 },
}))

test('clip grows the panel by the bleed on outer edges only', () => {
  const front = bleedLayout().sheets[0].front.placements
  const page8 = front.find((p) => p.pdfPage === 7)!
  assert.deepEqual(page8.panel, { x: 62, y: 63, width: 288, height: 378 })
  assert.deepEqual(page8.clip, { x: 53, y: 54, width: 297, height: 396 })
  const page1 = front.find((p) => p.pdfPage === 0)!
  assert.deepEqual(page1.panel, { x: 350, y: 63, width: 288, height: 378 })
  assert.deepEqual(page1.clip, { x: 350, y: 54, width: 297, height: 396 })
})

test('the second piece sits below the first', () => {
  const ys = bleedLayout().sheets[0].front.placements.map((p) => p.panel.y)
  assert.ok(ys.includes(459))
})

test('cut lines are the trim edges of each piece', () => {
  const { cut: cutLines } = bleedLayout().sheets[0].front.guides
  assert.equal(cutLines.length, 8)
  assert.deepEqual(cutLines.slice(0, 4), [
    { x1: 62, y1: 63, x2: 638, y2: 63 },
    { x1: 62, y1: 441, x2: 638, y2: 441 },
    { x1: 62, y1: 63, x2: 62, y2: 441 },
    { x1: 638, y1: 63, x2: 638, y2: 441 },
  ])
})

test('fold lines cross the trim rect and carry opensByTrim', () => {
  const { fold: foldLines } = bleedLayout().sheets[0].front.guides
  assert.equal(foldLines.length, 2)
  assert.deepEqual(foldLines[0], { x1: 350, y1: 63, x2: 350, y2: 441, opensByTrim: false })
})

test('two folds give a horizontal fold that opens by trim and a vertical spine', () => {
  const layout = impose(workedExample({
    pageSizes: Array.from({ length: 8 }, () => ({ width: 288, height: 378 })),
    parts: [{ type: 'body', signatures: 1, folds: 2 }],
    print: { sheet: { width: 700, height: 900 }, duplex: 'long-edge', margin: 10, gap: 0, bleed: 0 },
  }))
  const { fold: foldLines } = layout.sheets[0].front.guides
  assert.equal(foldLines.length, 2)
  const horizontal = foldLines.filter((l) => l.y1 === l.y2)
  const vertical = foldLines.filter((l) => l.x1 === l.x2)
  assert.deepEqual(horizontal.map((l) => l.opensByTrim), [true])
  assert.deepEqual(vertical.map((l) => l.opensByTrim), [false])
})

test('back clips grow on the outer edges as seen on the back', () => {
  // Page 2 is behind page 1, the right panel; seen on the back the piece's outer edge is on the left.
  const back = bleedLayout().sheets[0].back.placements
  const page2 = back.find((p) => p.pdfPage === 1)!
  assert.deepEqual(page2.panel, { x: 62, y: 63, width: 288, height: 378 })
  assert.deepEqual(page2.clip, { x: 53, y: 54, width: 297, height: 396 })
  const page7 = back.find((p) => p.pdfPage === 6)!
  assert.deepEqual(page7.clip, { x: 350, y: 54, width: 297, height: 396 })
})

test('rotated clips grow on the rotated outer edges', () => {
  // Turned a quarter clockwise, the piece's left column (page 8) is on top and its fold runs along y = 350.
  const layout = impose(workedExample({
    pageSizes: Array.from({ length: 8 }, () => ({ width: 288, height: 378 })),
    parts: [{ type: 'body', signatures: 1, folds: 1 }],
    print: { sheet: { width: 900, height: 700 }, duplex: 'long-edge', margin: 10, gap: 0, bleed: 9 },
  }))
  const { front, back } = layout.sheets[0]
  const page8 = front.placements.find((p) => p.pdfPage === 7)!
  assert.equal(page8.rotation, 90)
  assert.deepEqual(page8.panel, { x: 459, y: 62, width: 378, height: 288 })
  assert.deepEqual(page8.clip, { x: 450, y: 53, width: 396, height: 297 })
  const page1 = front.placements.find((p) => p.pdfPage === 0)!
  assert.deepEqual(page1.clip, { x: 450, y: 350, width: 396, height: 297 })
  // Long-edge on a landscape sheet mirrors y, so page 2 (behind page 1) is at the top of the back.
  const page2 = back.placements.find((p) => p.pdfPage === 1)!
  assert.equal(page2.rotation, 90)
  assert.deepEqual(page2.panel, { x: 459, y: 62, width: 378, height: 288 })
  assert.deepEqual(page2.clip, { x: 450, y: 53, width: 396, height: 297 })
})
