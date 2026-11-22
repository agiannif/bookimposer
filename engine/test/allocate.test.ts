import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allocatePages } from '../src/allocate.ts'
import { workedExample } from './fixtures.ts'
import type { PartSpec, Size } from '../src/types.ts'

const pages = (n: number): Size[] => Array.from({ length: n }, () => ({ width: 288, height: 378 }))
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const body = (signatures: number, folds: 1 | 2 | 3): PartSpec => ({ type: 'body', signatures, folds })

test('worked example allocates boards and body', () => {
  const r = allocatePages(workedExample())
  assert.deepEqual(r.issues, [])
  assert.equal(r.allocations.length, 3)
  assert.deepEqual(r.allocations[0], { partIndex: 0, type: 'board', pdfPages: [0, 1] })
  assert.deepEqual(r.allocations[1].pdfPages, range(2, 73))
  assert.equal(r.allocations[1].partIndex, 1)
  assert.equal(r.allocations[1].type, 'body')
  assert.deepEqual(r.allocations[2], { partIndex: 2, type: 'board', pdfPages: [74, 75] })
  assert.deepEqual(r.body, { bodyPages: 72, pagesPerSignature: 8, piecesPerSignature: 2, blanksAdded: 0 })
})

test('70-page body pads with trailing blanks', () => {
  const r = allocatePages(workedExample({ pageSizes: pages(74) }))
  assert.deepEqual(r.body, { bodyPages: 70, pagesPerSignature: 8, piecesPerSignature: 2, blanksAdded: 2 })
  const pdfPages = r.allocations[1].pdfPages
  assert.equal(pdfPages.length, 72)
  assert.deepEqual(pdfPages.slice(-2), [null, null])
  assert.deepEqual(pdfPages.slice(0, 70), range(2, 71))
  assert.deepEqual(r.allocations[2].pdfPages, [72, 73])
})

test('folds 2 gives one piece per signature', () => {
  const r = allocatePages(workedExample({ parts: [{ type: 'board' }, body(9, 2), { type: 'board' }] }))
  assert.deepEqual(r.body, { bodyPages: 72, pagesPerSignature: 8, piecesPerSignature: 1, blanksAdded: 0 })
})

test('folds 3 with too few pages warns about empty signatures', () => {
  const r = allocatePages(workedExample({ parts: [{ type: 'board' }, body(9, 3), { type: 'board' }] }))
  assert.deepEqual(r.body, { bodyPages: 72, pagesPerSignature: 16, piecesPerSignature: 1, blanksAdded: 72 })
  assert.equal(r.allocations.length, 3)
  assert.equal(r.issues.length, 1)
  assert.equal(r.issues[0].code, 'empty-signatures')
  assert.equal(r.issues[0].severity, 'warning')
  assert.deepEqual(r.issues[0].data, { count: 4 })
})

test('multiple boards on each side keep list order', () => {
  const r = allocatePages(workedExample({
    pageSizes: pages(12),
    parts: [{ type: 'board' }, { type: 'board' }, body(1, 1), { type: 'board' }, { type: 'board' }],
  }))
  assert.deepEqual(r.allocations.map(a => a.pdfPages.slice(0, 2)), [[0, 1], [2, 3], [4, 5], [8, 9], [10, 11]])
  assert.deepEqual(r.allocations[2].pdfPages, [4, 5, 6, 7])
})

test('too few pages for a body is an error', () => {
  const r = allocatePages(workedExample({ pageSizes: pages(4) }))
  assert.deepEqual(r.allocations, [])
  assert.equal(r.body, null)
  assert.equal(r.issues.length, 1)
  assert.equal(r.issues[0].code, 'no-body-pages')
  assert.equal(r.issues[0].severity, 'error')
  assert.deepEqual(r.issues[0].data, { pdfPages: 4, fixedPages: 4 })
})

test('no body is an error', () => {
  const r = allocatePages(workedExample({ parts: [{ type: 'board' }] }))
  assert.deepEqual(r.allocations, [])
  assert.equal(r.body, null)
  assert.deepEqual(r.issues.map(i => [i.code, i.severity]), [['no-body', 'error']])
})

test('signatures must be a positive integer', () => {
  for (const signatures of [0, -1, 1.5, NaN]) {
    const r = allocatePages(workedExample({ parts: [body(signatures, 1)] }))
    assert.deepEqual(r.allocations, [])
    assert.equal(r.body, null)
    assert.deepEqual(r.issues.map(i => i.code), ['invalid-signatures'])
  }
})

test('two bodies is an error', () => {
  const r = allocatePages(workedExample({ parts: [body(1, 1), body(1, 1)] }))
  assert.deepEqual(r.allocations, [])
  assert.equal(r.body, null)
  assert.deepEqual(r.issues.map(i => i.code), ['multiple-bodies'])
})
