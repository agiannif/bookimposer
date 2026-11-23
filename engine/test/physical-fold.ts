// An independent physical check of a Layout. It uses only the Layout and the BookSpec, never the
// engine's own folding code: it finds each piece on the printed sheet, cuts it out, tries every way of
// folding it by hand, and reports what does not come out as a readable book.
import type { BookSpec, FoldLine, Layout, PagePlacement, Rect } from '../src/index.ts'

const EPS = 1e-6
const near = (a: number, b: number) => Math.abs(a - b) < EPS
const sameRect = (a: Rect, b: Rect) => near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height)
const inside = (a: Rect, t: Rect) =>
  a.x >= t.x - EPS && a.y >= t.y - EPS && a.x + a.width <= t.x + t.width + EPS && a.y + a.height <= t.y + t.height + EPS
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width - EPS && b.x < a.x + a.width - EPS && a.y < b.y + b.height - EPS && b.y < a.y + a.height - EPS

// Physical model. A flat piece is a grid of cells; each cell has an upper face (front of the sheet) and
// a lower face (back). A face records its page and the direction of the page's "up" as a vector in y-down
// coordinates. Upper faces are seen from above. Lower faces are seen from below, which mirrors x, so their
// vectors live in a mirrored frame. `z` is the layer in the folded stack, 0 on top.
type Vec = [number, number]
interface Face { page: number | null; up: Vec }
interface Cell { id: number; x: number; y: number; z: number; upper: Face; lower: Face; panel: Rect }

const BLANK: Vec = [0, 0]
const upFor = (rotation: number): Vec => (rotation === 0 ? [0, -1] : rotation === 90 ? [1, 0] : rotation === 180 ? [0, 1] : [-1, 0])
const neg = (v: Vec): Vec => [-v[0] + 0, -v[1] + 0]
const clone = (cells: Cell[]) => cells.map((c) => ({ ...c, upper: { ...c.upper }, lower: { ...c.lower } }))

interface CutPiece { sheet: number; trim: Rect; cells: Cell[]; cols: number; rows: number; partIndex: number; backs: number; foldLines: FoldLine[] }

const spans = (line: FoldLine, a: Rect, b: Rect): boolean => {
  if (near(a.y, b.y) && near(a.height, b.height) && near(a.x + a.width, b.x)) {
    return near(line.x1, b.x) && near(line.x2, b.x) && line.y1 <= a.y + EPS && line.y2 >= a.y + a.height - EPS
  }
  if (near(a.x, b.x) && near(a.width, b.width) && near(a.y + a.height, b.y)) {
    return near(line.y1, b.y) && near(line.y2, b.y) && line.x1 <= a.x + EPS && line.x2 >= a.x + a.width - EPS
  }
  return false
}

const boundingBox = (rects: Rect[]): Rect => {
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  return { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) - x, height: Math.max(...rects.map((r) => r.y + r.height)) - y }
}

// Pieces are the groups of front panels joined by fold lines; touching pieces meet at cut lines only.
function cutOut(layout: Layout, spec: BookSpec, errors: string[]): CutPiece[] {
  const { width: W, height: H } = spec.print.sheet
  // A flip about the sheet's vertical axis mirrors x between the sides; about the horizontal axis, y.
  const verticalAxis = (spec.print.duplex === 'long-edge') === (H >= W)
  const pieces: CutPiece[] = []
  layout.sheets.forEach((sheet, si) => {
    const fronts = sheet.front.placements
    const group = fronts.map((_, i) => i)
    const root = (i: number): number => (group[i] === i ? i : root(group[i]))
    for (let i = 0; i < fronts.length; i++) {
      for (let j = 0; j < fronts.length; j++) {
        if (i !== j && sheet.front.guides.fold.some((l) => spans(l, fronts[i].panel, fronts[j].panel))) group[root(i)] = root(j)
      }
    }
    const backs = sheet.back.placements.map((p) => ({
      p,
      physical: verticalAxis ? { ...p.panel, x: W - p.panel.x - p.panel.width } : { ...p.panel, y: H - p.panel.y - p.panel.height },
    }))
    for (const r of new Set(fronts.map((_, i) => root(i)))) {
      const members = fronts.filter((_, i) => root(i) === r)
      const trim = boundingBox(members.map((p) => p.panel))
      const edges = [
        { x1: trim.x, y1: trim.y, x2: trim.x + trim.width, y2: trim.y },
        { x1: trim.x, y1: trim.y + trim.height, x2: trim.x + trim.width, y2: trim.y + trim.height },
        { x1: trim.x, y1: trim.y, x2: trim.x, y2: trim.y + trim.height },
        { x1: trim.x + trim.width, y1: trim.y, x2: trim.x + trim.width, y2: trim.y + trim.height },
      ]
      for (const e of edges) {
        const cut = sheet.front.guides.cut.some((l) => near(l.x1, e.x1) && near(l.y1, e.y1) && near(l.x2, e.x2) && near(l.y2, e.y2))
        if (!cut) errors.push(`sheet ${si}: trim edge ${JSON.stringify(e)} has no cut line`)
      }
      const xs = [...new Set(members.map((p) => p.panel.x))].sort((a, b) => a - b)
      const ys = [...new Set(members.map((p) => p.panel.y))].sort((a, b) => a - b)
      const pieceBacks = backs.filter((b) => inside(b.physical, trim))
      const cells = members.map((p, id): Cell => {
        const behind = pieceBacks.filter((b) => sameRect(b.physical, p.panel))
        if (behind.length > 1) errors.push(`sheet ${si}: two back pages behind front page ${p.pdfPage}`)
        // Seen from below, the back of a vertical-axis flip is the back side as printed; a horizontal-axis
        // flip turns it a further 180 degrees.
        const lower: Face = behind.length > 0
          ? { page: behind[0].p.pdfPage, up: verticalAxis ? upFor(behind[0].p.rotation) : neg(upFor(behind[0].p.rotation)) }
          : { page: null, up: BLANK }
        return { id, x: xs.indexOf(p.panel.x), y: ys.indexOf(p.panel.y), z: 0, upper: { page: p.pdfPage, up: upFor(p.rotation) }, lower, panel: p.panel }
      })
      const partIndexes = new Set(members.map((p: PagePlacement) => p.partIndex))
      if (partIndexes.size > 1) errors.push(`sheet ${si}: one piece mixes parts ${[...partIndexes]}`)
      const foldLines = sheet.front.guides.fold.filter((l) => inside({ x: l.x1, y: l.y1, width: l.x2 - l.x1, height: l.y2 - l.y1 }, trim))
      pieces.push({ sheet: si, trim, cells, cols: xs.length, rows: ys.length, partIndex: members[0].partIndex, backs: pieceBacks.length, foldLines })
    }
  })
  return pieces
}

// Turns the piece a quarter clockwise as seen from above. Lower-face vectors turn the other way in their mirrored frame.
function turnQuarter(cells: Cell[], cols: number, rows: number): [Cell[], number, number] {
  const out = clone(cells)
  for (const c of out) {
    const x = rows - 1 - c.y
    c.y = c.x
    c.x = x
    c.upper.up = [-c.upper.up[1] + 0, c.upper.up[0] + 0]
    c.lower.up = [c.lower.up[1] + 0, -c.lower.up[0] + 0]
  }
  return [out, rows, cols]
}

// Flips the piece over about a vertical line: faces swap and x mirrors, so vectors stay as they are.
function turnOver(cells: Cell[], cols: number): Cell[] {
  const out = clone(cells)
  for (const c of out) {
    c.x = cols - 1 - c.x
    const t = c.upper
    c.upper = c.lower
    c.lower = t
  }
  return out
}

// The eight ways to lay the cut piece on the table.
function layings(cells: Cell[], cols: number, rows: number): [Cell[], number, number][] {
  const out: [Cell[], number, number][] = []
  let current: [Cell[], number, number] = [cells, cols, rows]
  for (let r = 0; r < 4; r++) {
    out.push(current, [turnOver(current[0], current[1]), current[1], current[2]])
    current = turnQuarter(...current)
  }
  return out
}

type Direction = 'vertical' | 'horizontal'
interface Folded { pages: (number | null)[]; creases: { a: number; b: number; fold: number }[]; spineLeft: boolean }

// Right-angle folds by hand: each fold halves the stack along a vertical or horizontal line.
const directionsFor = (folds: number): Direction[] =>
  folds === 1 ? ['vertical'] : folds === 2 ? ['horizontal', 'vertical'] : ['vertical', 'horizontal', 'vertical']

// Every folding with all pages upright: per fold, which half moves (low or high) and whether it goes
// under or over. Reading order is top leaf to bottom, upper face then lower face.
function foldings(start: Cell[], cols: number, rows: number, directions: Direction[]): Folded[] {
  const results: Folded[] = []
  for (let choice = 0; choice < 4 ** directions.length; choice++) {
    let cells = clone(start)
    let w = cols
    let h = rows
    let layers = 1
    let spineLeft = true
    let possible = true
    const creases: Folded['creases'] = []
    for (const [k, direction] of directions.entries()) {
      const moveLow = ((choice >> (2 * k)) & 1) === 0
      const under = ((choice >> (2 * k + 1)) & 1) === 0
      const vertical = direction === 'vertical'
      const length = vertical ? w : h
      if (length % 2 !== 0) { possible = false; break }
      const half = length / 2
      // A crease joins two cells of the same layer that straddle the fold line.
      for (const a of cells) for (const b of cells) {
        if (a.id >= b.id || a.z !== b.z) continue
        const [pa, pb, qa, qb] = vertical ? [a.x, b.x, a.y, b.y] : [a.y, b.y, a.x, b.x]
        if (qa === qb && Math.min(pa, pb) === half - 1 && Math.max(pa, pb) === half) creases.push({ a: a.id, b: b.id, fold: k })
      }
      for (const c of cells) {
        const p = vertical ? c.x : c.y
        const moving = moveLow ? p < half : p >= half
        let next = p
        if (moving) {
          next = length - 1 - p
          c.z = under ? 2 * layers - 1 - c.z : layers - 1 - c.z
          const t = c.upper
          c.upper = c.lower
          c.lower = t
          // Folding about a horizontal line is a flip plus a half turn.
          if (!vertical) { c.upper.up = neg(c.upper.up); c.lower.up = neg(c.lower.up) }
        } else if (!under) {
          c.z += layers
        }
        if (next >= half) next -= half
        if (vertical) c.x = next
        else c.y = next
      }
      if (vertical) w = half
      else h = half
      layers *= 2
      spineLeft = moveLow
    }
    if (!possible) continue
    const upright = (f: Face) => (f.up[0] === 0 && f.up[1] === 0) || (f.up[0] === 0 && f.up[1] === -1)
    const stack = [...cells].sort((a, b) => a.z - b.z)
    if (!stack.every((c) => upright(c.upper) && upright(c.lower))) continue
    results.push({ pages: stack.flatMap((c) => [c.upper.page, c.lower.page]), creases, spineLeft })
  }
  return results
}

// Pages of piece k (0 = outermost) of signature s, in reading order once folded. Nested pieces of a
// signature take pages from both ends: the outermost has the first and last pages.
function nestedPages(layout: Layout, s: number, k: number, piecePages: number): (number | null)[] {
  const body = layout.body!
  const bodyPages = layout.allocations.find((a) => a.type === 'body')!.pdfPages
  const n = body.pagesPerSignature
  const half = piecePages / 2
  const first = bodyPages.slice(s * n + k * half, s * n + (k + 1) * half)
  const last = bodyPages.slice((s + 1) * n - (k + 1) * half, (s + 1) * n - k * half)
  return [...first, ...last]
}

// The book as read is the PDF: the boards before the body take its first pages, two each (cover, inside
// cover), and the boards after it its last pages (inside back cover, back cover).
function boardPages(spec: BookSpec, partIndex: number): [number, number] {
  const bodyIndex = spec.parts.findIndex((p) => p.type === 'body')
  const first = partIndex < bodyIndex ? 2 * partIndex : spec.pageSizes.length - 2 * (spec.parts.length - partIndex)
  return [first, first + 1]
}

// The body in book order, from the spec alone. Each board's strip wraps a blank leaf of the book block and is
// glued to both sides of it: the first leaf with boards before the body, the last with boards after it. In
// between come the PDF's pages between the boards' pages, then the padding blanks.
function bookOrder(spec: BookSpec, pages: number): (number | null)[] {
  const bodyIndex = spec.parts.findIndex((p) => p.type === 'body')
  const boardsAfter = spec.parts.length - 1 - bodyIndex
  const leafBefore: null[] = bodyIndex > 0 ? [null, null] : []
  const leafAfter: null[] = boardsAfter > 0 ? [null, null] : []
  const content = Array.from({ length: spec.pageSizes.length - 2 * (bodyIndex + boardsAfter) }, (_, i) => 2 * bodyIndex + i)
  const padding = Math.max(0, pages - leafBefore.length - content.length - leafAfter.length)
  return [...leafBefore, ...content, ...Array<null>(padding).fill(null), ...leafAfter]
}

const keyOf = (pages: (number | null)[]) => JSON.stringify([...pages].sort((a, b) => (a ?? -1) - (b ?? -1)))

export interface FoldCheck { pieces: number; errors: string[] }

/** Folds every piece of the layout by hand and returns what does not read as a book. */
export function checkPhysically(spec: BookSpec, layout: Layout): FoldCheck {
  const errors: string[] = []
  const pieces = cutOut(layout, spec, errors)
  const bodyAlloc = layout.allocations.find((a) => a.type === 'body')!
  const body = layout.body!
  const bodyPieces = pieces.filter((p) => p.partIndex === bodyAlloc.partIndex)
  const piecePages = 2 * bodyPieces[0].cells.length
  const signatures = bodyAlloc.pdfPages.length / body.pagesPerSignature
  const unclaimed = Array.from({ length: signatures * body.piecesPerSignature }, (_, i) =>
    nestedPages(layout, Math.floor(i / body.piecesPerSignature), i % body.piecesPerSignature, piecePages))
  if (bodyPieces.length !== unclaimed.length) errors.push(`expected ${unclaimed.length} body pieces, found ${bodyPieces.length}`)
  const order = bookOrder(spec, bodyAlloc.pdfPages.length)
  if (JSON.stringify(order) !== JSON.stringify(bodyAlloc.pdfPages)) {
    errors.push(`body pages ${JSON.stringify(bodyAlloc.pdfPages)} are not in book order ${JSON.stringify(order)}`)
  }

  for (const piece of pieces) {
    const isBody = piece.partIndex === bodyAlloc.partIndex
    const where = `sheet ${piece.sheet} part ${piece.partIndex}`
    let expected: (number | null)[]
    if (isBody) {
      if (piece.backs !== piece.cells.length) errors.push(`${where}: ${piece.backs} back pages for ${piece.cells.length} panels`)
      const pages = piece.cells.flatMap((c) => [c.upper.page, c.lower.page])
      const match = unclaimed.findIndex((e) => keyOf(e) === keyOf(pages))
      if (match < 0) { errors.push(`${where}: pages ${JSON.stringify(pages)} are no piece of any signature`); continue }
      expected = unclaimed.splice(match, 1)[0]
    } else {
      // A board prints its two pages side by side on the front, back empty, and folds at the fore-edge around
      // the body's blank first (or last) leaf, so its pages read first and last with the blank back faces,
      // glued to that leaf, between them. For a front board that is the cover on top and the inside cover,
      // upright, facing the book block below; for a back board, the inside back cover facing the book block
      // above and the back cover underneath. The spine must be on the right (the fold at the fore-edge), so a
      // strip with the cover and inside cover swapped cannot pass by being folded the other way.
      if (piece.backs !== 0) errors.push(`${where}: board has back pages`)
      if (piece.cells.length !== 2) errors.push(`${where}: board has ${piece.cells.length} panels`)
      const [first, last] = boardPages(spec, piece.partIndex)
      expected = [first, null, null, last]
    }
    const wantSpineLeft = isBody
    const folds = Math.log2(piece.cells.length)
    let found: Folded | undefined
    for (const [cells, cols, rows] of layings(piece.cells, piece.cols, piece.rows)) {
      found = foldings(cells, cols, rows, directionsFor(folds))
        .find((f) => f.spineLeft === wantSpineLeft && JSON.stringify(f.pages) === JSON.stringify(expected))
      if (found) break
    }
    if (!found) { errors.push(`${where}: no folding reads ${JSON.stringify(expected)}`); continue }

    const lastFold = folds - 1
    const creased = new Set<FoldLine>()
    for (const c of found.creases) {
      const [a, b] = [piece.cells[c.a].panel, piece.cells[c.b].panel]
      const [first, second] = a.x < b.x - EPS || a.y < b.y - EPS ? [a, b] : [b, a]
      const line = piece.foldLines.find((l) => spans(l, first, second))
      if (!line) { errors.push(`${where}: crease between ${JSON.stringify(first)} and ${JSON.stringify(second)} has no fold line`); continue }
      creased.add(line)
      if (line.opensByTrim !== (c.fold !== lastFold)) errors.push(`${where}: fold line ${JSON.stringify(line)} has the wrong opensByTrim`)
    }
    for (const line of piece.foldLines) if (!creased.has(line)) errors.push(`${where}: fold line ${JSON.stringify(line)} is never creased`)
  }

  const { width: W, height: H } = spec.print.sheet
  for (const [si, sheet] of layout.sheets.entries()) for (const side of ['front', 'back'] as const) {
    const ps = sheet[side].placements
    for (const p of ps) {
      if (!inside(p.clip, { x: 0, y: 0, width: W, height: H })) errors.push(`sheet ${si} ${side}: clip of page ${p.pdfPage} is off the sheet`)
      if (!inside(p.panel, p.clip)) errors.push(`sheet ${si} ${side}: panel of page ${p.pdfPage} is outside its clip`)
    }
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      if (overlaps(ps[i].clip, ps[j].clip)) errors.push(`sheet ${si} ${side}: clips of pages ${ps[i].pdfPage} and ${ps[j].pdfPage} overlap`)
    }
  }
  return { pieces: pieces.length, errors }
}
