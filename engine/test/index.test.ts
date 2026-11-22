import { test } from 'node:test'
import assert from 'node:assert/strict'
import { impose } from '../src/index.ts'
import type { Layout, Rect, Rotation } from '../src/index.ts'
import { workedExample } from './fixtures.ts'

test('a Layout is usable with only public entry imports', () => {
  const layout: Layout = impose(workedExample())
  const placement = layout.sheets[0].front.placements[0]
  const panel: Rect = placement.panel
  const rotation: Rotation = placement.rotation
  assert.equal(panel.width, 288)
  assert.equal(rotation, 0)
})
