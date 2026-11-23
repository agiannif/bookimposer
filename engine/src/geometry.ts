import type { SheetLine } from './types.ts'

export interface Rect { x: number; y: number; width: number; height: number }

export type Rotation = 0 | 90 | 180 | 270

// Point map: x' = a*x + c*y + e, y' = b*x + d*y + f
export interface Affine { a: number; b: number; c: number; d: number; e: number; f: number }

export function identity(): Affine {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
}

export function translate(dx: number, dy: number): Affine {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy }
}

// Turns a w x h box clockwise, keeping the result at the origin.
export function rotateCw(deg: Rotation, w: number, h: number): Affine {
  switch (deg) {
    case 0: return identity()
    case 90: return { a: 0, b: 1, c: -1, d: 0, e: h, f: 0 }
    case 180: return { a: -1, b: 0, c: 0, d: -1, e: w, f: h }
    case 270: return { a: 0, b: -1, c: 1, d: 0, e: 0, f: w }
  }
}

export function mirrorX(width: number): Affine {
  return { a: -1, b: 0, c: 0, d: 1, e: width, f: 0 }
}

// Applies inner first, then outer.
export function compose(outer: Affine, inner: Affine): Affine {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  }
}

export function applyPoint(m: Affine, x: number, y: number): { x: number; y: number } {
  // + 0 turns -0 into 0
  return { x: m.a * x + m.c * y + m.e + 0, y: m.b * x + m.d * y + m.f + 0 }
}

// Segment between two points, mapped by m and ordered so x1 <= x2 and y1 <= y2.
export function mapSegment(m: Affine, x1: number, y1: number, x2: number, y2: number): SheetLine {
  const a = applyPoint(m, x1, y1)
  const b = applyPoint(m, x2, y2)
  return { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) }
}

// Axis-aligned bounding box of the transformed rect.
export function applyRect(m: Affine, r: Rect): Rect {
  const xs: number[] = []
  const ys: number[] = []
  for (const [x, y] of [[r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, r.y + r.height]]) {
    xs.push(m.a * x + m.c * y + m.e)
    ys.push(m.b * x + m.d * y + m.f)
  }
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  // + 0 turns -0 into 0
  return { x: x + 0, y: y + 0, width: Math.max(...xs) - x + 0, height: Math.max(...ys) - y + 0 }
}

export function rotationOf(m: Affine): Rotation {
  if (m.a * m.d - m.b * m.c < 0) throw new Error('transform mirrors content')
  const degrees = Math.atan2(m.b, m.a) * 180 / Math.PI
  const quarterTurns = ((Math.round(degrees / 90) % 4) + 4) % 4
  return (quarterTurns * 90) as Rotation
}
