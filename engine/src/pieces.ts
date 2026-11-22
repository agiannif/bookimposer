import type { BodySummary, FoldCount, PartAllocation } from './types.ts'
import { foldTemplate, rightAngleFolds } from './fold.ts'
import type { PieceTemplate } from './fold.ts'

export interface PanelAssignment {
  col: number
  row: number
  pdfPage: number | null
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
}

function foldLinesOf(template: PieceTemplate): Piece['foldLines'] {
  const spine = template.folds.length - 1
  return template.boundaries.map((b) => ({ axis: b.axis, index: b.index, opensByTrim: b.fold !== spine }))
}

/** Signature page (1-based) held by local page `i` of piece `k`; piece 0 is the outermost. */
function signaturePage(i: number, k: number, piecePages: number, signaturePages: number): number {
  const half = piecePages / 2
  return i <= half ? k * half + i : signaturePages - k * half - (piecePages - i)
}

export function bodyPieces(alloc: PartAllocation, body: BodySummary, folds: FoldCount): Piece[] {
  const template = foldTemplate(rightAngleFolds(folds))
  const signaturePages = body.pagesPerSignature
  const piecePages = 2 * template.cells.length
  const signatures = alloc.pdfPages.length / signaturePages
  const foldLines = foldLinesOf(template)

  const pieces: Piece[] = []
  for (let s = 0; s < signatures; s++) {
    for (let k = 0; k < body.piecesPerSignature; k++) {
      const pdfPageOf = (i: number) => alloc.pdfPages[s * signaturePages + signaturePage(i, k, piecePages, signaturePages) - 1]
      pieces.push({
        partIndex: alloc.partIndex,
        kind: 'body',
        cols: template.cols,
        rows: template.rows,
        front: template.cells.map((c) => ({ col: c.col, row: c.row, pdfPage: pdfPageOf(c.frontPage), rotation: c.rotation })),
        back: template.cells.map((c) => ({ col: template.cols - 1 - c.col, row: c.row, pdfPage: pdfPageOf(c.backPage), rotation: c.rotation })),
        foldLines,
      })
    }
  }
  return pieces
}

/** A board is a 2x1 piece with its two pages on the front. Front and back boards share this layout. */
export function boardPiece(alloc: PartAllocation): Piece {
  return {
    partIndex: alloc.partIndex,
    kind: 'board',
    cols: 2,
    rows: 1,
    front: alloc.pdfPages.map((pdfPage, col) => ({ col, row: 0, pdfPage, rotation: 0 })),
    back: [],
    foldLines: [{ axis: 'vertical', index: 1, opensByTrim: false }],
  }
}
