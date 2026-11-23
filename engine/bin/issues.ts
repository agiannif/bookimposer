// Reads a Layout as JSON on stdin and prints its issues to stderr, one per line.
// Usage: node engine/bin/issues.ts [--cut-marks] [--fold-marks] < layout.json
// The flags say which marks the export draws; a warning that marks don't fit is printed only for those kinds.
// Exits 1 if any issue has error severity, 2 on an unknown flag, otherwise 0 (warnings do not stop the pipeline).
import { issuesForMarks } from '../src/marks.ts'
import type { Issue } from '../src/types.ts'

const drawn = { cut: false, fold: false }
for (const flag of process.argv.slice(2)) {
  if (flag === '--cut-marks') drawn.cut = true
  else if (flag === '--fold-marks') drawn.fold = true
  else {
    console.error(`issues: unknown flag ${flag}`)
    process.exit(2)
  }
}

const chunks: Buffer[] = []
for await (const chunk of process.stdin) chunks.push(chunk)

let layout
try {
  layout = JSON.parse(Buffer.concat(chunks).toString('utf8'))
} catch (e) {
  console.error(`issues: invalid JSON on stdin: ${(e as Error).message}`)
  process.exit(1)
}
const issues = issuesForMarks<Issue>(layout.issues ?? [], drawn)
for (const issue of issues) console.error(`${issue.severity}: ${issue.message}`)
process.exit(issues.some((issue) => issue.severity === 'error') ? 1 : 0)
