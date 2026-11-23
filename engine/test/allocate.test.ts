import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allocatePages, bodyPageCount } from '../src/allocate.ts'
import { workedExample } from './fixtures.ts'
import type { PartSpec, Size } from '../src/types.ts'

const pages = (n: number): Size[] => Array.from({ length: n }, () => ({ width: 288, height: 378 }))
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const body = (signatures: number, folds: 1 | 2 | 3): PartSpec => ({ type: 'body', signatures, folds })

const leaf: null[] = [null, null]
const padding = (n: number): null[] => Array.from({ length: n }, () => null)

test('worked example: each board takes two pages and wraps a blank leaf at its end of the body', () => {
  const r = allocatePages(workedExample())
  assert.deepEqual(r.issues, [])
  assert.equal(r.allocations.length, 3)
  assert.deepEqual(r.allocations[0], { partIndex: 0, type: 'board', pdfPages: [0, 1] })
  // Body page n is PDF page n: the front leaf stands where the cover and inside cover are in the PDF.
  assert.deepEqual(r.allocations[1], { partIndex: 1, type: 'body', pdfPages: [...leaf, ...range(2, 73), ...padding(4), ...leaf] })
  assert.deepEqual(r.allocations[2], { partIndex: 2, type: 'board', pdfPages: [74, 75] })
  assert.deepEqual(r.body, { bodyPages: 76, pagesPerSignature: 8, piecesPerSignature: 2, blanksAdded: 4, leafPages: { before: 2, after: 2 } })
})

test('padding goes before the back leaf', () => {
  const r = allocatePages(workedExample({ pageSizes: pages(74) }))
  assert.deepEqual(r.body, { bodyPages: 74, pagesPerSignature: 8, piecesPerSignature: 2, blanksAdded: 6, leafPages: { before: 2, after: 2 } })
  assert.deepEqual(r.allocations[1].pdfPages, [...leaf, ...range(2, 71), ...padding(6), ...leaf])
  assert.deepEqual(r.allocations[2].pdfPages, [72, 73])
})

test('a front board alone gives the body a blank leaf at the front only', () => {
  const r = allocatePages(workedExample({ pageSizes: pages(10), parts: [{ type: 'board' }, body(1, 1)] }))
  assert.deepEqual(r.allocations.map((a) => a.pdfPages), [[0, 1], [...leaf, ...range(2, 9), ...padding(2)]])
  assert.deepEqual(r.body?.leafPages, { before: 2, after: 0 })
})

test('a back board alone gives the body a blank leaf at the back only', () => {
  const r = allocatePages(workedExample({ pageSizes: pages(10), parts: [body(1, 1), { type: 'board' }] }))
  assert.deepEqual(r.allocations.map((a) => a.pdfPages), [[...range(0, 7), ...padding(2), ...leaf], [8, 9]])
  assert.deepEqual(r.body?.leafPages, { before: 0, after: 2 })
})

test('without boards the body is the whole PDF and has no blank leaves', () => {
  const r = allocatePages(workedExample({ pageSizes: pages(6), parts: [body(1, 1)] }))
  assert.deepEqual(r.allocations.map((a) => a.pdfPages), [[...range(0, 5), ...padding(2)]])
  assert.deepEqual(r.body, { bodyPages: 6, pagesPerSignature: 8, piecesPerSignature: 2, blanksAdded: 2, leafPages: { before: 0, after: 0 } })
})

test('bodyPageCount counts the blank leaves as body pages', () => {
  assert.equal(bodyPageCount(76, workedExample().parts), 76)
  assert.equal(bodyPageCount(76, [{ type: 'board' }, body(1, 1)]), 76)
  assert.equal(bodyPageCount(76, [body(1, 1)]), 76)
  assert.equal(bodyPageCount(12, [{ type: 'board' }, { type: 'board' }, body(1, 1), { type: 'board' }]), 10)
})

test('folds 2 gives one piece per signature', () => {
  const r = allocatePages(workedExample({ parts: [{ type: 'board' }, body(10, 2), { type: 'board' }] }))
  assert.deepEqual(r.body, { bodyPages: 76, pagesPerSignature: 8, piecesPerSignature: 1, blanksAdded: 4, leafPages: { before: 2, after: 2 } })
})

const boards = (signatures: number, folds: 1 | 2 | 3) => workedExample({ parts: [{ type: 'board' }, body(signatures, folds), { type: 'board' }] })

test('more signatures than the pages can fill is an error, and nothing is allocated', () => {
  // 76 body pages in folds-3 signatures of 16 pages fill at most 5.
  const r = allocatePages(boards(9, 3))
  assert.deepEqual(r.allocations, [])
  assert.equal(r.body, null)
  assert.deepEqual(r.issues, [{
    code: 'too-many-signatures', severity: 'error',
    message: 'Too many signatures: with 76 body pages, at most 5 signatures can hold content.',
    data: { bodyPages: 76, maxSignatures: 5 },
  }])
})

test('the most signatures that can hold content is ceil(body pages / pages per piece)', () => {
  for (const [folds, max] of [[1, 19], [2, 10], [3, 5]] as const) {
    assert.deepEqual(allocatePages(boards(max, folds)).issues, [], `${max} signatures of folds ${folds}`)
    assert.equal(allocatePages(boards(max + 1, folds)).issues[0]?.code, 'too-many-signatures', `${max + 1} signatures of folds ${folds}`)
  }
})

test('a count within the maximum that still leaves a signature blank is an error too', () => {
  // Signatures are all one size: 12 of 8 pages hold 96, so 76 pages leave the last two blank.
  const r = allocatePages(boards(12, 1))
  assert.deepEqual(r.allocations, [])
  assert.deepEqual(r.issues, [{
    code: 'too-many-signatures', severity: 'error',
    message: 'Too many signatures: with 76 body pages, 12 signatures of 8 pages leave 2 entirely blank.',
    data: { bodyPages: 76, maxSignatures: 19 },
  }])
})

test('an absurd signature count is refused at once', () => {
  const started = performance.now()
  const r = allocatePages(boards(9_000_000_000, 1))
  assert.ok(performance.now() - started < 50, 'took too long')
  assert.equal(r.issues[0]?.code, 'too-many-signatures')
  assert.deepEqual(r.issues[0]?.data, { bodyPages: 76, maxSignatures: 19 })
})

test('more than one board on a side is an error', () => {
  for (const parts of [
    [{ type: 'board' }, { type: 'board' }, body(2, 1)],
    [body(2, 1), { type: 'board' }, { type: 'board' }],
  ] as PartSpec[][]) {
    const r = allocatePages(workedExample({ pageSizes: pages(16), parts }))
    assert.deepEqual(r.allocations, [])
    assert.equal(r.body, null)
    assert.deepEqual(r.issues.map(i => [i.code, i.severity]), [['too-many-boards', 'error']])
  }
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

test('the boards and one content page are enough for a body', () => {
  const r = allocatePages(workedExample({ pageSizes: pages(5), parts: [{ type: 'board' }, body(1, 1), { type: 'board' }] }))
  assert.deepEqual(r.issues, [])
  assert.deepEqual(r.allocations.map((a) => a.pdfPages), [[0, 1], [...leaf, 2, ...padding(3), ...leaf], [3, 4]])
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
