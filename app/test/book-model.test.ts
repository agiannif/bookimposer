import { test } from "node:test";
import assert from "node:assert/strict";
import { impose } from "../../engine/src/index.ts";
import { assemble } from "../../assembler/assemble.ts";
import type { BookFace } from "../../assembler/assemble.ts";
import { DEFAULT_SETTINGS, toBookSpec, type BookSettings } from "../src/lib/book.ts";
import { faceUvs, sideKey, sidesNear, spreads, turningLeaves } from "../src/lib/book-model.ts";

const boards: BookSettings = { ...DEFAULT_SETTINGS, frontBoard: true, backBoard: true, signatures: 10 };
const landscape = Array.from({ length: 76 }, () => ({ width: 378, height: 288 }));
const portrait = Array.from({ length: 76 }, () => ({ width: 288, height: 378 }));
const bookOf = (pages = landscape, settings = boards) => {
  const layout = impose(toBookSpec(pages, settings));
  return { layout, book: assemble(layout) };
};

test("a board, the blank leaf it wraps and its inner half turn as one cover leaf", () => {
  const { book } = bookOf();
  assert.deepEqual(book.errors, []);
  const units = turningLeaves(book);
  assert.equal(units[0].leaves.length, 3);
  assert.equal(units[0].cover, true);
  assert.deepEqual([units[0].front.page, units[0].back.page], [0, 1]);
  assert.equal(units[1].leaves.length, 1);
  assert.equal(units[1].cover, false);
  assert.deepEqual([units[1].front.page, units[1].back.page], [2, 3]);
  const last = units.at(-1)!;
  assert.deepEqual([last.leaves.length, last.cover, last.front.page, last.back.page], [3, true, 74, 75]);
  // Every visible face is in exactly one turning leaf, as its front or back.
  const visible = book.leaves.flatMap((l) => [l.upper, l.lower]).filter((f) => !f.hidden);
  assert.deepEqual(units.flatMap((u) => [u.front, u.back]), visible);
});

test("spreads open the assembled book page by page, with labels from its faces", () => {
  const all = spreads(turningLeaves(bookOf().book));
  assert.deepEqual(all.slice(0, 3).map((s) => s.label), ["Cover, page 1", "Pages 2–3", "Pages 4–5"]);
  assert.equal(all[0].left, null);
  assert.equal(all[1].left?.page, 1);
  assert.equal(all[1].right?.page, 2);
  assert.equal(all.at(-1)!.label, "Back cover, page 76");
  assert.equal(all.at(-1)!.right, null);
  // 76 body pages (72 printed and the two blank leaves) in 10 signatures of 8 leave 4 blanks before the inside back cover.
  assert.deepEqual(all.slice(-5, -1).map((s) => s.label), ["Pages 72–73", "Page 74, blank", "Blank pages", "Blank, page 75"]);
});

test("spreads of a book built from a swapped printed sheet show the swap", () => {
  const { layout } = bookOf(portrait);
  const front = layout.sheets[0].front.placements;
  const a = front.find((p) => p.pdfPage === 2)!;
  const b = front.find((p) => p.pdfPage === 7)!;
  [a.pdfPage, b.pdfPage] = [b.pdfPage, a.pdfPage];
  assert.equal(spreads(turningLeaves(assemble(layout)))[1].label, "Pages 2–8");
});

const face = (rotation: BookFace["rotation"]): BookFace => ({
  sheet: 0, side: "front", region: { x: 100, y: 200, width: 300, height: 400 }, page: 0, rotation, hidden: false,
});
const sheet = { width: 1000, height: 1000 };

test("faceUvs maps the reader's corners onto the region, turned as the face says", () => {
  // Region corners in uv: top-left (0.1, 0.8), top-right (0.4, 0.8), bottom-right (0.4, 0.4), bottom-left (0.1, 0.4).
  const [tl, tr, br, bl]: [number, number][] = [[0.1, 0.8], [0.4, 0.8], [0.4, 0.4], [0.1, 0.4]];
  const close = (actual: [number, number][], expected: [number, number][]) =>
    assert.deepEqual(actual.map(([u, v]) => [+u.toFixed(9), +v.toFixed(9)]), expected);
  // Order: reader's top-left, top-right, bottom-left, bottom-right.
  close(faceUvs(face(0), sheet), [tl, tr, bl, br]);
  close(faceUvs(face(90), sheet), [bl, tl, br, tr]);
  close(faceUvs(face(180), sheet), [br, bl, tr, tl]);
  close(faceUvs(face(270), sheet), [tr, br, tl, bl]);
});

test("the first spread's faces come from the sheet regions where pages 2 and 3 are printed", () => {
  const { layout, book } = bookOf();
  const [, first] = spreads(turningLeaves(book));
  for (const [shown, page] of [[first.left!, 1], [first.right!, 2]] as const) {
    const printed = layout.sheets.flatMap((s, sheetIndex) =>
      (["front", "back"] as const).flatMap((side) => s[side].placements.filter((p) => p.pdfPage === page).map((p) => ({ sheetIndex, side, p }))));
    assert.equal(printed.length, 1);
    assert.deepEqual([shown.sheet, shown.side, shown.region], [printed[0].sheetIndex, printed[0].side, printed[0].p.panel]);
    // Landscape pages print turned a quarter, so the face turns them back.
    assert.equal((shown.rotation + printed[0].p.rotation) % 360, 0);
    assert.notEqual(printed[0].p.rotation, 0);
  }
});

test("sidesNear holds the sheet sides of the leaves shown and their neighbours", () => {
  const units = turningLeaves(bookOf().book);
  const expected = (from: number, to: number) => new Set(units.slice(from, to).flatMap((u) => [sideKey(u.front), sideKey(u.back)]));
  assert.deepEqual(sidesNear(units, 0), expected(0, 2));
  assert.deepEqual(sidesNear(units, 5), expected(3, 7));
  assert.deepEqual(sidesNear(units, units.length), expected(units.length - 2, units.length));
});
