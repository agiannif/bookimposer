import { applyPoint, applyRect, compose, identity, mirrorX, rotateCw, rotationOf, translate } from './geometry.ts'
import type { Affine } from './geometry.ts'
import { allocatePages } from './allocate.ts'
import { validateSpec } from './validate.ts'
import { fitPieces, pieceSize } from './fit.ts'
import type { SlotFit } from './fit.ts'
import { boardPiece, bodyPieces } from './pieces.ts'
import type { PanelAssignment, Piece } from './pieces.ts'
import type { Rect, Rotation } from './geometry.ts'
import type { BookSpec, DuplexFlip, MismatchPolicy, FoldLine, Issue, Layout, PagePlacement, Sheet, SheetLine, SheetSide, Size } from './types.ts'

const emptyLayout = (issues: Issue[], allocations: Layout['allocations'] = [], body: Layout['body'] = null): Layout => ({
  sheets: [], allocations, body, perSheet: [], fillers: { count: 0, size: { width: 0, height: 0 } }, issues,
})

interface Group { cols: number; rows: number; pieces: Piece[] }

// Pieces of the same size share sheets. Groups come out in order of their first piece.
function groupBySize(pieces: Piece[]): Group[] {
  const groups: Group[] = []
  for (const piece of pieces) {
    let group = groups.find((g) => g.cols === piece.cols && g.rows === piece.rows)
    if (!group) {
      group = { cols: piece.cols, rows: piece.rows, pieces: [] }
      groups.push(group)
    }
    group.pieces.push(piece)
  }
  return groups
}

const MISMATCH_TOLERANCE = 0.5

const isMismatched = (page: Size, panel: Size) =>
  Math.abs(page.width - panel.width) > MISMATCH_TOLERANCE || Math.abs(page.height - panel.height) > MISMATCH_TOLERANCE

// Where a page's content lands inside its panel: scaled to fit, or at its own size, centered.
function contentWithin(local: Rect, page: Size, policy: MismatchPolicy): Rect {
  const scale = policy === 'fit' ? Math.min(local.width / page.width, local.height / page.height) : 1
  const width = scale * page.width
  const height = scale * page.height
  return { x: local.x + (local.width - width) / 2, y: local.y + (local.height - height) / 2, width, height }
}

function placementsOf(
  assignments: PanelAssignment[], piece: Piece, transform: Affine, panel: Size, bleed: number, spec: BookSpec,
): PagePlacement[] {
  const ordered = [...assignments].sort((a, b) => a.row - b.row || a.col - b.col)
  return ordered.map((cell) => {
    const local = { x: bleed + cell.col * panel.width, y: bleed + cell.row * panel.height, width: panel.width, height: panel.height }
    const rect = applyRect(transform, local)
    const pageSize = cell.pdfPage === null ? null : spec.pageSizes[cell.pdfPage]
    const content = pageSize && isMismatched(pageSize, panel)
      ? applyRect(transform, contentWithin(local, pageSize, spec.mismatch))
      : rect
    // Bleed extends the clip past the panel only where the panel meets the piece's outer edge.
    const left = cell.col === 0 ? bleed : 0
    const top = cell.row === 0 ? bleed : 0
    const right = cell.col === piece.cols - 1 ? bleed : 0
    const bottom = cell.row === piece.rows - 1 ? bleed : 0
    const clip = applyRect(transform, {
      x: local.x - left, y: local.y - top,
      width: panel.width + left + right, height: panel.height + top + bottom,
    })
    return {
      pdfPage: cell.pdfPage,
      partIndex: piece.partIndex,
      panel: rect,
      content,
      clip,
      rotation: ((cell.rotation + rotationOf(transform)) % 360) as Rotation,
    }
  })
}

// Segment between two piece-local points, mapped to the sheet and ordered so x1 <= x2 and y1 <= y2.
function sheetLine(m: Affine, x1: number, y1: number, x2: number, y2: number): SheetLine {
  const a = applyPoint(m, x1, y1)
  const b = applyPoint(m, x2, y2)
  return { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) }
}

const LINE_TOLERANCE = 1e-6

const sameLine = (a: SheetLine, b: SheetLine) =>
  Math.abs(a.x1 - b.x1) < LINE_TOLERANCE && Math.abs(a.y1 - b.y1) < LINE_TOLERANCE
  && Math.abs(a.x2 - b.x2) < LINE_TOLERANCE && Math.abs(a.y2 - b.y2) < LINE_TOLERANCE

function buildSheet(pieces: Piece[], fit: SlotFit, size: Size, panel: Size, spec: BookSpec): Sheet {
  const { sheet: sheetSize, duplex, bleed } = spec.print
  const front: SheetSide = { placements: [] }
  const back: SheetSide = { placements: [] }
  const cutLines: SheetLine[] = []
  const foldLines: FoldLine[] = []
  // A horizontal flip axis (long edge on a landscape sheet, short edge on a portrait one) turns the whole back side 180 degrees.
  const verticalAxis = (duplex === 'long-edge') === (sheetSize.height >= sheetSize.width)
  pieces.forEach((piece, i) => {
    const slot = fit.slots[i]
    const { width: pw, height: ph } = size
    const frontTransform = compose(translate(slot.x, slot.y), fit.rotated ? rotateCw(90, pw, ph) : identity())
    const canonicalBack = compose(mirrorX(sheetSize.width), compose(frontTransform, mirrorX(pw)))
    const backTransform = verticalAxis ? canonicalBack : compose(rotateCw(180, sheetSize.width, sheetSize.height), canonicalBack)
    const trim = { x1: bleed, y1: bleed, x2: bleed + piece.cols * panel.width, y2: bleed + piece.rows * panel.height }
    const edges = [
      sheetLine(frontTransform, trim.x1, trim.y1, trim.x2, trim.y1),
      sheetLine(frontTransform, trim.x1, trim.y2, trim.x2, trim.y2),
      sheetLine(frontTransform, trim.x1, trim.y1, trim.x1, trim.y2),
      sheetLine(frontTransform, trim.x2, trim.y1, trim.x2, trim.y2),
    ]
    // Touching pieces (gap 0, bleed 0) share an edge; it is cut once.
    for (const edge of edges) if (!cutLines.some((l) => sameLine(l, edge))) cutLines.push(edge)
    for (const fold of piece.foldLines) {
      const line = fold.axis === 'vertical'
        ? sheetLine(frontTransform, bleed + fold.index * panel.width, trim.y1, bleed + fold.index * panel.width, trim.y2)
        : sheetLine(frontTransform, trim.x1, bleed + fold.index * panel.height, trim.x2, bleed + fold.index * panel.height)
      foldLines.push({ ...line, opensByTrim: fold.opensByTrim })
    }
    front.placements.push(...placementsOf(piece.front, piece, frontTransform, panel, bleed, spec))
    back.placements.push(...placementsOf(piece.back, piece, backTransform, panel, bleed, spec))
  })
  return { front, back, cutLines, foldLines }
}

export function impose(spec: BookSpec): Layout {
  const invalid = validateSpec(spec)
  if (invalid.length > 0) return emptyLayout(invalid)

  const { allocations, body, issues } = allocatePages(spec)
  if (issues.some((i) => i.severity === 'error') || !body) return emptyLayout(issues, allocations, body)

  const bodyIndex = allocations.findIndex((a) => a.type === 'body')
  const bodyPart = spec.parts[bodyIndex]
  if (bodyPart.type !== 'body') throw new Error('unreachable')
  const firstBodyPage = allocations[bodyIndex].pdfPages[0]
  if (firstBodyPage === null) throw new Error('body starts with a blank page')
  const panel = spec.pageSizes[firstBodyPage]
  const { bleed } = spec.print

  const boards = allocations.filter((a) => a.type === 'board')
  const pieces = [
    ...bodyPieces(allocations[bodyIndex], body, bodyPart.folds),
    ...boards.map(boardPiece),
  ]

  const mismatched = [...new Set(allocations.flatMap((a) => a.pdfPages))]
    .filter((p): p is number => p !== null && isMismatched(spec.pageSizes[p], panel))
    .sort((a, b) => a - b)
  if (mismatched.length > 0) {
    issues.push({
      code: 'page-size-mismatch', severity: 'warning',
      message: 'Some pages differ in size from the panel.',
      data: { pages: mismatched },
    })
  }

  const sheets: Sheet[] = []
  const perSheet: Layout['perSheet'] = []
  for (const group of groupBySize(pieces)) {
    const size = pieceSize(group.cols, group.rows, panel, bleed)
    const fit = fitPieces(size, spec.print)
    if (fit.perSheet === 0) {
      return emptyLayout([...issues, {
        code: 'piece-does-not-fit', severity: 'error',
        message: 'A piece is too large for the sheet.',
        data: { width: size.width, height: size.height },
      }], allocations, body)
    }
    const unspaced = fitPieces(pieceSize(group.cols, group.rows, panel, 0), { ...spec.print, margin: 0, gap: 0, bleed: 0 })
    if (unspaced.perSheet > fit.perSheet) {
      issues.push({
        code: 'spacing-reduces-fit', severity: 'warning',
        message: 'Margin, gap or bleed fits fewer pieces on a sheet.',
        data: { perSheet: fit.perSheet, perSheetWithoutSpacing: unspaced.perSheet },
      })
    }
    let count = 0
    for (let start = 0; start < group.pieces.length; start += fit.perSheet) {
      sheets.push(buildSheet(group.pieces.slice(start, start + fit.perSheet), fit, size, panel, spec))
      count++
    }
    perSheet.push({
      partIndexes: [...new Set(group.pieces.map((p) => p.partIndex))],
      perSheet: fit.perSheet,
      sheets: count,
    })
  }
  return { sheets, allocations, body, perSheet, fillers: { count: boards.length, size: panel }, issues }
}
