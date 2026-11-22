import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SHEET_SIZES } from '../src/index.ts'

test('the named sheet sizes are in points, portrait', () => {
  assert.deepEqual(SHEET_SIZES, {
    letter: { width: 612, height: 792 },
    a4: { width: 595.28, height: 841.89 },
    tabloid: { width: 792, height: 1224 },
    a3: { width: 841.89, height: 1190.55 },
  })
})
