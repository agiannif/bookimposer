import { test } from "node:test";
import assert from "node:assert/strict";
import { impose, type PagePlacement } from "../../engine/src/index.ts";
import { workedExample } from "../../engine/test/fixtures.ts";
import type { PageBoxes } from "../src/lib/backend.ts";
import { fittedStage, imageRectForPlacement, placementSvg, sheetTransform, sidesLayout, thumbnailWidth } from "../src/lib/sheet-geometry.ts";

const unit = { scale: 1, offsetX: 0, offsetY: 0 };

test("sheetTransform fits the sheet into the box with 16 px padding, centred", () => {
  // 612x792 into 400x400: height limits, (400 - 32) / 792.
  const scale = 368 / 792;
  assert.deepEqual(sheetTransform({ width: 612, height: 792 }, { width: 400, height: 400 }), {
    scale,
    offsetX: (400 - 612 * scale) / 2,
    offsetY: 16,
  });
  // 792x612 into 1000x600: height limits again, (600 - 32) / 612.
  const wide = 568 / 612;
  assert.deepEqual(sheetTransform({ width: 792, height: 612 }, { width: 1000, height: 600 }), {
    scale: wide,
    offsetX: (1000 - 792 * wide) / 2,
    offsetY: 16,
  });
  // Width limits: (300 - 32) / 612.
  const narrow = 268 / 612;
  assert.deepEqual(sheetTransform({ width: 612, height: 792 }, { width: 300, height: 2000 }), {
    scale: narrow,
    offsetX: 16,
    offsetY: (2000 - 792 * narrow) / 2,
  });
});

test("sheetTransform has scale 0 when nothing can be shown", () => {
  // An error layout's 0x0 sheet, or a box no bigger than its padding.
  assert.deepEqual(sheetTransform({ width: 0, height: 0 }, { width: 400, height: 400 }), { scale: 0, offsetX: 200, offsetY: 200 });
  assert.deepEqual(sheetTransform({ width: 612, height: 792 }, { width: 20, height: 400 }), {
    scale: 0,
    offsetX: 10,
    offsetY: 200,
  });
});

test("placementSvg puts the worked example's first page where the engine placed it", () => {
  const placement = impose(workedExample()).sheets[0]!.front.placements.find((p) => p.pdfPage === 9)!;
  assert.deepEqual(placementSvg(placement, unit), {
    x: 18,
    y: 18,
    width: 288,
    height: 378,
    rotation: 0,
    clip: { x: 18, y: 18, width: 288, height: 378 },
  });
});

/** A landscape letter sheet puts portrait pages on their side. */
const landscape = () => impose(workedExample({ pageSizes: Array.from({ length: 16 }, () => ({ width: 288, height: 378 })),
  parts: [{ type: "body", signatures: 1, folds: 1 }], print: { ...workedExample().print, sheet: { width: 792, height: 612 } } }));

test("placementSvg gives a quarter-turned page's upright box, centred on its content", () => {
  const placement = landscape().sheets[0]!.front.placements.find((p) => p.rotation === 90)!;
  const { content } = placement;
  assert.deepEqual({ width: content.width, height: content.height }, { width: 378, height: 288 });
  assert.deepEqual(placementSvg(placement, unit), {
    x: content.x + 378 / 2 - 288 / 2,
    y: content.y + 288 / 2 - 378 / 2,
    width: 288,
    height: 378,
    rotation: 90,
    clip: placement.clip,
  });
});

test("placementSvg scales and offsets everything by the transform", () => {
  const placement: PagePlacement = {
    pdfPage: 0,
    partIndex: 0,
    panel: { x: 10, y: 20, width: 100, height: 200 },
    content: { x: 10, y: 20, width: 100, height: 200 },
    clip: { x: 5, y: 15, width: 110, height: 210 },
    rotation: 270,
  };
  assert.deepEqual(placementSvg(placement, { scale: 2, offsetX: 3, offsetY: 4 }), {
    x: 3 + 2 * (60 - 100),
    y: 4 + 2 * (120 - 50),
    width: 400,
    height: 200,
    rotation: 270,
    clip: { x: 13, y: 34, width: 220, height: 420 },
  });
});

/** A page whose crop (and media) box is `crop` and whose trim box is `trim`, turned by `/Rotate`. */
function boxes(crop: [number, number], trim: { left: number; bottom: number; width: number; height: number }, rotation = 0): PageBoxes {
  const box = { left: 0, bottom: 0, width: crop[0], height: crop[1] };
  return { trim, crop: box, media: box, bleed: null, rotation };
}

/** 288x378 pages with no TrimBox: trim is the crop. */
const plain = boxes([288, 378], { left: 0, bottom: 0, width: 288, height: 378 });
/** A 306x396 page with its trim inset 9 pt on every side (TrimBox 9 9 297 387). */
const inset = boxes([306, 396], { left: 9, bottom: 9, width: 288, height: 378 });

function placement(content: { x: number; y: number; width: number; height: number }, rotation: PagePlacement["rotation"] = 0): PagePlacement {
  return { pdfPage: 0, partIndex: 0, panel: content, content, clip: content, rotation };
}

test("imageRectForPlacement: with the trim equal to the crop, the image is the content", () => {
  const p = impose(workedExample()).sheets[0]!.front.placements.find((p) => p.pdfPage === 9)!;
  assert.deepEqual(imageRectForPlacement(p, plain), { x: 18, y: 18, width: 288, height: 378, rotation: 0 });
});

test("imageRectForPlacement: a trim inset 9 pt puts the image 9 pt beyond the content on every side", () => {
  const p = placement({ x: 18, y: 18, width: 288, height: 378 });
  assert.deepEqual(imageRectForPlacement(p, inset), { x: 9, y: 9, width: 306, height: 396, rotation: 0 });
});

test("imageRectForPlacement: the same page turned a quarter by the placement stays 9 pt beyond, upright", () => {
  // A landscape content rect; the upright page box is 288x378 on the same centre, so x 63, y 18.
  const p = placement({ x: 18, y: 63, width: 378, height: 288 }, 90);
  assert.deepEqual(imageRectForPlacement(p, inset), { x: 54, y: 9, width: 306, height: 396, rotation: 90 });
});

test("imageRectForPlacement scales the crop margins with the content in fit mode", () => {
  // Content at half the trim size: every margin halves too.
  const p = placement({ x: 100, y: 100, width: 144, height: 189 });
  assert.deepEqual(imageRectForPlacement(p, inset), { x: 95.5, y: 95.5, width: 153, height: 198, rotation: 0 });
});

// Uneven margins on a 306x396 crop: left 10, bottom 20, right 16, top 26 (trim 280x350).
const uneven = (rotation: number) => boxes([306, 396], { left: 10, bottom: 20, width: 280, height: 350 }, rotation);

test("imageRectForPlacement turns the crop margins with a /Rotate 90 page", () => {
  // Turned clockwise, the bottom margin shows on the left and the left margin on top: left 20, top 10.
  const p = placement({ x: 100, y: 50, width: 350, height: 280 });
  assert.deepEqual(imageRectForPlacement(p, uneven(90)), { x: 80, y: 40, width: 396, height: 306, rotation: 0 });
});

test("imageRectForPlacement turns the crop margins with /Rotate 180 and 270 pages", () => {
  // 180: the right margin shows on the left (16), the bottom on top (20).
  assert.deepEqual(imageRectForPlacement(placement({ x: 100, y: 50, width: 280, height: 350 }), uneven(180)),
    { x: 84, y: 30, width: 306, height: 396, rotation: 0 });
  // 270: the top margin shows on the left (26), the right on top (16).
  assert.deepEqual(imageRectForPlacement(placement({ x: 100, y: 50, width: 350, height: 280 }), uneven(270)),
    { x: 74, y: 34, width: 396, height: 306, rotation: 0 });
});

test("thumbnailWidth is the rendered page's displayed width in device pixels", () => {
  const upright = impose(workedExample()).sheets[0]!.front.placements[0]!;
  assert.equal(thumbnailWidth(upright, plain, 0.5, 2), 288);
  const turned = landscape().sheets[0]!.front.placements.find((p) => p.rotation === 90)!;
  assert.equal(thumbnailWidth(turned, plain, 1, 1.5), 288 * 1.5, "the upright page's width, not its panel's");
  assert.equal(thumbnailWidth(upright, inset, 1, 1), 306, "the whole crop box, margins included");
});

const letter = { width: 612, height: 792 };

test("sidesLayout puts the sides side by side when that shows the sheet larger", () => {
  // A wide area: side by side, each (1000 - 12) / 2 wide and 600 - 26 tall.
  assert.deepEqual(sidesLayout(letter, { width: 1000, height: 600 }, 12, 26), {
    direction: "row",
    stage: { width: 494, height: 574 },
  });
});

test("sidesLayout stacks the sides when that shows the sheet larger", () => {
  // A wide landscape sheet in a tall area: stacked, each 500 wide and (900 - 12) / 2 - 26 tall.
  assert.deepEqual(sidesLayout({ width: 1300, height: 850 }, { width: 500, height: 900 }, 12, 26), {
    direction: "column",
    stage: { width: 500, height: 418 },
  });
});

test("sidesLayout never gives a negative stage", () => {
  assert.deepEqual(sidesLayout(letter, { width: 0, height: 0 }, 12, 26), { direction: "row", stage: { width: 0, height: 0 } });
});

test("fittedStage shrinks a box to the sheet it fits plus the padding, at the same scale", () => {
  // Width limits 612x792 in 300x2000: scale 268 / 612, so the sheet is 268 wide and 792 * scale tall.
  const scale = 268 / 612;
  const stage = fittedStage(letter, { width: 300, height: 2000 });
  assert.deepEqual(stage, { width: 300, height: 792 * scale + 32 });
  assert.equal(sheetTransform(letter, stage).scale, scale);
  assert.deepEqual(fittedStage({ width: 0, height: 0 }, { width: 300, height: 300 }), { width: 300, height: 300 });
});
