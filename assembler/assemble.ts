// Builds the book from the printed sheets by a Layout's assembly steps, as a person with scissors would. It
// uses only what is printed on each sheet side (which page lies where, turned how) and the Layout's
// `assembly`, and does exactly what the steps say: cuts each piece out along its slot, folds it fold by fold,
// nests the pieces into signatures, gathers the book block and wraps the boards around their leaves. It never
// looks at the allocations or the engine's folding code, so it gives the right book only if the steps and the
// sheets agree. The engine's tests and the app's 3D preview both build the book this way.
//
// It imports only the engine's types, never its code.
import type { Assembly, AssemblyFold, AssemblyPiece, Layout, PagePlacement, Rect, Rotation, SheetLine, Size } from '../engine/src/index.ts'
import { boundingBox, EPS, inside, near, neg, rotationFor, sameRect, upFor } from './geometry.ts'
import type { Vec } from './geometry.ts'

/** Where a face of the book was printed: a rect on one side of one sheet, in that side's coordinates. */
export interface FaceSource { sheet: number; side: 'front' | 'back'; region: Rect }
/**
 * One face of a leaf of the finished book. `page` is the 0-based PDF page printed there, null when blank.
 * Turned `rotation` degrees clockwise, the region as printed shows as the reader sees this face (the recto
 * with the book closed, the verso once its leaf is turned over at the spine). `hidden` faces are glued
 * out of sight: a board's inside halves and the blank leaf it wraps.
 */
export interface BookFace extends FaceSource { page: number | null; rotation: Rotation; hidden: boolean }
/**
 * A leaf of the finished book, top of the book first. `kind` is the kind of piece it was cut from: a board's
 * leaves are the covers. `size` is the leaf as read, width from spine to fore-edge.
 */
export interface BookLeaf { piece: number; kind: AssemblyPiece['kind']; size: Size; upper: BookFace; lower: BookFace }
/** The assembled book, and every step that could not be done or did not come out as a readable book. */
export interface AssembledBook { leaves: BookLeaf[]; errors: string[] }

// A face records its page and the direction of the page's top as a vector in y-down coordinates; `up` is null
// where nothing is printed. `frame` is where the top of the printed region points, so it is set on blank
// faces too. Upper faces are seen from above, lower faces from below, which mirrors x, so an upright page
// reads [0, -1] on either face. `z` is the leaf's layer in its stack, 0 on top.
interface Face extends FaceSource { page: number | null; up: Vec | null; frame: Vec }
interface Leaf { piece: AssemblyPiece; rect: Rect; size: Size; z: number; upper: Face; lower: Face }
interface Crease { line: SheetLine; opensByTrim: boolean }
type Edge = 'left' | 'right' | 'top' | 'bottom'

const AREA_EPS = 1e-3

/** Cuts the piece out of its sheet: one leaf per front panel, with the page printed behind it as its lower face. */
function cut(layout: Layout, assembly: Assembly, piece: AssemblyPiece, used: Set<PagePlacement>, errors: string[]): Leaf[] {
  const where = `piece ${piece.id}`
  const sheet = layout.sheets[piece.sheet]
  if (!sheet) { errors.push(`${where}: no sheet ${piece.sheet}`); return [] }
  const { width: W, height: H } = layout.sheet
  // Where a back placement lies, seen on the front: turning the sheet over mirrors one axis.
  const verticalAxis = assembly.flipAxis === 'vertical'
  const behind = (r: Rect): Rect => (verticalAxis ? { ...r, x: W - r.x - r.width } : { ...r, y: H - r.y - r.height })
  const fronts = sheet.front.placements.filter((p) => inside(p.panel, piece.slot))
  const backs = sheet.back.placements.filter((p) => inside(behind(p.panel), piece.slot))
  for (const p of [...fronts, ...backs]) {
    if (used.has(p)) errors.push(`${where}: page ${p.pdfPage} on sheet ${piece.sheet} is already in another piece`)
    used.add(p)
  }
  if (fronts.length !== piece.cols * piece.rows) errors.push(`${where}: ${fronts.length} front panels for ${piece.cols}x${piece.rows}`)
  const area = fronts.reduce((sum, p) => sum + p.panel.width * p.panel.height, 0)
  if (Math.abs(area - piece.slot.width * piece.slot.height) > AREA_EPS) errors.push(`${where}: its front panels do not fill its slot`)
  const matched = new Set<PagePlacement>()
  const leaves = fronts.map((p): Leaf => {
    const back = backs.filter((b) => sameRect(behind(b.panel), p.panel))
    if (back.length > 1) errors.push(`${where}: two back pages behind front page ${p.pdfPage}`)
    back.forEach((b) => matched.add(b))
    // Seen from below, the back of a vertical-axis flip is the back side as printed; a horizontal-axis flip
    // turns it a further 180 degrees.
    const backFrame = (v: Vec) => (verticalAxis ? v : neg(v))
    const sheetSide = { sheet: piece.sheet, side: 'back' as const }
    const lower: Face = back.length > 0
      ? { ...sheetSide, region: back[0].panel, page: back[0].pdfPage, up: backFrame(upFor(back[0].rotation)), frame: backFrame(upFor(0)) }
      : { ...sheetSide, region: behind(p.panel), page: null, up: null, frame: backFrame(upFor(0)) }
    const rect = { ...p.panel, x: p.panel.x - piece.slot.x, y: p.panel.y - piece.slot.y }
    const upper: Face = { sheet: piece.sheet, side: 'front', region: p.panel, page: p.pdfPage, up: upFor(p.rotation), frame: upFor(0) }
    return { piece, rect, size: { width: rect.width, height: rect.height }, z: 0, upper, lower }
  })
  if (matched.size !== backs.length) errors.push(`${where}: a back page lies behind no front panel`)
  return leaves
}

const swapFaces = (leaf: Leaf) => { [leaf.upper, leaf.lower] = [leaf.lower, leaf.upper] }

/** Folds the stack along the fold's line: its `moves` half turns over onto the other half, under it for a mountain fold. */
function fold(leaves: Leaf[], creases: Crease[], f: AssemblyFold, where: string, errors: string[]): Crease[] {
  const vertical = near(f.line.x1, f.line.x2)
  if (vertical === near(f.line.y1, f.line.y2)) { errors.push(`${where}: fold ${f.order} is not a straight axis line`); return creases }
  if (!(vertical ? ['left', 'right'] : ['top', 'bottom']).includes(f.moves)) {
    errors.push(`${where}: fold ${f.order} along a ${vertical ? 'vertical' : 'horizontal'} line cannot move its ${f.moves} half`)
    return creases
  }
  const at = vertical ? f.line.x1 : f.line.y1
  const box = boundingBox(leaves.map((l) => l.rect))
  const [lo, hi] = vertical ? [box.x, box.x + box.width] : [box.y, box.y + box.height]
  const [from, to] = vertical ? [f.line.y1, f.line.y2] : [f.line.x1, f.line.x2]
  const [alongLo, alongHi] = vertical ? [box.y, box.y + box.height] : [box.x, box.x + box.width]
  if (!near(at - lo, hi - at) || !near(from, alongLo) || !near(to, alongHi)) {
    errors.push(`${where}: fold ${f.order} does not halve the stack along its full length`)
    return creases
  }
  const layers = Math.max(...leaves.map((l) => l.z)) + 1
  const lowMoves = f.moves === 'left' || f.moves === 'top'
  const reflect = (v: number) => 2 * at - v + 0
  for (const leaf of leaves) {
    const r = leaf.rect
    const [start, end] = vertical ? [r.x, r.x + r.width] : [r.y, r.y + r.height]
    if (start < at - EPS && end > at + EPS) errors.push(`${where}: fold ${f.order} runs through a panel`)
    if ((end <= at + EPS) !== lowMoves) {
      if (f.direction === 'valley') leaf.z += layers
      continue
    }
    if (vertical) r.x = reflect(r.x + r.width)
    else r.y = reflect(r.y + r.height)
    swapFaces(leaf)
    // Turning over about a horizontal line is turning over about a vertical one plus a half turn.
    if (!vertical) {
      for (const face of [leaf.upper, leaf.lower]) {
        if (face.up) face.up = neg(face.up)
        face.frame = neg(face.frame)
      }
    }
    leaf.z = f.direction === 'mountain' ? 2 * layers - 1 - leaf.z : layers - 1 - leaf.z
  }
  // Earlier creases that cross the line are split by it; the parts on the moving half turn over with it.
  const split = creases.flatMap((c): Crease[] => {
    const [a, b] = vertical ? [c.line.x1, c.line.x2] : [c.line.y1, c.line.y2]
    if (!(a < at - EPS && b > at + EPS)) return [c]
    return vertical
      ? [{ ...c, line: { ...c.line, x2: at } }, { ...c, line: { ...c.line, x1: at } }]
      : [{ ...c, line: { ...c.line, y2: at } }, { ...c, line: { ...c.line, y1: at } }]
  })
  const moved = split.map((c): Crease => {
    const mid = vertical ? (c.line.x1 + c.line.x2) / 2 : (c.line.y1 + c.line.y2) / 2
    if ((mid < at) !== lowMoves) return c
    return vertical
      ? { ...c, line: { ...c.line, x1: reflect(c.line.x2), x2: reflect(c.line.x1) } }
      : { ...c, line: { ...c.line, y1: reflect(c.line.y2), y2: reflect(c.line.y1) } }
  })
  return [...moved, { line: f.line, opensByTrim: f.opensByTrim }]
}

function edgeOf(line: SheetLine, box: Rect): Edge | null {
  if (near(line.x1, line.x2)) return near(line.x1, box.x) ? 'left' : near(line.x1, box.x + box.width) ? 'right' : null
  return near(line.y1, box.y) ? 'top' : near(line.y1, box.y + box.height) ? 'bottom' : null
}

// Turning the section a quarter counter-clockwise, seen from above, moves each edge here.
const QUARTER_CCW: Record<Edge, Edge> = { top: 'left', right: 'top', bottom: 'right', left: 'bottom' }

/** Cuts, folds and turns one piece; returns its section's leaves top first. */
function section(layout: Layout, assembly: Assembly, piece: AssemblyPiece, used: Set<PagePlacement>, errors: string[]): Leaf[] {
  const where = `piece ${piece.id}`
  const leaves = cut(layout, assembly, piece, used, errors)
  if (leaves.length === 0) return []
  let creases: Crease[] = []
  const folds = [...piece.folds].sort((a, b) => a.order - b.order)
  for (const f of folds) creases = fold(leaves, creases, f, where, errors)
  if (!leaves.every((l) => sameRect(l.rect, leaves[0].rect))) errors.push(`${where}: does not fold down to one section`)
  const box = leaves[0].rect
  let edges = creases.map((c) => ({ edge: edgeOf(c.line, box), opensByTrim: c.opensByTrim }))
  if (piece.turned) {
    // A turned piece's pages have their top toward the sheet's right edge; a quarter turn back stands them up.
    const ccw = (v: Vec): Vec => [v[1] + 0, -v[0] + 0]
    // Seen from below, which mirrors x, the same turn is clockwise.
    const cw = (v: Vec): Vec => [-v[1] + 0, v[0] + 0]
    for (const leaf of leaves) {
      if (leaf.upper.up) leaf.upper.up = ccw(leaf.upper.up)
      leaf.upper.frame = ccw(leaf.upper.frame)
      if (leaf.lower.up) leaf.lower.up = cw(leaf.lower.up)
      leaf.lower.frame = cw(leaf.lower.frame)
      leaf.size = { width: leaf.size.height, height: leaf.size.width }
    }
    edges = edges.map((e) => ({ ...e, edge: e.edge && QUARTER_CCW[e.edge] }))
  }
  // A body section's spine is its uncut fold, on the left; folds that open by trim lie elsewhere. A board
  // folds at the fore-edge.
  for (const e of edges) {
    const ok = piece.kind === 'board' ? e.edge === 'right' : (e.edge === 'left') === !e.opensByTrim
    if (!ok) errors.push(`${where}: a ${e.opensByTrim ? 'fold that opens by trim' : 'spine fold'} ends up at the ${e.edge ?? 'middle'}`)
  }
  return [...leaves].sort((a, b) => a.z - b.z)
}

/** Assembles the book from the printed sheets by the Layout's assembly steps. */
export function assemble(layout: Layout): AssembledBook {
  const errors: string[] = []
  const assembly = layout.assembly
  if (!assembly) return { leaves: [], errors: ['the layout has no assembly'] }
  const used = new Set<PagePlacement>()
  const sections = new Map(assembly.pieces.map((p) => [p.id, { piece: p, leaves: section(layout, assembly, p, used, errors) }]))
  const claimed = new Set<number>()
  const claim = (id: number, kind: AssemblyPiece['kind']): Leaf[] => {
    const s = sections.get(id)
    if (!s) { errors.push(`no piece ${id}`); return [] }
    if (claimed.has(id)) errors.push(`piece ${id} is used twice`)
    if (s.piece.kind !== kind) errors.push(`piece ${id} is a ${s.piece.kind}, used as a ${kind}`)
    claimed.add(id)
    return s.leaves
  }

  // Each listed piece goes into the middle of the section so far, where its centre fold is.
  const signatures = assembly.signatures.map((sig) => {
    const stack: Leaf[] = []
    for (const id of sig.pieces) stack.splice(stack.length / 2, 0, ...claim(id, 'body'))
    return stack
  })

  const book: { leaf: Leaf; signature: number | null }[] = []
  const gathered = { signature: new Map<number, number>(), board: new Map<number, number>() }
  assembly.order.forEach((step, i) => {
    const at = gathered[step.kind]
    if (at.has(step.index)) errors.push(`${step.kind} ${step.index} is gathered twice`)
    at.set(step.index, i)
    if (step.kind === 'signature') book.push(...(signatures[step.index] ?? []).map((leaf) => ({ leaf, signature: step.index })))
  })
  if (gathered.signature.size !== signatures.length || gathered.board.size !== assembly.boards.length) {
    errors.push('the gathering order does not hold every signature and board once')
  }

  // A board's strip goes around its leaf: its top half above, its bottom half below, glued to both sides.
  const hidden = new Set<Face>()
  const wrappedLeaves = new Set<Leaf>()
  for (const [j, board] of assembly.boards.entries()) {
    const leaves = claim(board.pieceId, 'board')
    if (leaves.length !== 2) { errors.push(`board ${j} has ${leaves.length} leaves`); continue }
    const { signature, leaf } = board.wraps
    const wrapped = leaf === 'first' ? book.findIndex((b) => b.signature === signature) : book.findLastIndex((b) => b.signature === signature)
    if (wrapped < 0) { errors.push(`board ${j} wraps signature ${signature}, which is not in the book`); continue }
    const before = (gathered.board.get(j) ?? -1) < (gathered.signature.get(signature) ?? -1)
    if (before !== (board.position === 'front')) errors.push(`board ${j} is gathered on the wrong side of signature ${signature}`)
    if (wrappedLeaves.has(book[wrapped].leaf)) errors.push(`board ${j} wraps a leaf another board already wraps`)
    wrappedLeaves.add(book[wrapped].leaf)
    const [outer, inner] = leaves
    hidden.add(outer.lower).add(inner.upper).add(book[wrapped].leaf.upper).add(book[wrapped].leaf.lower)
    book.splice(wrapped + 1, 0, { leaf: inner, signature: null })
    book.splice(wrapped, 0, { leaf: outer, signature: null })
  }
  for (const id of sections.keys()) if (!claimed.has(id)) errors.push(`piece ${id} is never assembled`)
  const placements = layout.sheets.flatMap((s) => [...s.front.placements, ...s.back.placements])
  if (placements.some((p) => !used.has(p))) errors.push('a printed page lies in no piece')

  const bookFace = (face: Face): BookFace => {
    const isHidden = hidden.has(face)
    if (isHidden && face.page !== null) errors.push(`page ${face.page} is glued out of sight`)
    if (!isHidden && face.up && !(face.up[0] === 0 && face.up[1] === -1)) errors.push(`page ${face.page} is not upright`)
    return { sheet: face.sheet, side: face.side, region: face.region, page: face.page, rotation: rotationFor(face.frame), hidden: isHidden }
  }
  const leaves = book.map(({ leaf }): BookLeaf => ({
    piece: leaf.piece.id, kind: leaf.piece.kind, size: leaf.size, upper: bookFace(leaf.upper), lower: bookFace(leaf.lower),
  }))
  return { leaves, errors }
}

/** The pages a reader sees, in reading order: every face of the book that is not glued out of sight. */
export function visiblePages(book: AssembledBook): (number | null)[] {
  return book.leaves.flatMap((leaf) => [leaf.upper, leaf.lower]).filter((face) => !face.hidden).map((face) => face.page)
}
