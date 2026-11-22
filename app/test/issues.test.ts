import { test } from "node:test";
import assert from "node:assert/strict";
import { impose } from "../../engine/src/index.ts";
import { DEFAULT_SETTINGS, toBookSpec } from "../src/lib/book.ts";
import { bleedWarnings, imposeSafely } from "../src/lib/issues.ts";
import type { PageBoxes } from "../src/lib/backend.ts";

const pages = (n: number) => Array.from({ length: n }, () => ({ width: 288, height: 378 }));
const spec = (bleed = 0) => toBookSpec(pages(8), { ...DEFAULT_SETTINGS, print: { ...DEFAULT_SETTINGS.print, bleed } });

const box = { left: 0, bottom: 0, width: 288, height: 378 };
const withBleed: PageBoxes = { trim: box, crop: box, media: box, bleed: { left: -9, bottom: -9, width: 306, height: 396 }, rotation: 0 };
const noBleed: PageBoxes = { ...withBleed, bleed: null };

test("imposeSafely passes the engine's layout and issues through", () => {
  const { layout, issues } = imposeSafely(spec());
  assert.deepEqual(layout, impose(spec()));
  assert.deepEqual(issues, layout.issues);
});

test("imposeSafely turns a thrown error into a layout-failed error on an empty layout", () => {
  const { layout, issues } = imposeSafely(spec(), () => {
    throw new RangeError("Invalid array length");
  });
  assert.deepEqual(issues, [{ code: "layout-failed", severity: "error", message: "These settings can't be laid out: Invalid array length" }]);
  assert.deepEqual(layout.sheets, []);
  assert.deepEqual(layout.allocations, []);
  assert.equal(layout.body, null);
  assert.deepEqual(layout.perSheet, []);
  assert.deepEqual(layout.fillers, { count: 0, size: { width: 0, height: 0 } });
  assert.deepEqual(layout.issues, []);
});

test("imposeSafely reports a thrown non-Error too", () => {
  const { issues } = imposeSafely(spec(), () => {
    throw "boom";
  });
  assert.equal(issues[0]!.message, "These settings can't be laid out: boom");
});

test("bleedWarnings is empty with no bleed, or when the placed pages have a bleed box", () => {
  assert.deepEqual(bleedWarnings(0, impose(spec(0)), pages(8).map(() => noBleed)), []);
  assert.deepEqual(bleedWarnings(9, impose(spec(9)), pages(8).map(() => withBleed)), []);
});

test("bleedWarnings warns when bleed is on and no placed page has a bleed box", () => {
  assert.deepEqual(bleedWarnings(9, impose(spec(9)), pages(8).map(() => noBleed)), [{
    code: "no-bleed-box",
    severity: "warning",
    message: "Bleed is set to 9 pt, but this PDF has no bleed area, so page edges will show white",
  }]);
});

test("bleedWarnings names the placed pages without a bleed box when only some lack one", () => {
  const boxes = pages(8).map((_, i) => (i === 2 || i === 5 ? noBleed : withBleed));
  assert.deepEqual(bleedWarnings(9, impose(spec(9)), boxes).map((i) => i.message), [
    "Bleed is set to 9 pt, but pages 3, 6 have no bleed area, so their edges will show white",
  ]);
});

test("bleedWarnings ignores pages the layout doesn't place", () => {
  const layout = impose(spec(9));
  const boxes = [...pages(8).map(() => withBleed), noBleed];
  assert.deepEqual(bleedWarnings(9, layout, boxes), []);
});
