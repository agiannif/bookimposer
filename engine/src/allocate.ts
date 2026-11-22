import type { BodySummary, BookSpec, FoldCount, Issue, PartAllocation } from './types.ts'

interface AllocationResult { allocations: PartAllocation[]; body: BodySummary | null; issues: Issue[] }

export function pagesPerPiece(folds: FoldCount): number {
  return 2 * 2 ** folds
}

function failure(issue: Issue): AllocationResult {
  return { allocations: [], body: null, issues: [issue] }
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i)

// Boards before the body take pages from the start of the PDF, boards after it
// take pages from the end, and the body gets whatever is left in between.
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
  // Exactly one part is the body (checked above), so every other part is a board.
  const boardCount = spec.parts.length - 1
  const fixedPages = boardCount * 2
  const bodyPages = pdfPages - fixedPages
  if (bodyPages < 1) {
    return failure({
      code: 'no-body-pages', severity: 'error',
      message: 'The PDF has no pages left for the body after the boards.',
      data: { pdfPages, fixedPages },
    })
  }

  const piece = pagesPerPiece(folds)
  const pagesPerSignature = Math.ceil(Math.ceil(bodyPages / signatures) / piece) * piece
  const blanksAdded = signatures * pagesPerSignature - bodyPages

  const frontPages = bodyIndex * 2
  const allocations: PartAllocation[] = spec.parts.map((part, partIndex) => {
    if (part.type === 'body') {
      const pages: (number | null)[] = range(frontPages, frontPages + bodyPages)
      for (let i = 0; i < blanksAdded; i++) pages.push(null)
      return { partIndex, type: 'body', pdfPages: pages }
    }
    const start = partIndex < bodyIndex
      ? partIndex * 2
      : frontPages + bodyPages + (partIndex - bodyIndex - 1) * 2
    return { partIndex, type: 'board', pdfPages: [start, start + 1] }
  })

  const issues: Issue[] = []
  if (blanksAdded >= pagesPerSignature) {
    issues.push({
      code: 'empty-signatures', severity: 'warning',
      message: 'Some signatures would be entirely blank.',
      data: { count: Math.floor(blanksAdded / pagesPerSignature) },
    })
  }
  return {
    allocations,
    body: { bodyPages, pagesPerSignature, piecesPerSignature: pagesPerSignature / piece, blanksAdded },
    issues,
  }
}
