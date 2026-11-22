import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compose, applyPoint, applyRect, identity, mirrorX, rotateCw, rotationOf, translate } from '../src/geometry.ts'

test('rotateCw 90 turns the left half of a spread into the top half', () => {
  const m = rotateCw(90, 576, 378)
  assert.deepEqual(applyRect(m, { x: 0, y: 0, width: 288, height: 378 }), { x: 0, y: 0, width: 378, height: 288 })
  assert.deepEqual(applyRect(m, { x: 288, y: 0, width: 288, height: 378 }), { x: 0, y: 288, width: 378, height: 288 })
})

test('rotationOf recovers the rotation', () => {
  assert.equal(rotationOf(rotateCw(90, 10, 20)), 90)
  assert.equal(rotationOf(compose(mirrorX(100), compose(rotateCw(90, 10, 20), mirrorX(10)))), 270)
})

test('rotationOf rejects mirrored transforms', () => {
  assert.throws(() => rotationOf(mirrorX(10)), /mirrors content/)
})

test('applyRect with a translation offsets the rect', () => {
  const r = { x: 5, y: 6, width: 7, height: 8 }
  assert.deepEqual(applyRect(translate(18, 396), r), { x: 23, y: 402, width: 7, height: 8 })
})

test('rotateCw 0 is the identity', () => {
  const r = { x: 1, y: 2, width: 3, height: 4 }
  assert.deepEqual(rotateCw(0, 576, 378), identity())
  assert.deepEqual(applyRect(rotateCw(0, 576, 378), r), r)
})

test('rotateCw 180 swaps the halves of a spread', () => {
  const m = rotateCw(180, 576, 378)
  assert.deepEqual(applyRect(m, { x: 0, y: 0, width: 288, height: 378 }), { x: 288, y: 0, width: 288, height: 378 })
})

test('rotateCw 270 turns the left half of a spread into the bottom half', () => {
  const m = rotateCw(270, 576, 378)
  assert.deepEqual(applyRect(m, { x: 0, y: 0, width: 288, height: 378 }), { x: 0, y: 288, width: 378, height: 288 })
})

test('rotationOf recovers 0, 180 and 270', () => {
  assert.equal(rotationOf(identity()), 0)
  assert.equal(rotationOf(rotateCw(180, 10, 20)), 180)
  assert.equal(rotationOf(rotateCw(270, 10, 20)), 270)
})

test('compose applies the inner transform first', () => {
  const r = { x: 0, y: 0, width: 10, height: 20 }
  const rotate = rotateCw(90, 10, 20)
  const move = translate(10, 20)
  assert.deepEqual(applyRect(compose(move, rotate), r), { x: 10, y: 20, width: 20, height: 10 })
  assert.deepEqual(applyRect(compose(rotate, move), r), { x: -20, y: 10, width: 20, height: 10 })
})

test('applyPoint maps a point and normalizes -0', () => {
  assert.deepEqual(applyPoint(rotateCw(90, 10, 20), 3, 4), { x: 16, y: 3 })
  assert.deepEqual(applyPoint(rotateCw(180, 10, 20), 10, 20), { x: 0, y: 0 })
})
