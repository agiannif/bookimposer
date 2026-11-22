// Reads `bookcomposer-export page-sizes` JSON on stdin and prints a BookSpec as JSON.
// Usage: node engine/bin/book-spec.ts --signatures N [--folds 1|2|3] [--front-board] [--back-board]
//   [--sheet letter|a4|WxH] [--margin PT] [--gap PT] [--bleed PT] [--duplex long-edge|short-edge]
// A bad flag or bad input exits 1 with a message on stderr.
import { parseBookSpecArgs } from '../src/cli/book-spec-args.ts'

const chunks: Buffer[] = []
for await (const chunk of process.stdin) chunks.push(chunk)

try {
  const { pageSizes } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!Array.isArray(pageSizes)) throw new Error('stdin has no pageSizes array')
  process.stdout.write(JSON.stringify(parseBookSpecArgs(process.argv.slice(2), pageSizes)) + '\n')
} catch (e) {
  console.error(`book-spec: ${(e as Error).message}`)
  process.exit(1)
}
