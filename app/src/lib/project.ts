import type { BookSettings } from "./book.ts";

export interface ProjectFile {
  version: 1;
  pdf: { name: string; pageCount: number; sha256: string };
  settings: BookSettings;
}

export type ParseResult = { ok: true; project: ProjectFile } | { ok: false; error: string };

class FieldError extends Error {}

function fail(path: string, expected: string): never {
  throw new FieldError(`${path} must be ${expected}`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "an object");
  return value as Record<string, unknown>;
}

function string(o: Record<string, unknown>, key: string, path: string): string {
  if (typeof o[key] !== "string") fail(`${path}.${key}`, "a string");
  return o[key] as string;
}

function boolean(o: Record<string, unknown>, key: string, path: string): boolean {
  if (typeof o[key] !== "boolean") fail(`${path}.${key}`, "true or false");
  return o[key] as boolean;
}

function pageCount(o: Record<string, unknown>, key: string, path: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) fail(`${path}.${key}`, "a whole number, 0 or more");
  return v;
}

function sha256(o: Record<string, unknown>, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== "string" || !/^[0-9a-f]{64}$/.test(v)) fail(`${path}.${key}`, "64 lowercase hex characters");
  return v;
}

function number(o: Record<string, unknown>, key: string, path: string, kind: "whole >= 1" | ">= 0" | "> 0"): number {
  const v = o[key];
  const ok = typeof v === "number" && Number.isFinite(v) &&
    (kind === "whole >= 1" ? Number.isInteger(v) && v >= 1 : kind === ">= 0" ? v >= 0 : v > 0);
  if (!ok) fail(`${path}.${key}`, `a number ${kind === "whole >= 1" ? "(whole, at least 1)" : kind}`);
  return v as number;
}

function oneOf<T>(o: Record<string, unknown>, key: string, path: string, allowed: readonly T[]): T {
  if (!allowed.includes(o[key] as T)) fail(`${path}.${key}`, `one of ${allowed.join(", ")}`);
  return o[key] as T;
}

function sheet(o: Record<string, unknown>, path: string): BookSettings["print"]["sheet"] {
  const v = o.sheet;
  if (v === "letter" || v === "a4") return v;
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(`${path}.sheet`, "letter, a4 or { width, height }");
  const size = v as Record<string, unknown>;
  return { width: number(size, "width", `${path}.sheet`, "> 0"), height: number(size, "height", `${path}.sheet`, "> 0") };
}

function settings(value: unknown): BookSettings {
  const o = object(value, "settings");
  const p = object(o.print, "settings.print");
  return {
    signatures: number(o, "signatures", "settings", "whole >= 1"),
    folds: oneOf(o, "folds", "settings", [1, 2, 3] as const),
    frontBoard: boolean(o, "frontBoard", "settings"),
    backBoard: boolean(o, "backBoard", "settings"),
    print: {
      sheet: sheet(p, "settings.print"),
      duplex: oneOf(p, "duplex", "settings.print", ["long-edge", "short-edge"] as const),
      margin: number(p, "margin", "settings.print", ">= 0"),
      gap: number(p, "gap", "settings.print", ">= 0"),
      bleed: number(p, "bleed", "settings.print", ">= 0"),
    },
    mismatch: oneOf(o, "mismatch", "settings", ["fit", "center"] as const),
    cutMarks: boolean(o, "cutMarks", "settings"),
    foldMarks: boolean(o, "foldMarks", "settings"),
  };
}

/** What to tell the person when the chosen PDF is not the one the project was saved with. */
export function pdfWarnings(saved: ProjectFile["pdf"], chosen: { sha256: string; pageCount: number }): string[] {
  if (chosen.sha256 === saved.sha256) return [];
  const warnings = ["This PDF is different from the one saved with the project"];
  if (chosen.pageCount !== saved.pageCount) warnings.push(`It has ${chosen.pageCount} pages, the project expects ${saved.pageCount}`);
  return warnings;
}

export function serializeProject(p: ProjectFile): string {
  return JSON.stringify(p, null, 2) + "\n";
}

export function parseProject(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "not valid JSON" };
  }
  try {
    const o = object(raw, "project");
    if (o.version !== 1) fail("version", "1");
    const pdf = object(o.pdf, "pdf");
    return {
      ok: true,
      project: {
        version: 1,
        pdf: {
          name: string(pdf, "name", "pdf"),
          pageCount: pageCount(pdf, "pageCount", "pdf"),
          sha256: sha256(pdf, "sha256", "pdf"),
        },
        settings: settings(o.settings),
      },
    };
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message };
    throw e;
  }
}
