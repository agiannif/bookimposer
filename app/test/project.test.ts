import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../src/lib/book.ts";
import { parseProject, pdfWarnings, serializeProject, type ProjectFile } from "../src/lib/project.ts";

const project: ProjectFile = {
  version: 1,
  pdf: { name: "book.pdf", pageCount: 76, sha256: "ab".repeat(32) },
  settings: { ...DEFAULT_SETTINGS, frontBoard: true, print: { ...DEFAULT_SETTINGS.print, sheet: { width: 500, height: 700 } } },
};

function errorOf(text: string): string {
  const r = parseProject(text);
  assert.equal(r.ok, false);
  return r.ok ? "" : r.error;
}

function withSettings(change: (s: any) => void): string {
  const copy = JSON.parse(serializeProject(project));
  change(copy.settings);
  return JSON.stringify(copy);
}

test("a project round-trips", () => {
  const r = parseProject(serializeProject(project));
  assert.deepEqual(r, { ok: true, project });
});

test("serialize is pretty JSON", () => {
  assert.match(serializeProject(project), /\n  "version": 1/);
});

test("rejects bad JSON and non-objects", () => {
  assert.match(errorOf("{nope"), /JSON/);
  assert.match(errorOf("[]"), /project/);
});

test("rejects an unknown version", () => {
  assert.match(errorOf(JSON.stringify({ ...project, version: 2 })), /version/);
});

test("rejects missing pdf and wrong pdf field types", () => {
  assert.match(errorOf(JSON.stringify({ version: 1, settings: project.settings })), /pdf/);
  assert.match(errorOf(JSON.stringify({ ...project, pdf: { ...project.pdf, pageCount: "76" } })), /pdf\.pageCount/);
  assert.match(errorOf(JSON.stringify({ ...project, pdf: { ...project.pdf, name: 3 } })), /pdf\.name/);
  assert.match(errorOf(JSON.stringify({ ...project, pdf: { ...project.pdf, sha256: null } })), /pdf\.sha256/);
});

test("rejects bad settings, naming the field path", () => {
  assert.match(errorOf(withSettings((s) => (s.print.margin = "x"))), /settings\.print\.margin/);
  assert.match(errorOf(withSettings((s) => (s.print.gap = -1))), /settings\.print\.gap/);
  assert.match(errorOf(withSettings((s) => delete s.print.bleed)), /settings\.print\.bleed/);
  assert.match(errorOf(withSettings((s) => (s.signatures = 0))), /settings\.signatures/);
  assert.match(errorOf(withSettings((s) => (s.signatures = 1.5))), /settings\.signatures/);
  assert.match(errorOf(withSettings((s) => (s.folds = 4))), /settings\.folds/);
  assert.match(errorOf(withSettings((s) => (s.frontBoard = "yes"))), /settings\.frontBoard/);
  assert.match(errorOf(withSettings((s) => (s.backBoard = 1))), /settings\.backBoard/);
  assert.match(errorOf(withSettings((s) => (s.mismatch = "stretch"))), /settings\.mismatch/);
  assert.match(errorOf(withSettings((s) => (s.cutMarks = null))), /settings\.cutMarks/);
  assert.match(errorOf(withSettings((s) => (s.foldMarks = 0))), /settings\.foldMarks/);
  assert.match(errorOf(withSettings((s) => (s.print.duplex = "diagonal"))), /settings\.print\.duplex/);
  assert.match(errorOf(withSettings((s) => (s.print = null))), /settings\.print/);
  assert.match(errorOf(JSON.stringify({ ...project, settings: 5 })), /settings/);
});

test("rejects bad sheet values", () => {
  assert.match(errorOf(withSettings((s) => (s.print.sheet = "legal"))), /settings\.print\.sheet/);
  assert.match(errorOf(withSettings((s) => (s.print.sheet = { width: 0, height: 5 }))), /settings\.print\.sheet\.width/);
  assert.match(errorOf(withSettings((s) => (s.print.sheet = { width: 5, height: "x" }))), /settings\.print\.sheet\.height/);
  assert.match(errorOf(withSettings((s) => (s.print.sheet = null))), /settings\.print\.sheet/);
});

test("accepts named sheets", () => {
  for (const sheet of ["letter", "a4"]) {
    const r = parseProject(withSettings((s) => (s.print.sheet = sheet)));
    assert.equal(r.ok, true);
  }
});

test("rejects a page count that is not a non-negative integer", () => {
  for (const bad of [1.5, -1, "76", null]) {
    const text = JSON.stringify({ ...project, pdf: { ...project.pdf, pageCount: bad } });
    assert.match(errorOf(text), /pdf\.pageCount must be a whole number, 0 or more/);
  }
  assert.equal(parseProject(JSON.stringify({ ...project, pdf: { ...project.pdf, pageCount: 0 } })).ok, true);
});

test("rejects a sha256 that is not 64 lowercase hex characters", () => {
  for (const bad of ["abc", "AB".repeat(32), "zz".repeat(32), "ab".repeat(33), 5]) {
    const text = JSON.stringify({ ...project, pdf: { ...project.pdf, sha256: bad } });
    assert.match(errorOf(text), /pdf\.sha256 must be 64 lowercase hex characters/);
  }
});

test("pdfWarnings is empty when the hash matches", () => {
  assert.deepEqual(pdfWarnings(project.pdf, { sha256: project.pdf.sha256, pageCount: 76 }), []);
});

test("pdfWarnings reports a different PDF with the same page count", () => {
  assert.deepEqual(pdfWarnings(project.pdf, { sha256: "cd".repeat(32), pageCount: 76 }), [
    "This PDF is different from the one saved with the project",
  ]);
});

test("pdfWarnings also reports a different page count", () => {
  assert.deepEqual(pdfWarnings(project.pdf, { sha256: "cd".repeat(32), pageCount: 74 }), [
    "This PDF is different from the one saved with the project",
    "It has 74 pages, the project expects 76",
  ]);
});
