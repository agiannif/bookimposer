import { test } from 'node:test'
import assert from 'node:assert/strict'
import { impose } from '../src/impose.ts'
import { issuesForMarks, lineAxis, markSegments, sheetMarks, MARK_STYLE } from '../src/marks.ts'
import type { Rect } from '../src/geometry.ts'
import type { BookSpec, DuplexFlip, FoldLine, Layout, SheetLine, SheetSide, Size } from '../src/types.ts'
import { workedExample } from './fixtures.ts'

const SHEET: Size = { width: 612, height: 792 }
const clip = (x: number, y: number): Rect => ({ x, y, width: 288, height: 378 })
// Sheet 0 of the worked example: two pieces of two panels on a letter sheet, 18 pt margin.
const clips = [clip(18, 18), clip(306, 18), clip(18, 396), clip(306, 396)]
const line = (x1: number, y1: number, x2: number, y2: number): SheetLine => ({ x1, y1, x2, y2 })
const fold = (l: SheetLine, opensByTrim: boolean): FoldLine => ({ ...l, opensByTrim })

test('a cut line gets a tick past each end', () => {
  assert.deepEqual(markSegments(line(18, 18, 594, 18), clips, SHEET), [line(4, 18, 16, 18), line(596, 18, 608, 18)])
})

test('a fold end blocked by the next piece gets no tick', () => {
  assert.deepEqual(markSegments(line(306, 18, 306, 396), clips, SHEET), [line(306, 4, 306, 16)])
})

test('a fold at the bottom ticks below the last piece', () => {
  assert.deepEqual(markSegments(line(306, 396, 306, 774), clips, SHEET), [line(306, 776, 306, 788)])
})

test('a tick stops 2 pt inside the sheet edge', () => {
  // The right end has room for 10 pt after the 2 pt gap, up to 2 pt from the edge.
  assert.deepEqual(
    markSegments(line(100, 10, 200, 10), [], { width: 214, height: 20 }),
    [line(86, 10, 98, 10), line(202, 10, 212, 10)],
  )
})

test('ticks shorter than 3 pt are dropped', () => {
  // 2 pt of room before the left end's gap runs out, none at the right.
  assert.deepEqual(markSegments(line(6, 10, 100, 10), [], { width: 104, height: 20 }), [])
})

test('a tick is cut short where it would enter a clip', () => {
  // The right tick would run 102 to 114; the clip starts at 110, which cuts the tick to 8 pt.
  const blocker = { x: 110, y: 0, width: 5, height: 20 }
  assert.deepEqual(markSegments(line(50, 10, 100, 10), [blocker], SHEET), [line(36, 10, 48, 10), line(102, 10, 110, 10)])
})

test('a tick within half a stroke of a clip counts as touching it', () => {
  // The clip ends 0.1 pt above the line, closer than half the 0.25 pt stroke, so the right tick stops where the clip starts.
  const blocker = { x: 110, y: 0, width: 5, height: 9.9 }
  assert.deepEqual(markSegments(line(50, 10, 100, 10), [blocker], SHEET), [line(36, 10, 48, 10), line(102, 10, 110, 10)])
})

test('lines that are not horizontal or vertical get no ticks', () => {
  for (const bad of [line(50, 10, 100, 20), line(100, 10, 50, 10), line(10, 100, 10, 50), line(50, 10, 50, 10)]) {
    assert.equal(lineAxis(bad), null, JSON.stringify(bad))
    assert.deepEqual(markSegments(bad, [], SHEET), [], JSON.stringify(bad))
  }
  assert.equal(lineAxis(line(1, 2, 3, 2)), 'horizontal')
  assert.equal(lineAxis(line(1, 2, 1, 3)), 'vertical')
})

// One signature folded twice, two pieces side by side with an 18 pt gap and a 9 pt bleed, so every
// clip reaches 9 pt past its cut and fold lines. The same spec as the Rust crate's bleed-sheet fixture.
const bleedSpec = (): BookSpec => ({
  pageSizes: Array.from({ length: 16 }, () => ({ width: 288, height: 378 })),
  parts: [{ type: 'body', signatures: 1, folds: 2 }],
  print: { sheet: { width: 1300, height: 850 }, duplex: 'short-edge', margin: 18, gap: 18, bleed: 9 },
  mismatch: 'fit',
})
const clipsOf = (side: SheetSide) => side.placements.map((p) => p.clip)

test('a bleed tick starts past the piece\'s own bleed', () => {
  const layout = impose(bleedSpec())
  // The top cut of the left piece; its clips reach x 47 to 641.
  assert.deepEqual(
    markSegments(line(56, 47, 632, 47), clipsOf(layout.sheets[0].front), layout.sheet),
    [line(33, 47, 45, 47), line(643, 47, 655, 47)],
  )
})

// A tick's stroke as a rectangle: half a stroke either side across the tick, butt ends along it.
function strokeOf(tick: SheetLine): Rect {
  const half = MARK_STYLE.strokeWidth / 2
  return tick.y1 === tick.y2
    ? { x: tick.x1, y: tick.y1 - half, width: tick.x2 - tick.x1, height: 2 * half }
    : { x: tick.x1 - half, y: tick.y1, width: 2 * half, height: tick.y2 - tick.y1 }
}
const rectsOverlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

test('every line of a bleed sheet gets ticks outside every clip', () => {
  const layout = impose(bleedSpec())
  const sheet = layout.sheets[0]
  const frontClips = clipsOf(sheet.front)
  for (const marked of [...sheet.front.guides.cut, ...sheet.front.guides.fold]) {
    const ticks = markSegments(marked, frontClips, layout.sheet)
    assert.equal(ticks.length, 2, JSON.stringify({ marked, ticks }))
    for (const tick of ticks) {
      for (const c of frontClips) assert.ok(!rectsOverlap(strokeOf(tick), c), JSON.stringify({ marked, tick, c }))
    }
  }
})

test('collinear ticks of neighbouring pieces merge into one', () => {
  // The left piece's top cut ticks 643 to 655 past its bleed; the right piece's top cut ticks 645 to 657
  // into the same gap. Drawn both, they double up.
  const front = impose(bleedSpec()).sheets[0].front
  const inGap = front.marks.cut.filter((t) => t.y1 === 47 && t.y2 === 47 && t.x1 > 641 && t.x2 < 659)
  assert.deepEqual(inGap, [line(643, 47, 657, 47)])
})

test('a fold tick on a cut tick is dropped, and a trim fold tick on a spine tick', () => {
  const marks = sheetMarks(
    [line(20, 10, 80, 10)],
    [fold(line(20, 10, 70, 10), false), fold(line(10, 40, 10, 80), false), fold(line(10, 50, 10, 70), true), fold(line(40, 40, 40, 60), true)],
    [],
    { width: 200, height: 200 },
  )
  assert.deepEqual(marks.cut, [line(6, 10, 18, 10), line(82, 10, 94, 10)])
  // The spine fold on the cut line ticks 6..18 and 72..84: both overlap cut ticks.
  assert.deepEqual(marks.fold, [
    fold(line(10, 26, 10, 38), false),
    fold(line(10, 82, 10, 94), false),
    fold(line(40, 26, 40, 38), true),
    fold(line(40, 62, 40, 74), true),
  ])
})

test('collinear ticks that touch end to end merge into one', () => {
  // The first line's right tick runs 32 to 44, the second line's left tick 44 to 56.
  const marks = sheetMarks([line(20, 10, 30, 10), line(58, 10, 80, 10)], [], [], { width: 200, height: 200 })
  assert.deepEqual(marks.cut, [line(6, 10, 18, 10), line(32, 10, 56, 10), line(82, 10, 94, 10)])
})

const quarto = () => impose(workedExample({
  pageSizes: Array.from({ length: 32 }, () => ({ width: 288, height: 378 })),
  parts: [{ type: 'body', signatures: 2, folds: 2 }],
  print: { sheet: { width: 1224, height: 1600 }, duplex: 'long-edge', margin: 18, gap: 12, bleed: 0 },
}))
const landscape = (duplex: 'long-edge' | 'short-edge') => impose(workedExample({
  pageSizes: Array.from({ length: 8 }, () => ({ width: 288, height: 378 })),
  parts: [{ type: 'body', signatures: 1, folds: 1 }],
  print: { sheet: { width: 792, height: 612 }, duplex, margin: 18, gap: 0, bleed: 0 },
}))
const shortEdgeWorked = () => {
  const base = workedExample()
  return impose({ ...base, print: { ...base.print, duplex: 'short-edge' } })
}
const layouts: [string, () => Layout, DuplexFlip][] = [
  ['worked example', () => impose(workedExample()), 'long-edge'],
  ['worked example, short edge', shortEdgeWorked, 'short-edge'],
  ['bleed', () => impose(bleedSpec()), 'short-edge'],
  ['quarto', quarto, 'long-edge'],
  ['landscape long edge', () => landscape('long-edge'), 'long-edge'],
  ['landscape short edge', () => landscape('short-edge'), 'short-edge'],
]

// Two collinear segments that share more than a point.
function collinearOverlap(a: SheetLine, b: SheetLine): boolean {
  const eps = 1e-6
  if (a.y1 === a.y2 && b.y1 === b.y2) return Math.abs(a.y1 - b.y1) < eps && Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > eps
  if (a.x1 === a.x2 && b.x1 === b.x2) return Math.abs(a.x1 - b.x1) < eps && Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > eps
  return false
}

for (const [name, layoutOf, duplex] of layouts) {
  test(`${name}: no two marks on a side overlap`, () => {
    const layout = layoutOf()
    for (const [i, sheet] of layout.sheets.entries()) {
      for (const sideName of ['front', 'back'] as const) {
        const all = [...sheet[sideName].marks.cut, ...sheet[sideName].marks.fold]
        assert.ok(all.length > 0, `${name} sheet ${i} ${sideName} has marks`)
        for (let a = 0; a < all.length; a++) {
          for (let b = a + 1; b < all.length; b++) {
            assert.ok(!collinearOverlap(all[a], all[b]), JSON.stringify({ i, sideName, a: all[a], b: all[b] }))
          }
        }
      }
    }
  })

  test(`${name}: marks stay out of every clip on both sides`, () => {
    const layout = layoutOf()
    for (const sheet of layout.sheets) {
      for (const side of [sheet.front, sheet.back]) {
        for (const tick of [...side.marks.cut, ...side.marks.fold]) {
          for (const c of clipsOf(side)) assert.ok(!rectsOverlap(strokeOf(tick), c), JSON.stringify({ tick, c }))
        }
      }
    }
  })

  test(`${name}: back marks sit exactly behind the front marks`, () => {
    const layout = layoutOf()
    const { width, height } = layout.sheet
    // Looking at the back, a long edge flip on a portrait sheet mirrors x; a short edge flip mirrors y.
    // On a landscape sheet it is the other way round.
    const portrait = height >= width
    const mirrorsX = portrait === (duplex === 'long-edge')
    const behind = (l: SheetLine): SheetLine => mirrorsX
      ? line(width - l.x2, l.y1, width - l.x1, l.y2)
      : line(l.x1, height - l.y2, l.x2, height - l.y1)
    const key = (l: SheetLine & { opensByTrim?: boolean }) => JSON.stringify([l.x1, l.y1, l.x2, l.y2, l.opensByTrim])
    for (const sheet of layout.sheets) {
      const front = sheet.front.marks
      const back = sheet.back.marks
      assert.deepEqual(back.cut.map(key).sort(), front.cut.map(behind).map(key).sort())
      assert.deepEqual(back.fold.map(key).sort(), front.fold.map((f) => ({ ...behind(f), opensByTrim: f.opensByTrim })).map(key).sort())
    }
  })
}

test('the worked example\'s marks are the front ticks of its guide lines', () => {
  const sheet = impose(workedExample()).sheets[0]
  assert.deepEqual(sheet.front.marks.cut, [
    line(4, 18, 16, 18), line(596, 18, 608, 18),
    line(4, 396, 16, 396), line(596, 396, 608, 396),
    line(4, 774, 16, 774), line(596, 774, 608, 774),
    line(18, 4, 18, 16), line(18, 776, 18, 788),
    line(594, 4, 594, 16), line(594, 776, 594, 788),
  ])
  assert.deepEqual(sheet.front.marks.fold, [fold(line(306, 4, 306, 16), false), fold(line(306, 776, 306, 788), false)])
})

test('a sheet with guide lines but no room for any tick warns', () => {
  const layout = impose({
    pageSizes: Array.from({ length: 8 }, () => ({ width: 288, height: 378 })),
    parts: [{ type: 'body', signatures: 1, folds: 1 }],
    print: { sheet: { width: 576, height: 756 }, duplex: 'long-edge', margin: 0, gap: 0, bleed: 0 },
    mismatch: 'fit',
  })
  assert.equal(layout.sheets.length, 1)
  assert.deepEqual(layout.sheets[0].front.marks, { cut: [], fold: [] })
  assert.deepEqual(layout.issues, [{
    code: 'no-room-for-marks', severity: 'warning',
    message: 'Cut/fold marks would overlap page content on sheet 1.',
    data: { sheet: 0, cut: true, fold: true },
  }])
})

test('a sheet with room for marks does not warn', () => {
  assert.deepEqual(impose(workedExample()).issues, [])
})

test('every layout carries the style its marks are drawn with', () => {
  const style = { strokeWidth: 0.25, dash: { spine: [3, 2], opensByTrim: [0.5, 1.5] } }
  assert.deepEqual(impose(workedExample()).markStyle, style)
  assert.deepEqual(impose(workedExample({ parts: [] })).markStyle, style)
})

test('the no-room warning names the kinds whose lines got no ticks', () => {
  // One folio exactly as tall as the sheet: the horizontal cuts tick in the side margins, the fold has no room.
  const layout = impose({
    pageSizes: Array.from({ length: 8 }, () => ({ width: 288, height: 378 })),
    parts: [{ type: 'body', signatures: 1, folds: 1 }],
    print: { sheet: { width: 700, height: 378 }, duplex: 'long-edge', margin: 0, gap: 0, bleed: 0 },
    mismatch: 'fit',
  })
  assert.ok(layout.sheets[0].front.marks.cut.length > 0)
  assert.deepEqual(layout.sheets[0].front.marks.fold, [])
  // Each of the two pieces gets a sheet of its own.
  assert.deepEqual(layout.issues.map((i) => [i.code, i.data]), [
    ['no-room-for-marks', { sheet: 0, cut: false, fold: true }],
    ['no-room-for-marks', { sheet: 1, cut: false, fold: true }],
  ])
})

test('issuesForMarks keeps a no-room warning only for a kind that is drawn', () => {
  const noRoom = (cut: boolean, fold: boolean) => ({
    code: 'no-room-for-marks' as const, severity: 'warning' as const, message: 'm', data: { sheet: 0, cut, fold },
  })
  const other = { code: 'page-size-mismatch' as const, severity: 'warning' as const, message: 'o' }
  const both = noRoom(true, true)
  const foldOnly = noRoom(false, true)
  assert.deepEqual(issuesForMarks([both, foldOnly, other], { cut: false, fold: false }), [other])
  assert.deepEqual(issuesForMarks([both, foldOnly, other], { cut: true, fold: false }), [both, other])
  assert.deepEqual(issuesForMarks([both, foldOnly, other], { cut: false, fold: true }), [both, foldOnly, other])
})
