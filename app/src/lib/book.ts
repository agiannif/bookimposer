import { bodyPageCount, pagesPerPiece, SHEET_SIZES } from "../../../engine/src/index.ts";
import type { BookSpec, DuplexFlip, FoldCount, MismatchPolicy, PartSpec, SheetName, Size } from "../../../engine/src/index.ts";

export interface PrintChoice {
  sheet: SheetName | { width: number; height: number };
  duplex: DuplexFlip;
  margin: number;
  gap: number;
  bleed: number;
}

export interface BookSettings {
  signatures: number;
  folds: FoldCount;
  frontBoard: boolean;
  backBoard: boolean;
  print: PrintChoice;
  mismatch: MismatchPolicy;
  cutMarks: boolean;
  foldMarks: boolean;
}

export const DEFAULT_SETTINGS: BookSettings = {
  signatures: 1,
  folds: 1,
  frontBoard: false,
  backBoard: false,
  print: { sheet: "letter", duplex: "long-edge", margin: 18, gap: 0, bleed: 0 },
  mismatch: "fit",
  cutMarks: true,
  foldMarks: true,
};

export type PartKind = "front-board" | "body" | "back-board";

export interface BookPart {
  kind: PartKind;
  name: string;
}

export const PART_NAMES: Record<PartKind, string> = { "front-board": "Front board", body: "Body", "back-board": "Back board" };

/** The book's parts in book order; index i is part i of the BookSpec and of Layout.allocations. */
export function bookParts(s: BookSettings): BookPart[] {
  const kinds: PartKind[] = ["body"];
  if (s.frontBoard) kinds.unshift("front-board");
  if (s.backBoard) kinds.push("back-board");
  return kinds.map((kind) => ({ kind, name: PART_NAMES[kind] }));
}

function partSpecs(s: BookSettings): PartSpec[] {
  return bookParts(s).map((p) =>
    p.kind === "body" ? { type: "body", signatures: s.signatures, folds: s.folds } : { type: "board" });
}

export function toBookSpec(pageSizes: Size[], s: BookSettings): BookSpec {
  const parts = partSpecs(s);
  const sheet = typeof s.print.sheet === "string" ? SHEET_SIZES[s.print.sheet] : s.print.sheet;
  return { pageSizes, parts, print: { ...s.print, sheet }, mismatch: s.mismatch };
}

// How many signatures keep each one near a full-size piece (at least 8 pages). The body is what the boards'
// pages leave of the PDF, plus the blank leaves the boards wrap.
export function suggestSignatures(pageCount: number, s: BookSettings): number {
  const bodyPages = bodyPageCount(pageCount, partSpecs(s));
  const target = Math.max(8, pagesPerPiece(s.folds));
  return Math.max(1, Math.ceil(bodyPages / target));
}
