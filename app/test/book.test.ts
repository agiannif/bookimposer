import { test } from "node:test";
import assert from "node:assert/strict";
import { impose } from "../../engine/src/index.ts";
import { bookParts, DEFAULT_SETTINGS, suggestSignatures, toBookSpec } from "../src/lib/book.ts";

const pages = (n: number) => Array.from({ length: n }, () => ({ width: 288, height: 378 }));
const boards = { ...DEFAULT_SETTINGS, frontBoard: true, backBoard: true };

test("toBookSpec builds board, body, board parts and imposes to 10 sheets", () => {
  const spec = toBookSpec(pages(76), { ...boards, signatures: 9 });
  assert.deepEqual(spec.parts, [{ type: "board" }, { type: "body", signatures: 9, folds: 1 }, { type: "board" }]);
  assert.equal(impose(spec).sheets.length, 10);
});

test("toBookSpec resolves named sheets and passes custom sizes through", () => {
  assert.deepEqual(toBookSpec(pages(8), DEFAULT_SETTINGS).print.sheet, { width: 612, height: 792 });
  const a4 = toBookSpec(pages(8), { ...DEFAULT_SETTINGS, print: { ...DEFAULT_SETTINGS.print, sheet: "a4" } });
  assert.deepEqual(a4.print.sheet, { width: 595.28, height: 841.89 });
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

test("suggestSignatures", () => {
  assert.equal(suggestSignatures(76, boards), 9);
  assert.equal(suggestSignatures(74, boards), 9);
  assert.equal(suggestSignatures(76, { ...boards, folds: 3 }), 5);
  assert.equal(suggestSignatures(4, boards), 1);
  assert.equal(suggestSignatures(0, boards), 1);
  assert.equal(suggestSignatures(-3, DEFAULT_SETTINGS), 1);
  assert.equal(suggestSignatures(16, DEFAULT_SETTINGS), 2);
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
