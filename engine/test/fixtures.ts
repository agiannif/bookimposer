import type { BookSpec } from '../src/types.ts'

export function workedExample(overrides: Partial<BookSpec> = {}): BookSpec {
  return {
    pageSizes: Array.from({ length: 76 }, () => ({ width: 288, height: 378 })),
    parts: [{ type: 'board' }, { type: 'body', signatures: 9, folds: 1 }, { type: 'board' }],
    print: { sheet: { width: 612, height: 792 }, duplex: 'long-edge', margin: 18, gap: 0, bleed: 0 },
    mismatch: 'fit',
    ...overrides,
  }
}
