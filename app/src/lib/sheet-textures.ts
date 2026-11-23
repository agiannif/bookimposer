// Paints printed sheet sides onto canvases for the 3D preview: either as the Layout prints them, from page
// thumbnails placed exactly as the sheet view places them, or as the exported PDF's sheet page renders.
import type { SheetSide, Size } from "../../../engine/src/index.ts";
import type { PageBoxes } from "./backend.ts";
import { imageRectForPlacement, thumbnailWidth } from "./sheet-geometry.ts";
import type { ThumbnailCache } from "./thumbnails.ts";

/** The longest side of a sheet texture, in pixels. */
export const TEXTURE_LONG_SIDE = 2048;

/** A sheet side's texture size in pixels and its pixels per sheet point, the long side `longSide` pixels. */
export function textureSize(sheet: Size, longSide = TEXTURE_LONG_SIDE): { width: number; height: number; scale: number } {
  const scale = longSide / Math.max(sheet.width, sheet.height);
  return { width: Math.round(sheet.width * scale), height: Math.round(sheet.height * scale), scale };
}

function paper(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

/** Waits for every page, then throws the first failure: the pages that did render are drawn. */
async function settled(drawing: Promise<void>[]): Promise<void> {
  const failed = (await Promise.allSettled(drawing)).find((r) => r.status === "rejected");
  if (failed) throw failed.reason;
}

/**
 * Paints `side` as it prints, `scale` pixels per sheet point: white paper, and each placed page's thumbnail
 * turned and clipped as imageRectForPlacement says. Blank panels stay white.
 */
export async function paintLayoutSide(
  ctx: CanvasRenderingContext2D, side: SheetSide, boxes: PageBoxes[], cache: ThumbnailCache, scale: number,
): Promise<void> {
  paper(ctx);
  await settled(side.placements.map(async (p) => {
    if (p.pdfPage === null) return;
    const bitmap = await cache.get(p.pdfPage, thumbnailWidth(p, boxes[p.pdfPage]!, scale, 1));
    // Drawn as soon as it resolves: the cache may close the bitmap later.
    const image = imageRectForPlacement(p, boxes[p.pdfPage]!);
    const cx = p.content.x + p.content.width / 2;
    const cy = p.content.y + p.content.height / 2;
    ctx.save();
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.rect(p.clip.x, p.clip.y, p.clip.width, p.clip.height);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate((p.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
    ctx.drawImage(bitmap, image.x, image.y, image.width, image.height);
    ctx.restore();
  }));
}

/** Paints the exported PDF's 0-based page `page`, a whole sheet side, over the canvas. */
export async function paintExportedSide(ctx: CanvasRenderingContext2D, cache: ThumbnailCache, page: number): Promise<void> {
  paper(ctx);
  const bitmap = await cache.get(page, ctx.canvas.width);
  ctx.drawImage(bitmap, 0, 0, ctx.canvas.width, ctx.canvas.height);
}

/** The exported PDF holds sheet 0 front, sheet 0 back, sheet 1 front and so on (crates/pdf-export sheets.rs). */
export const exportedPage = (sheet: number, side: "front" | "back") => 2 * sheet + (side === "back" ? 1 : 0);
