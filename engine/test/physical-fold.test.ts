import { test } from 'node:test'
import assert from 'node:assert/strict'
import { impose } from '../src/index.ts'
import { checkPhysically } from './physical-fold.ts'
import { foldCases } from './fold-cases.ts'

for (const [name, spec, pieceCount] of foldCases) {
  test(`folds by hand into a readable book: ${name}`, () => {
    const layout = impose(spec)
    assert.deepEqual(layout.issues.filter((i) => i.severity === 'error'), [])
    assert.deepEqual(checkPhysically(spec, layout), { pieces: pieceCount, errors: [] })
  })
}

test('the physical check catches two swapped pages', () => {
  const spec = foldCases[0][1]
  const layout = impose(spec)
  const [a, b] = layout.sheets[0].front.placements
  ;[a.pdfPage, b.pdfPage] = [b.pdfPage, a.pdfPage]
  assert.notDeepEqual(checkPhysically(spec, layout).errors, [])
})

test('the physical check catches a page turned upside down', () => {
  const spec = foldCases[0][1]
  const layout = impose(spec)
  layout.sheets[0].back.placements[0].rotation = 180
  assert.notDeepEqual(checkPhysically(spec, layout).errors, [])
})

test('the physical check catches a spine marked as opening by trim', () => {
  const spec = foldCases[0][1]
  const layout = impose(spec)
  layout.sheets[0].front.guides.fold[0].opensByTrim = true
  assert.notDeepEqual(checkPhysically(spec, layout).errors, [])
})

test('the physical check catches a board missing its inside cover', () => {
  const spec = foldCases[0][1]
  const layout = impose(spec)
  const inside = layout.sheets[10].front.placements.find((p) => p.partIndex === 0 && p.pdfPage === 1)
  assert.ok(inside)
  inside.pdfPage = null
  assert.notDeepEqual(checkPhysically(spec, layout).errors, [])
})

test('the physical check catches a board with its cover and inside cover swapped', () => {
  for (const partIndex of [0, 2]) {
    const spec = foldCases[0][1]
    const layout = impose(spec)
    const [a, b] = layout.sheets[10].front.placements.filter((p) => p.partIndex === partIndex)
    ;[a.pdfPage, b.pdfPage] = [b.pdfPage, a.pdfPage]
    assert.deepEqual(checkPhysically(spec, layout).errors, [`sheet 10 part ${partIndex}: no folding reads ${JSON.stringify(partIndex === 0 ? [0, null, null, 1] : [74, null, null, 75])}`])
  }
})

test('the physical check catches a body without the blank leaf its front board wraps', () => {
  const spec = foldCases[0][1]
  const layout = impose(spec)
  const body = layout.allocations[1].pdfPages
  body.push(...body.splice(0, 2))
  assert.notDeepEqual(checkPhysically(spec, layout).errors, [])
})

test('the physical check catches body pages out of book order', () => {
  const spec = foldCases[0][1]
  const layout = impose(spec)
  const body = layout.allocations[1].pdfPages
  ;[body[2], body[3]] = [body[3], body[2]]
  assert.notDeepEqual(checkPhysically(spec, layout).errors, [])
})
