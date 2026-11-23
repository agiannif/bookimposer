// Verifies an export: each page face of the book, painted from the exported sheets, against the same face
// painted from the Layout (the preview). Faces come from the assembled book, so the check follows where the
// sheets put each page, not the PDF's page order.
import type { Layout } from "../../../engine/src/index.ts";
import type { AssembledBook, BookFace } from "../../../assembler/assemble.ts";
import type { PageBoxes } from "./backend.ts";
import { exportedPage, paintExportedSide, paintLayoutSide, textureSize } from "./sheet-textures.ts";
import type { ThumbnailCache } from "./thumbnails.ts";
import { facesMatch } from "./verify.ts";

/** The long side of the images faces are compared at, in pixels. */
const VERIFY_LONG_SIDE = 768;

/** Dev-only test hook: draws over an exported side after it is painted, to show the check catches it. */
export type PerturbExport = (ctx: CanvasRenderingContext2D, side: { sheet: number; side: "front" | "back"; scale: number }) => void;

export interface Verdict {
  /** Pages compared, 0-based. */
  checked: number;
  /** The pages (0-based) whose face differs, in ascending order. */
  differing: number[];
}

/** The book's visible faces that show a page, by sheet side. */
function pageFaces(book: AssembledBook): Map<string, BookFace[]> {
  const bySide = new Map<string, BookFace[]>();
  for (const leaf of book.leaves) {
    for (const face of [leaf.upper, leaf.lower]) {
      if (face.hidden || face.page === null) continue;
      const key = `${face.sheet}-${face.side}`;
      bySide.set(key, [...(bySide.get(key) ?? []), face]);
    }
  }
  return bySide;
}

function canvasFor(size: { width: number; height: number }): CanvasRenderingContext2D {
  const canvas = Object.assign(document.createElement("canvas"), { width: size.width, height: size.height });
  return canvas.getContext("2d", { willReadFrequently: true })!;
}

export async function verifyExport(
  layout: Layout, book: AssembledBook, boxes: PageBoxes[], preview: ThumbnailCache, exported: ThumbnailCache,
  perturb?: PerturbExport,
): Promise<Verdict> {
  const size = textureSize(layout.sheet, VERIFY_LONG_SIDE);
  const differing = new Set<number>();
  let checked = 0;
  for (const [key, faces] of pageFaces(book)) {
    const [sheetText, side] = key.split("-");
    const sheet = Number(sheetText);
    const printed = canvasFor(size);
    const exportedCtx = canvasFor(size);
    await paintLayoutSide(printed, layout.sheets[sheet]![side as "front" | "back"], boxes, preview, size.scale);
    await paintExportedSide(exportedCtx, exported, exportedPage(sheet, side as "front" | "back"));
    perturb?.(exportedCtx, { sheet, side: side as "front" | "back", scale: size.scale });
    for (const face of faces) {
      const x = Math.round(face.region.x * size.scale);
      const y = Math.round(face.region.y * size.scale);
      const w = Math.max(1, Math.round(face.region.width * size.scale));
      const h = Math.max(1, Math.round(face.region.height * size.scale));
      checked++;
      if (!facesMatch(printed.getImageData(x, y, w, h), exportedCtx.getImageData(x, y, w, h))) differing.add(face.page!);
    }
  }
  return { checked, differing: [...differing].sort((a, b) => a - b) };
}
