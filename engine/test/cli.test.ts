import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { impose } from '../src/impose.ts'
import { workedExample } from './fixtures.ts'

const cli = fileURLToPath(new URL('../bin/impose.ts', import.meta.url))

test('layout carries the sheet size every side uses', () => {
  assert.deepEqual(impose(workedExample()).sheet, { width: 612, height: 792 })
})

test('error layouts carry the sheet size too', () => {
  const layout = impose(workedExample({ pageSizes: [] }))
  assert.deepEqual(layout.sheet, { width: 612, height: 792 })
})

test('CLI prints the layout for a spec on stdin', () => {
  const out = execFileSync('node', [cli], { input: JSON.stringify(workedExample()) }).toString()
  assert.ok(out.endsWith('\n'))
  assert.equal(JSON.parse(out).sheets.length, 11)
})

test('CLI exits 1 with a message on invalid JSON', () => {
  const result = spawnSync('node', [cli], { input: '{nope' })
  assert.equal(result.status, 1)
  assert.match(result.stderr.toString(), /invalid JSON/i)
  assert.equal(result.stdout.toString(), '')
})

test('a NaN sheet width gives a 0x0 sheet that survives JSON', () => {
  const spec = workedExample()
  spec.print.sheet.width = NaN
  const layout = impose(spec)
  assert.deepEqual(layout.sheet, { width: 0, height: 0 })
  assert.deepEqual(layout.issues.map((i) => i.code), ['invalid-print-settings'])
  assert.deepEqual(JSON.parse(JSON.stringify(layout)).sheet, { width: 0, height: 0 })
})

test('missing print settings are an error layout, not a throw', () => {
  const spec = workedExample() as Partial<ReturnType<typeof workedExample>>
  delete spec.print
  const noPrint = impose(spec as ReturnType<typeof workedExample>)
  assert.deepEqual(noPrint.issues.map((i) => i.code), ['invalid-print-settings'])
  assert.deepEqual(noPrint.sheet, { width: 0, height: 0 })

  const noSheet = workedExample()
  delete (noSheet.print as Partial<typeof noSheet.print>).sheet
  const layout = impose(noSheet)
  assert.deepEqual(layout.issues.map((i) => i.code), ['invalid-print-settings'])
  assert.deepEqual(layout.sheet, { width: 0, height: 0 })
})
