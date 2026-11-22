import type { FoldCount } from './types.ts'

export type FoldDirection = 'vertical' | 'horizontal'

/** One panel of a folded piece. Pages are local to the piece, 1..2^(n+1). `rotation` applies to both faces. */
export interface TemplateCell {
  col: number
  row: number
  frontPage: number
  backPage: number
  rotation: 0 | 180
}

/** Cells are in front-view row-major order. In the back view a cell at front column c is at column cols - 1 - c. */
export interface PieceTemplate {
  cols: number
  rows: number
  folds: FoldDirection[]
  cells: TemplateCell[]
  /** Internal boundaries of the flat piece. `fold` is the 0-based index into `folds` of the fold that creates it. */
  boundaries: { axis: FoldDirection; index: number; fold: number }[]
}

export function rightAngleFolds(folds: FoldCount): FoldDirection[] {
  if (folds === 1) return ['vertical']
  if (folds === 2) return ['horizontal', 'vertical']
  return ['vertical', 'horizontal', 'vertical']
}

interface Panel {
  x: number
  y: number
  z: number
  faceUp: 'front' | 'back'
  flipY: boolean
}

const toggle = (face: 'front' | 'back') => (face === 'front' ? 'back' : 'front')

/** Simulates folding a flat sheet; each fold puts the left/top half under the right/bottom half. */
export function foldTemplate(folds: FoldDirection[]): PieceTemplate {
  const cols = 2 ** folds.filter((f) => f === 'vertical').length
  const rows = 2 ** folds.filter((f) => f === 'horizontal').length
  const panels: Panel[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      panels.push({ x: col, y: row, z: 0, faceUp: 'front', flipY: false })
    }
  }

  const boundaries: PieceTemplate['boundaries'] = []
  const claimBoundaries = (fold: number, axis: FoldDirection, half: number) => {
    const length = axis === 'vertical' ? cols : rows
    const lines = axis === 'vertical' ? rows : cols
    const pos = (p: Panel) => (axis === 'vertical' ? p.x : p.y)
    for (let index = 1; index < length; index++) {
      if (boundaries.some((b) => b.axis === axis && b.index === index)) continue
      for (let line = 0; line < lines; line++) {
        const at = (i: number) => (axis === 'vertical' ? panels[line * cols + i] : panels[i * cols + line])
        const sides = [pos(at(index - 1)), pos(at(index))].sort((a, b) => a - b)
        if (sides[0] === half - 1 && sides[1] === half) {
          boundaries.push({ axis, index, fold })
          break
        }
      }
    }
  }

  let w = cols
  let h = rows
  let depth = 1
  for (const [k, fold] of folds.entries()) {
    claimBoundaries(k, fold, (fold === 'vertical' ? w : h) / 2)
    for (const p of panels) {
      if (fold === 'vertical') {
        if (p.x < w / 2) {
          p.x = w - 1 - p.x - w / 2
          p.z = 2 * depth - 1 - p.z
          p.faceUp = toggle(p.faceUp)
        } else {
          p.x -= w / 2
        }
      } else if (p.y < h / 2) {
        p.y = h - 1 - p.y - h / 2
        p.z = 2 * depth - 1 - p.z
        p.faceUp = toggle(p.faceUp)
        p.flipY = !p.flipY
      } else {
        p.y -= h / 2
      }
    }
    if (fold === 'vertical') w /= 2
    else h /= 2
    depth *= 2
  }

  // panels were created row-major, so the cells keep that order
  const cells = panels.map((p, i): TemplateCell => {
    const upper = 2 * p.z + 1
    const lower = 2 * p.z + 2
    return {
      col: i % cols,
      row: Math.floor(i / cols),
      frontPage: p.faceUp === 'front' ? upper : lower,
      backPage: p.faceUp === 'front' ? lower : upper,
      rotation: p.flipY ? 180 : 0,
    }
  })
  boundaries.sort((a, b) => (a.axis === b.axis ? a.index - b.index : a.axis === 'vertical' ? -1 : 1))
  return { cols, rows, folds, cells, boundaries }
}
