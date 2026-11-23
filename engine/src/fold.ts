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

/**
 * One fold as made by hand, in panel units of the flat piece lying front face up: the crease is the line at
 * `at` along `axis` (a column or row boundary), from `from` to `to` along the other axis. The `moves` half
 * turns over onto the other, which stays put: under it for 'mountain', over it for 'valley', seen from above.
 */
export interface FoldStep {
  axis: FoldDirection
  at: number
  from: number
  to: number
  moves: 'left' | 'right' | 'top' | 'bottom'
  direction: 'mountain' | 'valley'
}

/** Cells are in front-view row-major order. In the back view a cell at front column c is at column cols - 1 - c. */
export interface PieceTemplate {
  cols: number
  rows: number
  folds: FoldDirection[]
  cells: TemplateCell[]
  /** Internal boundaries of the flat piece. `fold` is the 0-based index into `folds` of the fold that creates it. */
  boundaries: { axis: FoldDirection; index: number; fold: number }[]
  /** The folds that give `cells` their pages, in order: each puts the left/top half under the right/bottom half. */
  steps: FoldStep[]
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

  // The folded stack covers w x h panels of the flat piece from (left, top): the halves that stay put.
  let w = cols
  let h = rows
  let left = 0
  let top = 0
  let depth = 1
  const steps: FoldStep[] = []
  for (const [k, fold] of folds.entries()) {
    claimBoundaries(k, fold, (fold === 'vertical' ? w : h) / 2)
    // The step says what the loop below does: the left (top) half moves, and `z = 2 * depth - 1 - z` puts it
    // under the stack that stays (z 0 is the top), which is a mountain fold seen from above.
    if (fold === 'vertical') {
      steps.push({ axis: fold, at: left + w / 2, from: top, to: top + h, moves: 'left', direction: 'mountain' })
      left += w / 2
    } else {
      steps.push({ axis: fold, at: top + h / 2, from: left, to: left + w, moves: 'top', direction: 'mountain' })
      top += h / 2
    }
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
  return { cols, rows, folds, cells, boundaries, steps }
}
