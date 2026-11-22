import type { Rect } from './geometry.ts'
import type { PrintSettings, Size } from './types.ts'

// Each slot is the piece's bleed box on the sheet front, already rotated if rotated.
export interface SlotFit { rotated: boolean; across: number; down: number; perSheet: number; slots: Rect[] }

export function pieceSize(cols: number, rows: number, panel: Size, bleed: number): Size {
  return { width: cols * panel.width + 2 * bleed, height: rows * panel.height + 2 * bleed }
}

function countAlong(sheetLen: number, pieceLen: number, margin: number, gap: number): number {
  return Math.max(0, Math.floor((sheetLen - 2 * margin + gap) / (pieceLen + gap)))
}

// Start of the grid along one axis: the leftover space is split evenly on each side.
function gridStart(sheetLen: number, pieceLen: number, count: number, margin: number, gap: number): number {
  const leftover = sheetLen - 2 * margin - (count * pieceLen + (count - 1) * gap)
  return margin + leftover / 2
}

function fitOriented(piece: Size, print: PrintSettings, rotated: boolean): SlotFit {
  const { sheet, margin, gap } = print
  const across = countAlong(sheet.width, piece.width, margin, gap)
  const down = countAlong(sheet.height, piece.height, margin, gap)
  const slots: Rect[] = []
  if (across > 0 && down > 0) {
    const x0 = gridStart(sheet.width, piece.width, across, margin, gap)
    const y0 = gridStart(sheet.height, piece.height, down, margin, gap)
    for (let row = 0; row < down; row++) {
      for (let col = 0; col < across; col++) {
        slots.push({
          x: x0 + col * (piece.width + gap),
          y: y0 + row * (piece.height + gap),
          width: piece.width,
          height: piece.height,
        })
      }
    }
  }
  return { rotated, across, down, perSheet: slots.length, slots }
}

// Cuts between neighbouring pieces in the grid.
const cutsOf = (fit: SlotFit) => (fit.across - 1) + (fit.down - 1)

// Most pieces per sheet wins; on a tie, fewer cuts; on a further tie, upright.
export function fitPieces(piece: Size, print: PrintSettings): SlotFit {
  const upright = fitOriented(piece, print, false)
  const turned = fitOriented({ width: piece.height, height: piece.width }, print, true)
  if (turned.perSheet !== upright.perSheet) return turned.perSheet > upright.perSheet ? turned : upright
  return cutsOf(turned) < cutsOf(upright) ? turned : upright
}
