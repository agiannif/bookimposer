import type { BodySummary, BookSpec, FoldCount, Issue, LeafPages, PartAllocation, PartSpec } from './types.ts'

interface AllocationResult { allocations: PartAllocation[]; body: BodySummary | null; issues: Issue[] }

export function pagesPerPiece(folds: FoldCount): number {
  return 2 * 2 ** folds
}

function failure(issue: Issue): AllocationResult {
  return { allocations: [], body: null, issues: [issue] }
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i)
const blanks = (n: number): null[] => Array.from({ length: n }, () => null)

/** A board is one strip printed with two PDF pages: the cover and the inside cover (or inside back cover and back cover). */
const BOARD_PAGES = 2

/** A leaf is one sheet of the book block: 2 pages, front and back. */
const LEAF_PAGES = 2

/**
 * The blank pages of the leaves the boards wrap: the body's first leaf when a board comes before it, its last
 * leaf when one comes after it. Each side gets one leaf however many boards it has.
 */
function boardLeafPages(parts: PartSpec[]): LeafPages {
  const bodyIndex = parts.findIndex((p) => p.type === 'body')
  return {
    before: bodyIndex > 0 ? LEAF_PAGES : 0,
    after: bodyIndex >= 0 && bodyIndex < parts.length - 1 ? LEAF_PAGES : 0,
  }
}

/** The PDF's pages left for the body once the boards take theirs. */
const contentPageCount = (pdfPages: number, parts: PartSpec[]) =>
  pdfPages - BOARD_PAGES * parts.filter((p) => p.type === 'board').length

/** The body's pages before padding: its content pages plus the blank leaves the boards wrap. */
export function bodyPageCount(pdfPages: number, parts: PartSpec[]): number {
  const leaves = boardLeafPages(parts)
  return contentPageCount(pdfPages, parts) + leaves.before + leaves.after
}

// The PDF is the book as read. Boards before the body take their two pages each from the start of the PDF,
// boards after it from the end, and the body gets whatever is left in between. A front board's pages are
// its cover then its inside cover, a back board's its inside back cover then its back cover; each board's
// piece prints them in that order by column and folds at the fore-edge around the body's blank first (or
// last) leaf, glued to both sides of it. So with both boards, body page n is PDF page n.
export function allocatePages(spec: BookSpec): AllocationResult {
  const bodyIndexes = spec.parts.flatMap((p, i) => (p.type === 'body' ? [i] : []))
  if (bodyIndexes.length === 0) {
    return failure({ code: 'no-body', severity: 'error', message: 'The book needs a body.' })
  }
  if (bodyIndexes.length > 1) {
    return failure({ code: 'multiple-bodies', severity: 'error', message: 'The book can only have one body.' })
  }
  const bodyIndex = bodyIndexes[0]
  const bodyPart = spec.parts[bodyIndex]
  if (bodyPart.type !== 'body') throw new Error('unreachable')
  const { signatures, folds } = bodyPart
  if (!Number.isInteger(signatures) || signatures < 1) {
    return failure({ code: 'invalid-signatures', severity: 'error', message: 'Signatures must be a whole number of at least 1.' })
  }

  const pdfPages = spec.pageSizes.length
  const contentPages = contentPageCount(pdfPages, spec.parts)
  const fixedPages = pdfPages - contentPages
  if (contentPages < 1) {
    return failure({
      code: 'no-body-pages', severity: 'error',
      message: 'The PDF has no pages left for the body after the boards.',
      data: { pdfPages, fixedPages },
    })
  }

  const leafPages = boardLeafPages(spec.parts)
  const bodyPages = bodyPageCount(pdfPages, spec.parts)
  const piece = pagesPerPiece(folds)
  const pagesPerSignature = Math.ceil(Math.ceil(bodyPages / signatures) / piece) * piece
  const blanksAdded = signatures * pagesPerSignature - bodyPages
  // Checked before any per-page work, so an absurd count costs nothing. Every count above
  // maxSignatures leaves a signature blank; since all signatures are one size, a few counts below
  // it do too (72 pages in 10 signatures of 8).
  if (blanksAdded >= pagesPerSignature) {
    const maxSignatures = Math.max(1, Math.ceil(bodyPages / piece))
    const message = signatures > maxSignatures
      ? `Too many signatures: with ${bodyPages} body pages, at most ${maxSignatures} signatures can hold content`
      : `Too many signatures: with ${bodyPages} body pages, ${signatures} signatures of ${pagesPerSignature} pages leave ${Math.floor(blanksAdded / pagesPerSignature)} entirely blank`
    return failure({ code: 'too-many-signatures', severity: 'error', message, data: { bodyPages, maxSignatures } })
  }

  const frontPages = bodyIndex * BOARD_PAGES
  const allocations: PartAllocation[] = spec.parts.map((part, partIndex) => {
    if (part.type === 'body') {
      const content = range(frontPages, frontPages + contentPages)
      return { partIndex, type: 'body', pdfPages: [...blanks(leafPages.before), ...content, ...blanks(blanksAdded), ...blanks(leafPages.after)] }
    }
    const start = partIndex < bodyIndex
      ? partIndex * BOARD_PAGES
      : frontPages + contentPages + (partIndex - bodyIndex - 1) * BOARD_PAGES
    return { partIndex, type: 'board', pdfPages: range(start, start + BOARD_PAGES) }
  })

  return {
    allocations,
    body: { bodyPages, pagesPerSignature, piecesPerSignature: pagesPerSignature / piece, blanksAdded, leafPages },
    issues: [],
  }
}
