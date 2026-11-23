import { test } from "node:test";
import assert from "node:assert/strict";
import { impose } from "../../engine/src/index.ts";
import { bookParts, DEFAULT_SETTINGS, toBookSpec, type BookSettings } from "../src/lib/book.ts";
import { allocationSegments, derivedNumbers, pageRanges, panelLabel } from "../src/lib/layout-view.ts";

const pages = (n: number) => Array.from({ length: n }, () => ({ width: 288, height: 378 }));
const boards: BookSettings = { ...DEFAULT_SETTINGS, frontBoard: true, backBoard: true, signatures: 10 };
const layoutOf = (pageCount: number, s: BookSettings) => impose(toBookSpec(pages(pageCount), s));

test("pageRanges turns 0-based PDF pages into 1-based runs and counts blanks", () => {
  assert.deepEqual(pageRanges([0, 1]), { ranges: "1–2", blanks: 0 });
  assert.deepEqual(pageRanges([5]), { ranges: "6", blanks: 0 });
  assert.deepEqual(pageRanges([2, 3, 4, null, null]), { ranges: "3–5", blanks: 2 });
  assert.deepEqual(pageRanges([0, 1, 4, 5, 6]), { ranges: "1–2, 5–7", blanks: 0 });
  assert.deepEqual(pageRanges([null]), { ranges: "", blanks: 1 });
  assert.deepEqual(pageRanges([]), { ranges: "", blanks: 0 });
});

test("allocationSegments names each part and gives its page ranges, the blank leaves apart", () => {
  const segments = allocationSegments(layoutOf(76, boards), bookParts(boards));
  assert.deepEqual(segments, [
    { kind: "front-board", name: "Front board", ranges: "1–2", blanks: 0, leafBefore: 0, leafAfter: 0, pages: 2 },
    { kind: "body", name: "Body", ranges: "3–74", blanks: 4, leafBefore: 2, leafAfter: 2, pages: 80 },
    { kind: "back-board", name: "Back board", ranges: "75–76", blanks: 0, leafBefore: 0, leafAfter: 0, pages: 2 },
  ]);
});

test("allocationSegments shows padding blanks and blank leaves apart", () => {
  const segments = allocationSegments(layoutOf(74, boards), bookParts(boards));
  assert.deepEqual(segments[1], { kind: "body", name: "Body", ranges: "3–72", blanks: 6, leafBefore: 2, leafAfter: 2, pages: 80 });
  assert.deepEqual(segments[2], { kind: "back-board", name: "Back board", ranges: "73–74", blanks: 0, leafBefore: 0, leafAfter: 0, pages: 2 });
});

test("allocationSegments follows the parts when a board is removed", () => {
  const s = { ...boards, frontBoard: false };
  assert.deepEqual(allocationSegments(layoutOf(76, s), bookParts(s)).map((g) => [g.name, g.ranges]), [
    ["Body", "1–74"],
    ["Back board", "75–76"],
  ]);
  const body = allocationSegments(layoutOf(76, s), bookParts(s))[0];
  assert.deepEqual([body.leafBefore, body.leafAfter, body.blanks], [0, 2, 4]);
  const front = { ...boards, backBoard: false };
  const onlyFront = allocationSegments(layoutOf(76, front), bookParts(front))[1];
  assert.deepEqual([onlyFront.ranges, onlyFront.leafBefore, onlyFront.leafAfter, onlyFront.blanks], ["3–76", 2, 0, 4]);
});

test("derivedNumbers reads the body summary and the body's sheet group", () => {
  assert.deepEqual(derivedNumbers(layoutOf(76, boards)), {
    pagesPerSignature: 8,
    piecesPerSignature: 2,
    piecesPerSheet: 2,
    sheets: 11,
    blanksAdded: 4,
  });
  assert.equal(derivedNumbers(layoutOf(74, boards)).blanksAdded, 6);
});

test("derivedNumbers leaves out what an error layout cannot know", () => {
  const tooBig = layoutOf(76, { ...boards, print: { ...boards.print, margin: 400 } });
  assert.deepEqual(derivedNumbers(tooBig), {
    pagesPerSignature: 8,
    piecesPerSignature: 2,
    piecesPerSheet: null,
    sheets: null,
    blanksAdded: 4,
  });
  const noBody = layoutOf(76, { ...boards, signatures: 0 });
  assert.deepEqual(derivedNumbers(noBody), {
    pagesPerSignature: null,
    piecesPerSignature: null,
    piecesPerSheet: null,
    sheets: null,
    blanksAdded: null,
  });
});

test("derivedNumbers takes pieces per sheet from the body's group and adds up every group's sheets", () => {
  // With 2 folds the body's pieces and the boards' pieces differ in size, so they print on separate sheets.
  const layout = layoutOf(76, { ...boards, folds: 2 });
  assert.equal(layout.perSheet.length, 2);
  assert.equal(derivedNumbers(layout).piecesPerSheet, 1);
  assert.equal(derivedNumbers(layout).sheets, 11);
});


test("panelLabel numbers PDF pages, and a board's blank leaf with the board's own pages; padding stays unnumbered", () => {
  const layout = layoutOf(76, boards);
  const labels = (sheet: number, side: "front" | "back") => layout.sheets[sheet]![side].placements.map((p) => panelLabel(layout, p));
  // Sheet 1: body pages 8 1 6 3 / 2 7 4 5, where 1 and 2 are the front board's blank leaf.
  assert.deepEqual(labels(0, "front"), ["8", "1", "6", "3"]);
  assert.deepEqual(labels(0, "back"), ["2", "7", "4", "5"]);
  // Sheet 10: the last signature, PDF pages 73-74, 4 padding blanks and the back board's leaf (75, 76).
  assert.deepEqual([...labels(9, "front"), ...labels(9, "back")].sort(), ["73", "74", "75", "76", null, null, null, null].sort());
});

test("panelLabel leaves every blank unnumbered without boards", () => {
  const layout = layoutOf(6, { ...DEFAULT_SETTINGS, signatures: 1 });
  const blanks = layout.sheets.flatMap((s) => [...s.front.placements, ...s.back.placements]).filter((p) => p.pdfPage === null);
  assert.equal(blanks.length, 2);
  for (const p of blanks) assert.equal(panelLabel(layout, p), null);
});
