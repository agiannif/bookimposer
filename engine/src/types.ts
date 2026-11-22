import type { Rect, Rotation } from './geometry.ts'
export interface Size { width: number; height: number }
export type DuplexFlip = 'long-edge' | 'short-edge'
export type MismatchPolicy = 'fit' | 'center'
export interface PrintSettings { sheet: Size; duplex: DuplexFlip; margin: number; gap: number; bleed: number }
export type FoldCount = 1 | 2 | 3
export type PartSpec = { type: 'body'; signatures: number; folds: FoldCount } | { type: 'board' }
// pageSizes.length is the PDF page count; each entry is that page's TrimBox (or MediaBox) size.
export interface BookSpec { pageSizes: Size[]; parts: PartSpec[]; print: PrintSettings; mismatch: MismatchPolicy }
export type IssueCode = 'no-body' | 'multiple-bodies' | 'invalid-signatures' | 'no-body-pages'
  | 'empty-signatures' | 'piece-does-not-fit' | 'spacing-reduces-fit' | 'page-size-mismatch'
  | 'invalid-page-size' | 'invalid-print-settings'
export interface Issue { code: IssueCode; severity: 'error' | 'warning'; message: string; data?: Record<string, number | number[]> }
export interface PartAllocation { partIndex: number; type: 'body' | 'board'; pdfPages: (number | null)[] }
export interface BodySummary { bodyPages: number; pagesPerSignature: number; piecesPerSignature: number; blanksAdded: number }

// Layout units are PDF points, origin top-left, y down.
/**
 * One page on one side of a sheet. Back-side placements are in back-side coordinates as seen looking
 * at the back, with the duplex flip already applied. `rotation` is degrees clockwise as seen on that side;
 * the rects are axis-aligned boxes after rotation. `panel` is the trim area, `content` is where the page's
 * trim box lands (equal to `panel` unless the page size is mismatched), and `clip` is the panel grown by
 * the bleed on the piece's outer edges; exporters clip page content to it. `pdfPage` null is a blank panel.
 */
export interface PagePlacement { pdfPage: number | null; partIndex: number; panel: Rect; content: Rect; clip: Rect; rotation: Rotation }
/** A full trim-rect segment in FRONT coordinates. Exporters draw marks only outside the trim area. */
export interface SheetLine { x1: number; y1: number; x2: number; y2: number }
/** `opensByTrim`: true when this fold edge is trimmed open after folding, false for the spine. */
export interface FoldLine extends SheetLine { opensByTrim: boolean }
/** Placement order within a side is not part of the contract. Board backs have no placements (hidden). */
export interface SheetSide { placements: PagePlacement[] }
/** `cutLines` are deduplicated per sheet. */
export interface Sheet { front: SheetSide; back: SheetSide; cutLines: SheetLine[]; foldLines: FoldLine[] }
/** The imposition of a whole book. On an error issue, `sheets` is empty. */
export interface Layout {
  sheets: Sheet[]
  allocations: PartAllocation[]
  body: BodySummary | null
  perSheet: { partIndexes: number[]; perSheet: number; sheets: number }[]
  fillers: { count: number; size: Size }
  issues: Issue[]
}
