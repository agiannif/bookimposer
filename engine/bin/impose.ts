// Reads a BookSpec as JSON on stdin and prints the resulting Layout as JSON.
// Usage: node engine/bin/impose.ts < spec.json > layout.json
// Invalid JSON exits 1 with a message on stderr. Error issues in the Layout are data and exit 0.
import { impose } from '../src/impose.ts'

const chunks: Buffer[] = []
for await (const chunk of process.stdin) chunks.push(chunk)

let spec
try {
  spec = JSON.parse(Buffer.concat(chunks).toString('utf8'))
} catch (e) {
  console.error(`impose: invalid JSON on stdin: ${(e as Error).message}`)
  process.exit(1)
}
process.stdout.write(JSON.stringify(impose(spec)) + '\n')
