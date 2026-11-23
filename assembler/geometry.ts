// Small geometry shared by the assembler and the engine's physical checks: tolerant comparisons of sheet
// rects and the direction vectors a face's page top points in.
import type { Rect, Rotation } from '../engine/src/index.ts'

export const EPS = 1e-6
export const near = (a: number, b: number) => Math.abs(a - b) < EPS
export const sameRect = (a: Rect, b: Rect) => near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height)
export const inside = (a: Rect, t: Rect) =>
  a.x >= t.x - EPS && a.y >= t.y - EPS && a.x + a.width <= t.x + t.width + EPS && a.y + a.height <= t.y + t.height + EPS

export const boundingBox = (rects: Rect[]): Rect => {
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  return { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) - x, height: Math.max(...rects.map((r) => r.y + r.height)) - y }
}

/** A direction in y-down coordinates. */
export type Vec = [number, number]

/** Where the top of something turned `rotation` degrees clockwise points. */
export const upFor = (rotation: number): Vec => (rotation === 0 ? [0, -1] : rotation === 90 ? [1, 0] : rotation === 180 ? [0, 1] : [-1, 0])

/** The clockwise turn whose top points along `up`, the inverse of upFor. */
export const rotationFor = (up: Vec): Rotation => (up[1] < 0 ? 0 : up[0] > 0 ? 90 : up[1] > 0 ? 180 : 270)

export const neg = (v: Vec): Vec => [-v[0] + 0, -v[1] + 0]
