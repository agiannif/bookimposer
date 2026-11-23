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
export type IssueCode = 'no-body' | 'multiple-bodies' | 'invalid-signatures' | 'no-body-pages'
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
/** The imposition of a whole book. On an error issue, `sheets` is empty. */
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
}
