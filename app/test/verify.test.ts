import { test } from "node:test";
import assert from "node:assert/strict";
import { FACE_THRESHOLD, faceDifference, facesMatch, grayGrid, type Pixels } from "../src/lib/verify.ts";

/** A white 384x288 image (about the size faces are compared at) with a black block, plus a smaller dark mark so the picture is not symmetric. */
function picture(blockX = 60, blockY = 60, width = 384, height = 288): Pixels {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const fill = (x0: number, y0: number, w: number, h: number) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) data.set([0, 0, 0, 255], 4 * (y * width + x));
    }
  };
  fill(blockX, blockY, 180, 90);
  fill(blockX + 210, blockY + 120, 30, 30);
  return { width, height, data };
}

const blank = (width = 384, height = 288): Pixels => ({ width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) });

function turned(image: Pixels): Pixels {
  const { width, height } = image;
  const data = new Uint8ClampedArray(width * height * 4);
  // A quarter turn of a square crop of the picture: pixel (x, y) goes to (y, x).
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = y < width && x < height ? image.data[4 * (x * width + y)]! : 255;
      data.set([v, v, v, 255], 4 * (y * width + x));
    }
  }
  return { width, height, data };
}

test("identical images match", () => {
  assert.equal(faceDifference(picture(), picture()), 0);
  assert.ok(facesMatch(picture(), picture()));
});

test("anti-aliasing noise and a one pixel edge shift still match", () => {
  const noisy = picture();
  for (let i = 0; i < noisy.data.length; i += 4) {
    const wobble = ((i / 4) * 2654435761) % 21 - 10;
    for (let c = 0; c < 3; c++) (noisy.data as Uint8ClampedArray)[i + c] += wobble;
  }
  assert.ok(facesMatch(picture(), noisy), `difference ${faceDifference(picture(), noisy)}`);
  assert.ok(facesMatch(picture(), picture(61, 61)), `difference ${faceDifference(picture(), picture(61, 61))}`);
});

test("a shifted block is a mismatch", () => {
  assert.ok(!facesMatch(picture(), picture(120, 60)));
});

test("a turned picture is a mismatch", () => {
  assert.ok(!facesMatch(picture(), turned(picture())));
});

test("blank against content is a mismatch, both ways", () => {
  assert.ok(!facesMatch(picture(), blank()));
  assert.ok(!facesMatch(blank(), picture()));
});

test("images of different sizes compare through the same grid", () => {
  assert.ok(facesMatch(picture(), picture(120, 120, 768, 576)) === false);
  assert.equal(grayGrid(blank(10, 7)).length, 32 * 32);
  assert.ok(facesMatch(blank(10, 7), blank(200, 150)));
});

test("the threshold is a fraction of full scale", () => {
  assert.ok(FACE_THRESHOLD > 0 && FACE_THRESHOLD < 1);
});
