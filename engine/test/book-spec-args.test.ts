import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseBookSpecArgs } from '../src/cli/book-spec-args.ts'

const pageSizes = [{ width: 288, height: 378 }, { width: 288, height: 378 }]
const bookSpecCli = fileURLToPath(new URL('../bin/book-spec.ts', import.meta.url))
const issuesCli = fileURLToPath(new URL('../bin/issues.ts', import.meta.url))

test('defaults give one body signature of single folds on letter', () => {
  assert.deepEqual(parseBookSpecArgs(['--signatures', '3'], pageSizes), {
    pageSizes,
    parts: [{ type: 'body', signatures: 3, folds: 1 }],
    print: { sheet: { width: 612, height: 792 }, duplex: 'long-edge', margin: 18, gap: 0, bleed: 0 },
    mismatch: 'fit',
  })
})

test('every flag is applied and boards go around the body', () => {
  const spec = parseBookSpecArgs(
    ['--signatures', '9', '--folds', '2', '--front-board', '--back-board', '--sheet', 'a4',
      '--margin', '10', '--gap', '2.5', '--bleed', '3', '--duplex', 'short-edge'],
    pageSizes,
  )
  assert.deepEqual(spec.parts, [{ type: 'board' }, { type: 'body', signatures: 9, folds: 2 }, { type: 'board' }])
  assert.deepEqual(spec.print, {
    sheet: { width: 595.28, height: 841.89 }, duplex: 'short-edge', margin: 10, gap: 2.5, bleed: 3,
  })
})

test('a single board goes on the side asked for', () => {
  assert.deepEqual(parseBookSpecArgs(['--signatures', '1', '--back-board'], pageSizes).parts,
    [{ type: 'body', signatures: 1, folds: 1 }, { type: 'board' }])
})

test('sheet accepts WxH in points', () => {
  const spec = parseBookSpecArgs(['--signatures', '1', '--sheet', '500x700.5'], pageSizes)
  assert.deepEqual(spec.print.sheet, { width: 500, height: 700.5 })
})

test('bad flags throw a message naming the problem', () => {
  const bad: [string[], RegExp][] = [
    [[], /--signatures is required/],
    [['--signatures', '0'], /--signatures/],
    [['--signatures', 'x'], /--signatures/],
    [['--signatures', '1', '--folds', '4'], /--folds/],
    [['--signatures', '1', '--sheet', 'legal'], /--sheet/],
    [['--signatures', '1', '--sheet', 'constructor'], /--sheet/],
    [['--signatures', '1', '--sheet', 'toString'], /--sheet/],
    [['--signatures', '1', '--margin', '-1'], /--margin/],
    [['--signatures', '1', '--margin'], /--margin needs a value/],
    [['--signatures', '1', '--duplex', 'up'], /--duplex/],
    [['--signatures', '1', '--nope'], /unknown flag --nope/],
  ]
  for (const [argv, message] of bad) assert.throws(() => parseBookSpecArgs(argv, pageSizes), message)
})

test('book-spec CLI reads page-sizes JSON on stdin and prints a BookSpec', () => {
  const result = spawnSync('node', [bookSpecCli, '--signatures', '2'], {
    input: JSON.stringify({ pageSizes, boxes: [] }),
  })
  assert.equal(result.status, 0)
  assert.deepEqual(JSON.parse(result.stdout.toString()).pageSizes, pageSizes)
})

test('book-spec CLI exits 1 with a message on a bad flag', () => {
  const result = spawnSync('node', [bookSpecCli, '--folds', '9'], { input: JSON.stringify({ pageSizes }) })
  assert.equal(result.status, 1)
  assert.match(result.stderr.toString(), /book-spec: .*--signatures is required/)
  assert.equal(result.stdout.toString(), '')
})

test('issues CLI prints warnings to stderr and exits 0', () => {
  const layout = { issues: [{ code: 'page-size-mismatch', severity: 'warning', message: 'pages differ' }] }
  const result = spawnSync('node', [issuesCli], { input: JSON.stringify(layout) })
  assert.equal(result.status, 0)
  assert.match(result.stderr.toString(), /warning: pages differ/)
})

test('issues CLI exits 1 on an error issue and prints it', () => {
  const layout = { issues: [{ code: 'no-body', severity: 'error', message: 'no body part' }] }
  const result = spawnSync('node', [issuesCli], { input: JSON.stringify(layout) })
  assert.equal(result.status, 1)
  assert.match(result.stderr.toString(), /error: no body part/)
})

test('issues CLI is silent for a clean layout', () => {
  const result = spawnSync('node', [issuesCli], { input: JSON.stringify({ issues: [] }) })
  assert.equal(result.status, 0)
  assert.equal(result.stderr.toString(), '')
})
