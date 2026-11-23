// The configurations every physical check folds: folds 1/2/3, upright and turned pieces, both duplex edges,
// bleed and gap, boards on and off, and the 76-page worked example on a landscape sheet.
import type { BookSpec, DuplexFlip, FoldCount, PrintSettings, Size } from '../src/index.ts'

const pages = (n: number, width = 288, height = 378): Size[] => Array.from({ length: n }, () => ({ width, height }))
const print = (o: Partial<PrintSettings> = {}): PrintSettings =>
  ({ sheet: { width: 612, height: 792 }, duplex: 'long-edge', margin: 18, gap: 0, bleed: 0, ...o })
const withBoards = (signatures: number, folds: FoldCount): BookSpec['parts'] =>
  [{ type: 'board' }, { type: 'body', signatures, folds }, { type: 'board' }]

/** [name, spec, number of cut pieces]. The first is the worked example. */
export const foldCases: [string, BookSpec, number][] = [
  ['worked example', { pageSizes: pages(76), parts: withBoards(10, 1), print: print(), mismatch: 'fit' }, 22],
  ['worked example short-edge', { pageSizes: pages(76), parts: withBoards(10, 1), print: print({ duplex: 'short-edge' }), mismatch: 'fit' }, 22],
  ['worked example bleed 9 gap 6', { pageSizes: pages(76, 270, 370), parts: withBoards(10, 1), print: print({ bleed: 9, gap: 6, margin: 10 }), mismatch: 'fit' }, 22],
]
const sheets: Size[] = [{ width: 612, height: 792 }, { width: 792, height: 612 }, { width: 1224, height: 792 }, { width: 792, height: 1224 }]
for (const duplex of ['long-edge', 'short-edge'] as DuplexFlip[]) {
  foldCases.push([`worked example landscape ${duplex}`, { pageSizes: pages(76), parts: withBoards(10, 1), print: print({ sheet: { width: 792, height: 612 }, duplex }), mismatch: 'fit' }, 22])
  for (const sheet of sheets) {
    const tag = `${sheet.width}x${sheet.height} ${duplex}`
    foldCases.push(
      [`quarto, 2 signatures, ${tag}`, { pageSizes: pages(16, 144, 189), parts: withBoards(2, 2), print: print({ sheet, duplex }), mismatch: 'fit' }, 4],
      [`quarto with bleed and gap, ${tag}`, { pageSizes: pages(30, 144, 189), parts: withBoards(2, 2), print: print({ sheet, duplex, bleed: 6, gap: 3 }), mismatch: 'fit' }, 6],
      [`octavo, 1 piece per signature, ${tag}`, { pageSizes: pages(32, 140, 180), parts: withBoards(2, 3), print: print({ sheet, duplex }), mismatch: 'fit' }, 4],
      [`front board only, ${tag}`, { pageSizes: pages(16, 144, 189), parts: [{ type: 'board' }, { type: 'body', signatures: 2, folds: 1 }], print: print({ sheet, duplex }), mismatch: 'fit' }, 5],
      [`back board only, ${tag}`, { pageSizes: pages(16, 144, 189), parts: [{ type: 'body', signatures: 2, folds: 1 }, { type: 'board' }], print: print({ sheet, duplex }), mismatch: 'fit' }, 5],
      [`octavo, 2 pieces per signature, ${tag}`, { pageSizes: pages(64, 140, 180), parts: [{ type: 'body', signatures: 2, folds: 3 }], print: print({ sheet, duplex }), mismatch: 'fit' }, 4],
      [`folio, 3 pieces per signature, bleed, ${tag}`, { pageSizes: pages(24, 200, 260), parts: withBoards(2, 1), print: print({ sheet, duplex, bleed: 5 }), mismatch: 'fit' }, 8],
    )
  }
}
