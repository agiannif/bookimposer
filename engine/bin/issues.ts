// Reads a Layout as JSON on stdin and prints its issues to stderr, one per line.
// Usage: node engine/bin/issues.ts < layout.json
// Exits 1 if any issue has error severity, otherwise 0 (warnings do not stop the pipeline).
const chunks: Buffer[] = []
for await (const chunk of process.stdin) chunks.push(chunk)

let layout
try {
  layout = JSON.parse(Buffer.concat(chunks).toString('utf8'))
} catch (e) {
  console.error(`issues: invalid JSON on stdin: ${(e as Error).message}`)
  process.exit(1)
}
const issues: { severity: string; message: string }[] = layout.issues ?? []
for (const issue of issues) console.error(`${issue.severity}: ${issue.message}`)
process.exit(issues.some((issue) => issue.severity === 'error') ? 1 : 0)
