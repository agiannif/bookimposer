import { test } from "node:test";
import assert from "node:assert/strict";
import { impose } from "../../engine/src/index.ts";
import { bookParts, DEFAULT_SETTINGS, suggestSignatures, toBookSpec } from "../src/lib/book.ts";

const pages = (n: number) => Array.from({ length: n }, () => ({ width: 288, height: 378 }));
const boards = { ...DEFAULT_SETTINGS, frontBoard: true, backBoard: true };

test("toBookSpec builds board, body, board parts and imposes to 11 sheets", () => {
  const spec = toBookSpec(pages(76), { ...boards, signatures: 10 });
  assert.deepEqual(spec.parts, [{ type: "board" }, { type: "body", signatures: 10, folds: 1 }, { type: "board" }]);
  assert.equal(impose(spec).sheets.length, 11);
});

test("toBookSpec resolves named sheets and passes custom sizes through", () => {
  assert.deepEqual(toBookSpec(pages(8), DEFAULT_SETTINGS).print.sheet, { width: 612, height: 792 });
  const a4 = toBookSpec(pages(8), { ...DEFAULT_SETTINGS, print: { ...DEFAULT_SETTINGS.print, sheet: "a4" } });
  assert.deepEqual(a4.print.sheet, { width: 595.28, height: 841.89 });
  const tabloid = toBookSpec(pages(8), { ...DEFAULT_SETTINGS, print: { ...DEFAULT_SETTINGS.print, sheet: "tabloid" } });
  assert.deepEqual(tabloid.print.sheet, { width: 792, height: 1224 });
  const a3 = toBookSpec(pages(8), { ...DEFAULT_SETTINGS, print: { ...DEFAULT_SETTINGS.print, sheet: "a3" } });
  assert.deepEqual(a3.print.sheet, { width: 841.89, height: 1190.55 });
  const custom = { width: 500, height: 700 };
  const c = toBookSpec(pages(8), { ...DEFAULT_SETTINGS, print: { ...DEFAULT_SETTINGS.print, sheet: custom } });
  assert.deepEqual(c.print.sheet, custom);
});

test("toBookSpec carries print settings and mismatch policy", () => {
  const spec = toBookSpec(pages(8), { ...DEFAULT_SETTINGS, mismatch: "center" });
  assert.equal(spec.mismatch, "center");
  assert.equal(spec.print.duplex, "long-edge");
  assert.equal(spec.print.margin, 18);
});

test("suggestSignatures counts the blank leaves the boards wrap as body pages", () => {
  // Each board takes 2 pages and wraps a blank leaf of 2: 76 PDF pages make 76 body pages, 10 signatures of 8 with 4 padding.
  assert.equal(suggestSignatures(76, boards), 10);
  assert.equal(suggestSignatures(73, boards), 10);
  assert.equal(suggestSignatures(72, boards), 9);
  assert.equal(suggestSignatures(76, { ...boards, folds: 3 }), 5);
  assert.equal(suggestSignatures(76, { ...boards, backBoard: false }), 10);
  assert.equal(suggestSignatures(72, { ...boards, backBoard: false }), 9);
  assert.equal(suggestSignatures(4, boards), 1);
  assert.equal(suggestSignatures(0, boards), 1);
  assert.equal(suggestSignatures(-3, DEFAULT_SETTINGS), 1);
  assert.equal(suggestSignatures(16, DEFAULT_SETTINGS), 2);
});

test("every suggestion lays out without an error", () => {
  for (const pageCount of [5, 8, 9, 16, 17, 74, 75, 76, 77, 120]) {
    for (const folds of [1, 2, 3] as const) {
      for (const s of [DEFAULT_SETTINGS, boards, { ...boards, frontBoard: false }, { ...boards, backBoard: false }]) {
        const settings = { ...s, folds, signatures: suggestSignatures(pageCount, { ...s, folds }) };
        const tooMany = impose(toBookSpec(pages(pageCount), settings)).issues.filter((i) => i.code === "too-many-signatures");
        assert.deepEqual(tooMany, [], `${pageCount} pages, folds ${folds}, ${settings.signatures} signatures`);
      }
    }
  }
});

test("bookParts lists the parts in book order with display names", () => {
  assert.deepEqual(bookParts(DEFAULT_SETTINGS), [{ kind: "body", name: "Body" }]);
  assert.deepEqual(bookParts(boards), [
    { kind: "front-board", name: "Front board" },
    { kind: "body", name: "Body" },
    { kind: "back-board", name: "Back board" },
  ]);
  assert.deepEqual(bookParts({ ...DEFAULT_SETTINGS, backBoard: true }).map((p) => p.kind), ["body", "back-board"]);
});
