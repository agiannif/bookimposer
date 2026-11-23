import type { BodySummary, FoldCount, PartAllocation } from './types.ts'
import { foldTemplate, rightAngleFolds } from './fold.ts'
import type { FoldStep, PieceTemplate } from './fold.ts'

export interface PanelAssignment {
  col: number
  row: number
  pdfPage: number | null
  /** Index into the part's allocation `pdfPages`. */
  partPage: number
  rotation: 0 | 180
}

export interface Piece {
  partIndex: number
  kind: 'body' | 'board'
  cols: number
  rows: number
  front: PanelAssignment[]
  /** Entries use back-view columns (front column c is at cols - 1 - c) and are not sorted. */
  back: PanelAssignment[]
  /** `index` is the panel boundary, between column index-1 and index (or row index-1 and index). */
  foldLines: { axis: 'vertical' | 'horizontal'; index: number; opensByTrim: boolean }[]
  /** How to fold the flat piece, in order and in panel units, as it lies front face up in this piece's own frame. */
  folds: (FoldStep & { opensByTrim: boolean })[]
}

function foldLinesOf(template: PieceTemplate): Piece['foldLines'] {
  const spine = template.folds.length - 1
  return template.boundaries.map((b) => ({ axis: b.axis, index: b.index, opensByTrim: b.fold !== spine }))
}

// Every fold but the last opens by trim; the last is the spine.
const foldsOf = (template: PieceTemplate): Piece['folds'] =>
  template.steps.map((step, k) => ({ ...step, opensByTrim: k !== template.steps.length - 1 }))

/** Signature page (1-based) held by local page `i` of piece `k`; piece 0 is the outermost. */
function signaturePage(i: number, k: number, piecePages: number, signaturePages: number): number {
  const half = piecePages / 2
  return i <= half ? k * half + i : signaturePages - k * half - (piecePages - i)
}

/** The body's pieces, signature by signature, each signature's outermost piece first. */
export function bodyPieces(alloc: PartAllocation, body: BodySummary, folds: FoldCount): Piece[] {
  const template = foldTemplate(rightAngleFolds(folds))
  const signaturePages = body.pagesPerSignature
  const piecePages = 2 * template.cells.length
  const signatures = alloc.pdfPages.length / signaturePages
  const foldLines = foldLinesOf(template)
  const foldSteps = foldsOf(template)

  const pieces: Piece[] = []
  for (let s = 0; s < signatures; s++) {
    for (let k = 0; k < body.piecesPerSignature; k++) {
      const partPageOf = (i: number) => s * signaturePages + signaturePage(i, k, piecePages, signaturePages) - 1
      const assignment = (col: number, row: number, page: number, rotation: 0 | 180): PanelAssignment =>
        ({ col, row, pdfPage: alloc.pdfPages[partPageOf(page)], partPage: partPageOf(page), rotation })
      pieces.push({
        partIndex: alloc.partIndex,
        kind: 'body',
        cols: template.cols,
        rows: template.rows,
        front: template.cells.map((c) => assignment(c.col, c.row, c.frontPage, c.rotation)),
        back: template.cells.map((c) => assignment(template.cols - 1 - c.col, c.row, c.backPage, c.rotation)),
        foldLines,
        folds: foldSteps,
      })
    }
  }
  return pieces
}

/**
 * A board is a 2x1 piece with its two pages on the front, in its allocation's order. Front and back boards share
 * this layout. It folds once at the fore-edge, backs together: the first page stays on top and the second turns
 * under it, so the blank backs face each other around the leaf the board wraps.
 */
export function boardPiece(alloc: PartAllocation): Piece {
  return {
    partIndex: alloc.partIndex,
    kind: 'board',
    cols: 2,
    rows: 1,
    front: alloc.pdfPages.map((pdfPage, col) => ({ col, row: 0, pdfPage, partPage: col, rotation: 0 })),
    back: [],
    foldLines: [{ axis: 'vertical', index: 1, opensByTrim: false }],
    folds: [{ axis: 'vertical', at: 1, from: 0, to: 1, moves: 'right', direction: 'mountain', opensByTrim: false }],
  }
}
