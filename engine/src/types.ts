import type { Rect, Rotation } from './geometry.ts'
export interface Size { width: number; height: number }
export type DuplexFlip = 'long-edge' | 'short-edge'
export type MismatchPolicy = 'fit' | 'center'
export interface PrintSettings { sheet: Size; duplex: DuplexFlip; margin: number; gap: number; bleed: number }
export type FoldCount = 1 | 2 | 3
export type PartSpec = { type: 'body'; signatures: number; folds: FoldCount } | { type: 'board' }
// pageSizes.length is the PDF page count; each entry is that page's TrimBox (or MediaBox) size.
export interface BookSpec { pageSizes: Size[]; parts: PartSpec[]; print: PrintSettings; mismatch: MismatchPolicy }
// 'no-room-for-marks': a sheet has cut or fold lines of a kind but none of that kind's ticks fit outside its clips;
// data.sheet is the 0-based sheet index, data.cut and data.fold say which kinds. It is raised whether or not marks
// are drawn: drawing them is the exporter's choice, and issuesForMarks keeps only the ones for drawn kinds.
// 'too-many-signatures': some signature would be entirely blank. data.maxSignatures is the most
// that can hold content; every count above it fails, and so do a few below it, since all
// signatures are one size.
// 'too-many-boards': more than one board before or after the body; each wraps the body's first or last leaf.
export type IssueCode = 'no-body' | 'multiple-bodies' | 'too-many-boards' | 'invalid-signatures' | 'no-body-pages'
  | 'too-many-signatures' | 'piece-does-not-fit' | 'spacing-reduces-fit' | 'page-size-mismatch'
  | 'invalid-page-size' | 'invalid-print-settings' | 'no-room-for-marks'
export interface Issue { code: IssueCode; severity: 'error' | 'warning'; message: string; data?: Record<string, number | number[] | boolean> }
/**
 * The pages of one part; null is a blank page. The PDF is the book as read. A board's pages are its two panels
 * by column, the front of its piece: [cover, inside cover] before the body, [inside back cover, back cover]
 * after it. A body's pages are, in book order: a blank leaf (2 pages) when a board comes before it, its PDF
 * pages, the padding blanks, then a blank leaf when a board comes after it. Each board's strip folds at the
 * fore-edge around that leaf and is glued to both sides of it, so the leaf is sewn into the first (or last)
 * signature and hidden. With both boards, body page n is PDF page n.
 */
export interface PartAllocation { partIndex: number; type: 'body' | 'board'; pdfPages: (number | null)[] }
/**
 * Blank pages of the leaves the boards wrap, at the start and end of the body: 2 each with a board on that side,
 * else 0. A book has one body and every other part is a board, so the leaf before the body is wrapped by the
 * board right before it in part order (allocations[body partIndex - 1]) and the leaf after by the board right
 * after it (partIndex + 1).
 */
export interface LeafPages { before: number; after: number }
/**
 * `bodyPages`: the body's PDF pages plus its blank leaves; signatures are sized from it. `blanksAdded`: the
 * padding blanks that fill out the last signature, just before the back leaf. The body's allocation has
 * bodyPages + blanksAdded pages.
 */
export interface BodySummary { bodyPages: number; pagesPerSignature: number; piecesPerSignature: number; blanksAdded: number; leafPages: LeafPages }

// Layout units are PDF points, origin top-left, y down.
/**
 * One page on one side of a sheet. Back-side placements are in back-side coordinates as seen looking
 * at the back, with the duplex flip already applied. `rotation` is degrees clockwise as seen on that side;
 * the rects are axis-aligned boxes after rotation. `panel` is the trim area, `content` is where the page's
 * trim box lands (equal to `panel` unless the page size is mismatched), and `clip` is the panel grown by
 * the bleed on the piece's outer edges; exporters clip page content to it. `pdfPage` null is a blank panel.
 * `partPage` is the page's index in its part's allocation `pdfPages`, which tells a blank leaf from padding.
 */
export interface PagePlacement {
  pdfPage: number | null; partIndex: number; partPage: number; panel: Rect; content: Rect; clip: Rect; rotation: Rotation
}
/** A segment with x1 <= x2 and y1 <= y2. */
export interface SheetLine { x1: number; y1: number; x2: number; y2: number }
/** `opensByTrim`: true when this fold edge is trimmed open after folding, false for the spine. */
export interface FoldLine extends SheetLine { opensByTrim: boolean }
/**
 * How marks are drawn, in points: every tick is stroked `strokeWidth` wide, cut ticks solid, fold ticks with
 * `dash` (on and off lengths) for the spine or for a fold that opens by trim. Ticks keep half the stroke clear of clips.
 */
export interface MarkStyle { strokeWidth: number; dash: { spine: number[]; opensByTrim: number[] } }
/**
 * The exact mark segments to draw on one side, in that side's coordinates; exporters and previews draw them as
 * they are, in the Layout's `markStyle`. They are the ticks past the ends of the sheet's guide lines (see marks.ts), outside
 * every front clip. No two segments of a side overlap: collinear ticks that overlap or touch are merged, and where
 * kinds overlap a cut tick wins over a fold tick, and a spine fold tick over one that opens by trim. The back's
 * marks are the front's mapped through the sheet's duplex flip, so each sits exactly behind its front mark.
 * A side's `guides` use the same shape for the full lines.
 */
export interface SideMarks { cut: SheetLine[]; fold: FoldLine[] }
/**
 * Placement order within a side is not part of the contract. Board backs have no placements (hidden).
 * `guides` are the full lines along the trim edges (`cut`, deduplicated per side) and folds, in that side's
 * coordinates, for showing where to cut and fold; the back's sit behind the front's, like `marks`. The marks
 * to print are `marks`.
 */
export interface SheetSide { placements: PagePlacement[]; guides: SideMarks; marks: SideMarks }
export interface Sheet { front: SheetSide; back: SheetSide }
/** An edge or half of a piece as it lies on the sheet front. */
export type PieceSide = 'left' | 'right' | 'top' | 'bottom'
/**
 * One fold of a piece. The piece lies on the table front face up, as it lay on the sheet, and is never turned
 * over or around while it is folded. `line` is the crease in the piece's trim coordinates (origin at its slot's
 * top-left, axes as on the sheet front): it runs across the whole stack folded so far and halves it. The
 * `moves` half (left or right of a vertical line, top or bottom of a horizontal one) turns over onto the other
 * half, which stays where it is: under it for a `mountain` fold, over it for a `valley` fold, seen from above,
 * that is from the sheet's front face. `opensByTrim` says the crease is trimmed open after folding; the one
 * that is not is the spine (a board's fold is at the fore-edge, around its leaf).
 */
export interface AssemblyFold { order: number; line: SheetLine; moves: PieceSide; direction: 'mountain' | 'valley'; opensByTrim: boolean }
/**
 * One cut piece. `slot` is its trim rect on the sheet front (cut along it; bleed falls away). `cols` and `rows`
 * count its panels across and down as it lies on the sheet front. `turned`: the piece's pages have their top
 * toward the sheet's right edge, so after its last fold the section is turned a quarter counter-clockwise (seen
 * from above) before it is used. Folded by `folds` in `order`, and turned if `turned`, a body piece is a section
 * with its spine on the left, its first page on top and every page upright; a board is a strip folded at the
 * fore-edge, with its first page on top and its second underneath, both upright.
 */
export interface AssemblyPiece {
  id: number; sheet: number; slot: Rect; cols: number; rows: number; turned: boolean; partIndex: number
  kind: 'body' | 'board'; folds: AssemblyFold[]
}
/**
 * How to make the book from the printed sheets; with the placements it is all a builder needs. Turn a sheet over
 * about its `flipAxis` (a line through the sheet front, as the duplex flip turns it) to see the back as printed.
 * Cut out each of `pieces` and fold it. Each of `signatures` (in reading order) is made by nesting each listed
 * piece's folded section inside the previous one's, outermost first. The book block is gathered in `order`,
 * each step naming an index into `signatures` or `boards`, top of the book first. A board is not stacked: its
 * strip folds at the fore-edge around the `wraps` leaf (the first or last leaf of that signature), its top half
 * above that leaf and its bottom half below it, glued to both sides, so that leaf and the board's blank backs
 * are hidden. `position` 'front' boards come before the signature they wrap in `order`, 'back' ones after.
 */
export interface Assembly {
  flipAxis: 'vertical' | 'horizontal'
  pieces: AssemblyPiece[]
  signatures: { partIndex: number; pieces: number[] }[]
  boards: { pieceId: number; position: 'front' | 'back'; wraps: { signature: number; leaf: 'first' | 'last' } }[]
  order: { kind: 'board' | 'signature'; index: number }[]
}
/** The imposition of a whole book. On an error issue, `sheets` is empty and `assembly` null. */
export interface Layout {
  /** The sheet size every side uses. 0x0 on an error layout whose print settings have no valid sheet size. */
  sheet: Size
  sheets: Sheet[]
  allocations: PartAllocation[]
  body: BodySummary | null
  perSheet: { partIndexes: number[]; perSheet: number; sheets: number }[]
  issues: Issue[]
  /** How every side's `marks` are drawn. */
  markStyle: MarkStyle
  assembly: Assembly | null
}
