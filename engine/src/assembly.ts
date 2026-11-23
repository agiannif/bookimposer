// The assembly steps: how the cut pieces fold, nest and gather into the book. They restate the folding that
// gave the pieces their pages (fold.ts, pieces.ts) in the sheet's terms, so that a builder working only from the
// printed sheets can follow them.
import { identity, mapSegment, rotateCw } from './geometry.ts'
import type { Rect } from './geometry.ts'
import type { Piece } from './pieces.ts'
import type { Assembly, AssemblyFold, AssemblyPiece, PartSpec, PieceSide, Size } from './types.ts'

// Turning a piece a quarter clockwise onto the sheet moves each of its sides here.
const QUARTER_CW: Record<PieceSide, PieceSide> = { left: 'top', top: 'right', right: 'bottom', bottom: 'left' }

/**
 * The piece's assembly entry. `slot` is the bleed box it fills on the sheet front; `turned` says it lies a
 * quarter clockwise there, as fitPieces turns it.
 */
export function assemblyPiece(
  piece: Piece, id: number, sheet: number, slot: Rect, turned: boolean, panel: Size, bleed: number,
): AssemblyPiece {
  const width = piece.cols * panel.width
  const height = piece.rows * panel.height
  const onSheet = turned ? rotateCw(90, width, height) : identity()
  const folds = piece.folds.map((step, order): AssemblyFold => {
    const [x1, y1, x2, y2] = step.axis === 'vertical'
      ? [step.at * panel.width, step.from * panel.height, step.at * panel.width, step.to * panel.height]
      : [step.from * panel.width, step.at * panel.height, step.to * panel.width, step.at * panel.height]
    return {
      order,
      line: mapSegment(onSheet, x1, y1, x2, y2),
      moves: turned ? QUARTER_CW[step.moves] : step.moves,
      direction: step.direction,
      opensByTrim: step.opensByTrim,
    }
  })
  return {
    id, sheet,
    slot: { x: slot.x + bleed, y: slot.y + bleed, width: slot.width - 2 * bleed, height: slot.height - 2 * bleed },
    cols: turned ? piece.rows : piece.cols,
    rows: turned ? piece.cols : piece.rows,
    turned, partIndex: piece.partIndex, kind: piece.kind, folds,
  }
}

/**
 * Nesting and gathering. Piece ids are indexes into impose's piece list: the body's pieces first, signature by
 * signature and outermost first (as bodyPieces makes them), then one per board in part order. The gathering
 * follows the parts: boards before the body wrap its first signature's first leaf, boards after it its last
 * signature's last leaf (the blank leaves the allocation puts there).
 */
export function gathering(
  parts: PartSpec[], bodyIndex: number, bodyPieceCount: number, piecesPerSignature: number,
  pieces: AssemblyPiece[], flipAxis: Assembly['flipAxis'],
): Assembly {
  const signatures = Array.from({ length: bodyPieceCount / piecesPerSignature }, (_, s) => ({
    partIndex: bodyIndex,
    pieces: Array.from({ length: piecesPerSignature }, (_, k) => s * piecesPerSignature + k),
  }))
  const boardParts = parts.flatMap((p, i) => (p.type === 'board' ? [i] : []))
  const boards = boardParts.map((partIndex, j): Assembly['boards'][number] => {
    const front = partIndex < bodyIndex
    return {
      pieceId: bodyPieceCount + j,
      position: front ? 'front' : 'back',
      wraps: front ? { signature: 0, leaf: 'first' } : { signature: signatures.length - 1, leaf: 'last' },
    }
  })
  const order = parts.flatMap((p, partIndex): Assembly['order'] => (p.type === 'body'
    ? signatures.map((_, index) => ({ kind: 'signature', index }))
    : [{ kind: 'board', index: boardParts.indexOf(partIndex) }]))
  return { flipAxis, pieces: [...pieces].sort((a, b) => a.id - b.id), signatures, boards, order }
}
