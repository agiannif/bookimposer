import { test } from 'node:test'
import assert from 'node:assert/strict'
import { impose } from '../src/index.ts'
import { assemble, visiblePages } from '../../assembler/assemble.ts'
import { expectedBook } from './expected-book.ts'
import { foldCases } from './fold-cases.ts'
import { workedExample } from './fixtures.ts'
import type { Assembly, BookSpec, Layout } from '../src/index.ts'

const assembleAndRead = (layout: Layout) => {
  const book = assemble(layout)
  return { pages: visiblePages(book), errors: book.errors }
}

for (const [name, spec, pieceCount] of foldCases) {
  test(`assembles from the printed sheets into the book: ${name}`, () => {
    const layout = impose(spec)
    assert.equal(layout.assembly?.pieces.length, pieceCount)
    assert.deepEqual(assembleAndRead(layout), { pages: expectedBook(spec), errors: [] })
  })
}

for (const [name, spec] of foldCases) {
  test(`each face of the assembled book shows its own printed region, turned upright: ${name}`, () => {
    const layout = impose(spec)
    const { leaves, errors } = assemble(layout)
    assert.deepEqual(errors, [])
    for (const leaf of leaves) {
      for (const face of [leaf.upper, leaf.lower]) {
        const quarter = face.rotation === 90 || face.rotation === 270
        const shown = quarter ? { width: face.region.height, height: face.region.width } : { width: face.region.width, height: face.region.height }
        assert.deepEqual(shown, leaf.size, `leaf of piece ${leaf.piece}: a ${face.rotation} turn of its region is not the leaf`)
        if (face.page === null) continue
        const placed = layout.sheets[face.sheet][face.side].placements.find((p) => p.pdfPage === face.page)
        assert.ok(placed, `page ${face.page} is not on sheet ${face.sheet} ${face.side}`)
        assert.deepEqual(face.region, placed.panel)
        assert.equal((face.rotation + placed.rotation) % 360, 0, `page ${face.page} printed at ${placed.rotation} shows turned ${face.rotation}`)
      }
    }
  })
}

test('the worked example: the covers are the board leaves around their hidden blank leaves', () => {
  const { leaves } = assemble(impose(workedExample()))
  const summary = (i: number) => {
    const { kind, upper, lower } = leaves.at(i)!
    return { kind, upper: [upper.page, upper.hidden], lower: [lower.page, lower.hidden] }
  }
  assert.deepEqual([0, 1, 2, 3].map(summary), [
    { kind: 'board', upper: [0, false], lower: [null, true] },
    { kind: 'body', upper: [null, true], lower: [null, true] },
    { kind: 'board', upper: [null, true], lower: [1, false] },
    { kind: 'body', upper: [2, false], lower: [3, false] },
  ])
  assert.deepEqual([-3, -2, -1].map(summary), [
    { kind: 'board', upper: [74, false], lower: [null, true] },
    { kind: 'body', upper: [null, true], lower: [null, true] },
    { kind: 'board', upper: [null, true], lower: [75, false] },
  ])
  // The cover is the front board's first page as printed on sheet 11, upright; the blank behind it is the
  // empty back of the strip.
  assert.deepEqual(leaves[0].upper, { sheet: 10, side: 'front', region: { x: 18, y: 18, width: 288, height: 378 }, page: 0, rotation: 0, hidden: false })
  assert.deepEqual(leaves[0].size, { width: 288, height: 378 })
  assert.equal(leaves[0].lower.side, 'back')
})

test('the worked example: a folio piece folds once at its spine, a board once at its fore-edge', () => {
  const assembly = impose(workedExample()).assembly
  assert.ok(assembly)
  assert.equal(assembly.flipAxis, 'vertical')
  assert.deepEqual(assembly.pieces[0], {
    id: 0, sheet: 0, slot: { x: 18, y: 18, width: 576, height: 378 }, cols: 2, rows: 1, turned: false, partIndex: 1, kind: 'body',
    folds: [{ order: 0, line: { x1: 288, y1: 0, x2: 288, y2: 378 }, moves: 'left', direction: 'mountain', opensByTrim: false }],
  })
  assert.deepEqual(assembly.pieces[20], {
    id: 20, sheet: 10, slot: { x: 18, y: 18, width: 576, height: 378 }, cols: 2, rows: 1, turned: false, partIndex: 0, kind: 'board',
    folds: [{ order: 0, line: { x1: 288, y1: 0, x2: 288, y2: 378 }, moves: 'right', direction: 'mountain', opensByTrim: false }],
  })
  assert.deepEqual(assembly.signatures.slice(0, 2), [{ partIndex: 1, pieces: [0, 1] }, { partIndex: 1, pieces: [2, 3] }])
  assert.deepEqual(assembly.boards, [
    { pieceId: 20, position: 'front', wraps: { signature: 0, leaf: 'first' } },
    { pieceId: 21, position: 'back', wraps: { signature: 9, leaf: 'last' } },
  ])
  assert.deepEqual(assembly.order, [
    { kind: 'board', index: 0 },
    ...Array.from({ length: 10 }, (_, index) => ({ kind: 'signature', index })),
    { kind: 'board', index: 1 },
  ])
})

test('an error layout has no assembly', () => {
  assert.equal(impose(workedExample({ parts: [] })).assembly, null)
})

// The negatives break one step of a correct assembly. Each names how the simulator must notice: the book
// reads in a different order (with every step still physically possible), or the simulator reports the
// step that cannot be done (matching `error`).
type Edit = (assembly: Assembly) => void
const misread = (edit: Edit, expect: 'order' | RegExp, spec: BookSpec = workedExample()) => {
  const layout = impose(spec)
  assert.ok(layout.assembly)
  assert.deepEqual(assembleAndRead(layout), { pages: expectedBook(spec), errors: [] })
  edit(layout.assembly)
  const { pages, errors } = assembleAndRead(layout)
  if (expect === 'order') {
    assert.deepEqual(errors, [])
    assert.notDeepEqual(pages, expectedBook(spec))
  } else {
    assert.ok(errors.some((e) => expect.test(e)), `no error matching ${expect} in ${JSON.stringify(errors)}`)
  }
}

const octavo = foldCases.find(([name]) => name.startsWith('octavo, 2 pieces'))![1]
const landscape = foldCases.find(([name]) => name === 'worked example landscape long-edge')![1]

test('the simulator catches a fold made the wrong way', () => {
  misread((a) => { a.pieces[1].folds[0].direction = 'valley' }, 'order')
  // Piece 0 holds the blank leaf the front board wraps; folded the wrong way, printed pages get glued instead.
  misread((a) => { a.pieces[0].folds[0].direction = 'valley' }, /glued out of sight/)
})

test('the simulator catches a wrong fold direction deep in an octavo', () => {
  for (const order of [0, 1, 2]) misread((a) => { a.pieces[0].folds[order].direction = 'valley' }, 'order', octavo)
})

test('the simulator catches pieces nested in the wrong order', () => {
  misread((a) => { a.signatures[1].pieces.reverse() }, 'order')
  misread((a) => { a.signatures[0].pieces.reverse() }, /glued out of sight/)
})

test('the simulator catches a piece put in the wrong signature', () => {
  misread((a) => { [a.signatures[0].pieces[1], a.signatures[1].pieces[1]] = [a.signatures[1].pieces[1], a.signatures[0].pieces[1]] }, 'order')
})

test('the simulator catches the wrong half moving', () => {
  misread((a) => { a.pieces[0].folds[0].moves = 'right' }, /spine fold ends up at the right/)
})

test('the simulator catches a piece wrongly marked turned or not', () => {
  misread((a) => { a.pieces[0].turned = true }, /not upright/)
  misread((a) => { a.pieces[0].turned = false }, /not upright/, landscape)
})

test('the simulator catches the wrong flip axis', () => {
  misread((a) => { a.flipAxis = 'horizontal' }, /back page lies behind no front panel|not upright/)
})

test('the simulator catches a board wrapping the wrong leaf or on the wrong side', () => {
  misread((a) => { a.boards[0].wraps.leaf = 'last' }, /glued out of sight/)
  misread((a) => { a.boards[0].position = 'back' }, /gathered on the wrong side/)
})

test('the simulator catches two boards wrapping one leaf', () => {
  misread((a) => { a.boards[1] = { ...a.boards[1], position: 'front', wraps: { signature: 0, leaf: 'first' } }; a.order.unshift(a.order.pop()!) }, /already wraps/)
})

test('two boards on one side are an error, not a wrong book', () => {
  const layout = impose(workedExample({ parts: [{ type: 'board' }, { type: 'board' }, { type: 'body', signatures: 10, folds: 1 }] }))
  assert.deepEqual(layout.issues.map((i) => i.code), ['too-many-boards'])
  assert.equal(layout.assembly, null)
})
