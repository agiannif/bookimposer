import { test } from "node:test";
import assert from "node:assert/strict";
import { exportedPage, textureSize } from "../src/lib/sheet-textures.ts";

test("exportedPage follows the export's page order: each sheet's front, then its back", () => {
  // crates/pdf-export/src/sheets.rs writes sheet 0 front, sheet 0 back, sheet 1 front and so on.
  assert.deepEqual([[0, "front"], [0, "back"], [1, "front"], [1, "back"], [10, "back"]].map(([s, side]) => exportedPage(s as number, side as "front" | "back")), [0, 1, 2, 3, 21]);
});

test("textureSize gives the sheet's long side 2048 pixels", () => {
  assert.deepEqual(textureSize({ width: 612, height: 792 }), { width: 1583, height: 2048, scale: 2048 / 792 });
});
