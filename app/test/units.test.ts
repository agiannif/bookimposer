import { test } from "node:test";
import assert from "node:assert/strict";
import { formatLength, loadUnit, parseLength, presetLabel, saveUnit, toPoints, fromPoints, type Unit } from "../src/lib/units.ts";

test("typing 0.25 in stores exactly 18 pt, and 18 pt shows as 0.25 in", () => {
  assert.equal(toPoints(0.25, "in"), 18);
  assert.equal(formatLength(18, "in"), "0.25");
});

test("typing 6.35 mm stores exactly 18 pt", () => {
  assert.equal(toPoints(6.35, "mm"), 18);
});

test("pt is the identity", () => {
  assert.equal(toPoints(13.5, "pt"), 13.5);
  assert.equal(fromPoints(13.5, "pt"), 13.5);
});

test("formatLength rounds in to 3 decimals, mm to 1, pt to 2, and trims trailing zeros", () => {
  assert.equal(formatLength(595.28, "in"), "8.268");
  assert.equal(formatLength(612, "in"), "8.5");
  assert.equal(formatLength(612, "mm"), "215.9");
  assert.equal(formatLength(595.28, "mm"), "210");
  assert.equal(formatLength(288.123, "pt"), "288.12");
  assert.equal(formatLength(0, "in"), "0");
});

test("typed values round-trip through the stored points", () => {
  const cases: [number, Unit][] = [[0.25, "in"], [8.5, "in"], [1.125, "in"], [5, "mm"], [215.9, "mm"], [297, "mm"], [12.34, "pt"]];
  for (const [typed, unit] of cases) {
    assert.equal(formatLength(toPoints(typed, unit), unit), String(typed), `${typed} ${unit}`);
  }
});

test("parseLength reads typed text into points, or null when it is not a number", () => {
  assert.equal(parseLength("0.25", "in"), 18);
  assert.equal(parseLength(" 10 ", "mm"), toPoints(10, "mm"));
  assert.equal(parseLength("", "in"), null);
  assert.equal(parseLength("abc", "pt"), null);
  assert.equal(parseLength("1e999", "pt"), null);
});

test("preset labels show the sheet in the selected unit", () => {
  assert.equal(presetLabel("letter", "in"), "Letter (8.5 × 11 in)");
  assert.equal(presetLabel("tabloid", "in"), "Tabloid (11 × 17 in)");
  assert.equal(presetLabel("a4", "mm"), "A4 (210 × 297 mm)");
  assert.equal(presetLabel("a3", "mm"), "A3 (297 × 420 mm)");
  assert.equal(presetLabel("letter", "mm"), "Letter (215.9 × 279.4 mm)");
  assert.equal(presetLabel("a4", "in"), "A4 (8.268 × 11.693 in)");
  assert.equal(presetLabel("letter", "pt"), "Letter (612 × 792 pt)");
});

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
}

test("the unit preference defaults to in and is remembered", () => {
  const storage = memoryStorage();
  assert.equal(loadUnit(storage), "in");
  saveUnit("mm", storage);
  assert.equal(loadUnit(storage), "mm");
});

test("an unknown stored unit falls back to in", () => {
  assert.equal(loadUnit(memoryStorage({ "bookimposer.unit": "cubits" })), "in");
});

test("the unit preference works without usable storage", () => {
  const broken = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
  };
  assert.equal(loadUnit(broken), "in");
  saveUnit("pt", broken);
  assert.equal(loadUnit(null), "in");
  saveUnit("pt", null);
});
