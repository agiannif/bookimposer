// What the workspace panels show, read off a Layout. Pure, so the components stay thin.
import type { Layout } from "../../../engine/src/index.ts";
import type { BookPart } from "./book.ts";

/** 1-based runs of PDF pages ("1–2, 5–7") and how many blank pages were added. */
export function pageRanges(pdfPages: (number | null)[]): { ranges: string; blanks: number } {
  const runs: [number, number][] = [];
  let blanks = 0;
  for (const page of pdfPages) {
    if (page === null) {
      blanks++;
      continue;
    }
    const last = runs.at(-1);
    if (last && page === last[1] + 1) last[1] = page;
    else runs.push([page, page]);
  }
  const ranges = runs.map(([a, b]) => (a === b ? `${a + 1}` : `${a + 1}–${b + 1}`)).join(", ");
  return { ranges, blanks };
}

export interface AllocationSegment {
  kind: BookPart["kind"];
  name: string;
  ranges: string;
  blanks: number;
  /** Pages in this part, blanks included; sizes the segment in the bar. */
  pages: number;
}

export function allocationSegments(layout: Layout, parts: BookPart[]): AllocationSegment[] {
  return layout.allocations.map((a) => ({
    ...parts[a.partIndex],
    ...pageRanges(a.pdfPages),
    pages: a.pdfPages.length,
  }));
}

/** null where the layout cannot tell, e.g. sheet counts on an error layout. */
export interface DerivedNumbers {
  pagesPerSignature: number | null;
  piecesPerSignature: number | null;
  piecesPerSheet: number | null;
  sheets: number | null;
  blanksAdded: number | null;
}

export function derivedNumbers(layout: Layout): DerivedNumbers {
  const bodyIndex = layout.allocations.find((a) => a.type === "body")?.partIndex;
  const group = layout.perSheet.find((g) => bodyIndex !== undefined && g.partIndexes.includes(bodyIndex));
  return {
    pagesPerSignature: layout.body?.pagesPerSignature ?? null,
    piecesPerSignature: layout.body?.piecesPerSignature ?? null,
    piecesPerSheet: group?.perSheet ?? null,
    sheets: layout.perSheet.length > 0 ? layout.perSheet.reduce((n, g) => n + g.sheets, 0) : null,
    blanksAdded: layout.body?.blanksAdded ?? null,
  };
}

const points = (n: number) => String(Math.round(n * 100) / 100);

/** What to cut for the boards' fillers, from Layout.fillers; null when the book has no boards. */
export function fillerNote(layout: Layout): string | null {
  const { count, size } = layout.fillers;
  if (count === 0) return null;
  const pieces = count === 1 ? "1 blank piece" : `${count} blank pieces`;
  return `Cut ${pieces} of ${points(size.width)} × ${points(size.height)} pt for the board filler${count === 1 ? "" : "s"}`;
}
