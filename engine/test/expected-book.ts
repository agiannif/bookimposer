// The book a correct Layout must assemble into, worked out from the BookSpec alone.
import type { BookSpec } from '../src/index.ts'

/**
 * The book's visible pages as read, from the spec alone: the PDF in order, with the padding that fills out
 * the last signature just before the back board's two pages (inside back cover, back cover). The blank leaves
 * the boards wrap are hidden, so they are not read.
 */
export function expectedBook(spec: BookSpec): (number | null)[] {
  const bodyIndex = spec.parts.findIndex((p) => p.type === 'body')
  const body = spec.parts[bodyIndex]
  if (body.type !== 'body') throw new Error('unreachable')
  const pdfPages = spec.pageSizes.length
  const boardsAfter = spec.parts.length - 1 - bodyIndex
  const leaves = (bodyIndex > 0 ? 2 : 0) + (boardsAfter > 0 ? 2 : 0)
  const bodyPages = pdfPages - 2 * (bodyIndex + boardsAfter) + leaves
  const piecePages = 2 * 2 ** body.folds
  const signaturePages = Math.ceil(Math.ceil(bodyPages / body.signatures) / piecePages) * piecePages
  const padding = body.signatures * signaturePages - bodyPages
  const all = Array.from({ length: pdfPages }, (_, i) => i)
  const backStart = pdfPages - 2 * boardsAfter
  return [...all.slice(0, backStart), ...Array<null>(padding).fill(null), ...all.slice(backStart)]
}
