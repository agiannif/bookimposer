// Cut and fold marks: the short ticks drawn in the margins past the ends of each guide line, never over
// a placement's clip. Exporters and the sheet view draw exactly these segments.
import type { Rect } from './geometry.ts'
import type { FoldLine, Issue, MarkStyle, SheetLine, SideMarks, Size } from './types.ts'

/** How far past a line's end its tick starts. */
const GAP = 2
/** The longest a tick is drawn. */
const LENGTH = 12
/** How close to the sheet's edge a tick may get. */
const EDGE_MARGIN = 2
/** Shorter ticks are not worth drawing. */
const MIN_LENGTH = 3
/** How every mark is drawn; each Layout carries it as `markStyle`. Ticks keep half the stroke clear of every clip. */
export const MARK_STYLE: MarkStyle = { strokeWidth: 0.25, dash: { spine: [3, 2], opensByTrim: [0.5, 1.5] } }

const TOLERANCE = 1e-6

export type Axis = 'horizontal' | 'vertical'

/** The axis of `line` when it can be marked: horizontal with x1 < x2, or vertical with y1 < y2. Null otherwise, including a point. */
export function lineAxis(line: SheetLine): Axis | null {
  if (line.y1 === line.y2 && line.x1 < line.x2) return 'horizontal'
  if (line.x1 === line.x2 && line.y1 < line.y2) return 'vertical'
  return null
}

// A segment as an interval [lo, hi] along its axis at `across` on the other axis.
interface Span { axis: Axis; across: number; lo: number; hi: number }

const spanOf = (line: SheetLine, axis: Axis): Span => axis === 'horizontal'
  ? { axis, across: line.y1, lo: line.x1, hi: line.x2 }
  : { axis, across: line.x1, lo: line.y1, hi: line.y2 }

const lineOf = ({ axis, across, lo, hi }: Span): SheetLine => axis === 'horizontal'
  ? { x1: lo, y1: across, x2: hi, y2: across }
  : { x1: across, y1: lo, x2: across, y2: hi }

/**
 * The ticks for the two ends of `line`: the start end's first, then the far end's. Each runs outward along
 * the line, starting 2 pt past the end, up to 12 pt long. A clip that reaches past the end (the piece's own
 * bleed) is stepped over: the tick then starts 2 pt past that clip. The tick stops at the first other clip
 * it would enter (it may touch a clip's edge) and 2 pt inside the sheet edge; a tick under 3 pt is dropped.
 * A line `lineAxis` rejects gets no ticks.
 */
export function markSegments(line: SheetLine, clips: Rect[], sheet: Size): SheetLine[] {
  return tickSpans(line, clips, sheet).map(lineOf)
}

function tickSpans(line: SheetLine, clips: Rect[], sheet: Size): Span[] {
  const axis = lineAxis(line)
  if (!axis) return []
  const horizontal = axis === 'horizontal'
  // Work along the line's axis as `a`, across it as `b`.
  const { across: b, lo: a1, hi: a2 } = spanOf(line, axis)
  const aSize = horizontal ? sheet.width : sheet.height
  const halfStroke = MARK_STYLE.strokeWidth / 2
  // Each clip as its interval along `a` (open: a tick's butt end may touch its edge) and across `b`
  // (closed and widened by half the stroke: a tick has width, so one within half a stroke of a clip touches it).
  const spans: [number, number][] = []
  for (const clip of clips) {
    const [alongFrom, alongSize, acrossFrom, acrossSize] = horizontal
      ? [clip.x, clip.width, clip.y, clip.height]
      : [clip.y, clip.height, clip.x, clip.width]
    if (acrossFrom - halfStroke <= b && b <= acrossFrom + acrossSize + halfStroke) spans.push([alongFrom, alongFrom + alongSize])
  }

  const tick = (end: number, outward: 1 | -1): Span | null => {
    // A clip overhangs the line's end when the end lies inside it by more than half a stroke; past those
    // clips, the tick starts.
    let near = end
    for (const [from, to] of spans) {
      if (from + halfStroke < end && end < to - halfStroke) near = outward > 0 ? Math.max(near, to) : Math.min(near, from)
    }
    near += outward * GAP
    // Distance along the ray from `near` to the farthest allowed point.
    const toEdge = outward > 0 ? aSize - EDGE_MARGIN - near : near - EDGE_MARGIN
    let room = Math.min(LENGTH, toEdge)
    for (const [from, to] of spans) {
      const [start, stop] = outward > 0 ? [from - near, to - near] : [near - to, near - from]
      if (stop > 0) room = Math.min(room, Math.max(start, 0))
    }
    if (room < MIN_LENGTH) return null
    const far = near + outward * room
    return { axis, across: b, lo: Math.min(near, far), hi: Math.max(near, far) }
  }

  return [tick(a1, -1), tick(a2, 1)].filter((t): t is Span => t !== null)
}

const collinear = (a: Span, b: Span) => a.axis === b.axis && Math.abs(a.across - b.across) < TOLERANCE

// Merges collinear spans that overlap or touch, so no stretch of a line is stroked twice. The result is
// sorted: horizontal first, then by position across, then along.
function merge(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) =>
    (a.axis === b.axis ? 0 : a.axis === 'horizontal' ? -1 : 1) || a.across - b.across || a.lo - b.lo)
  const merged: Span[] = []
  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (last && collinear(last, span) && span.lo <= last.hi + TOLERANCE) last.hi = Math.max(last.hi, span.hi)
    else merged.push({ ...span })
  }
  return merged
}

// Collinear spans sharing more than a point.
const overlaps = (a: Span, b: Span) => collinear(a, b) && Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > TOLERANCE

function ticksOf(lines: SheetLine[], clips: Rect[], sheet: Size): Span[] {
  return merge(lines.flatMap((line) => tickSpans(line, clips, sheet)))
}

/**
 * The marks for one side: every line's ticks (`markSegments`), with collinear ticks that overlap or touch
 * merged into one. Where ticks of different kinds overlap, one is kept so nothing is stroked twice:
 * a cut tick wins over a fold tick, and a spine fold tick over one that opens by trim.
 */
export function sheetMarks(cutLines: SheetLine[], foldLines: FoldLine[], clips: Rect[], sheet: Size): SideMarks {
  const cut = ticksOf(cutLines, clips, sheet)
  const spine = ticksOf(foldLines.filter((f) => !f.opensByTrim), clips, sheet)
    .filter((t) => !cut.some((c) => overlaps(c, t)))
  const byTrim = ticksOf(foldLines.filter((f) => f.opensByTrim), clips, sheet)
    .filter((t) => ![...cut, ...spine].some((c) => overlaps(c, t)))
  return {
    cut: cut.map(lineOf),
    fold: [
      ...spine.map((t) => ({ ...lineOf(t), opensByTrim: false })),
      ...byTrim.map((t) => ({ ...lineOf(t), opensByTrim: true })),
    ],
  }
}

/**
 * `issues` without the no-room-for-marks warnings that don't matter for the marks drawn: one is kept when a
 * kind it names (`data.cut`, `data.fold`) is drawn.
 */
export function issuesForMarks<T extends { code: string; data?: Issue['data'] }>(issues: T[], drawn: { cut: boolean; fold: boolean }): T[] {
  return issues.filter((issue) => issue.code !== 'no-room-for-marks'
    || (drawn.cut && issue.data?.cut === true) || (drawn.fold && issue.data?.fold === true))
}
