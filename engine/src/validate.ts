import type { BookSpec, Issue } from './types.ts'

const positive = (n: number) => Number.isFinite(n) && n > 0
const nonNegative = (n: number) => Number.isFinite(n) && n >= 0

// Degenerate sizes make the slot grid divide by zero (and loop forever) or produce NaN rects,
// so they are rejected before any layout work.
export function validateSpec(spec: BookSpec): Issue[] {
  const issues: Issue[] = []
  const badPages = spec.pageSizes.flatMap((s, i) => (positive(s.width) && positive(s.height) ? [] : [i]))
  if (badPages.length > 0) {
    issues.push({
      code: 'invalid-page-size', severity: 'error',
      message: 'Page width and height must be finite and greater than 0.',
      data: { pages: badPages },
    })
  }

  const { sheet, margin, gap, bleed } = spec.print
  const badFields = [
    ...(positive(sheet.width) && positive(sheet.height) ? [] : ['sheet']),
    ...Object.entries({ margin, gap, bleed }).flatMap(([name, value]) => (nonNegative(value) ? [] : [name])),
  ]
  if (badFields.length > 0) {
    issues.push({
      code: 'invalid-print-settings', severity: 'error',
      message: `Invalid print settings: ${badFields.join(', ')}. The sheet size must be finite and greater than 0; margin, gap and bleed must be finite and at least 0.`,
    })
  }
  return issues
}
