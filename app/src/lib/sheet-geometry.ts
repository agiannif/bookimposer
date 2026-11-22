// Maps a Layout's sheet points onto the screen. Pure, so the sheet view only draws what it returns.
import type { PagePlacement, Rect, Rotation, Size } from "../../../engine/src/index.ts";
import type { PageBoxes } from "./backend.ts";

/** Screen = offset + scale × sheet point. Both axes share the scale, so nothing is distorted. */
export interface SheetTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const PADDING = 16;

/** Fits `sheet` into `box` (CSS pixels) with 16 px padding, centred. Scale 0 when nothing fits. */
export function sheetTransform(sheet: Size, box: { width: number; height: number }): SheetTransform {
  const fit = Math.min((box.width - 2 * PADDING) / sheet.width, (box.height - 2 * PADDING) / sheet.height);
  // A 0x0 error sheet gives NaN or Infinity; a box inside its padding gives a negative scale.
  const scale = Number.isFinite(fit) && fit > 0 ? fit : 0;
  return {
    scale,
    offsetX: (box.width - sheet.width * scale) / 2,
    offsetY: (box.height - sheet.height * scale) / 2,
  };
}

/** `box` shrunk to the sheet it fits plus the padding, so a caption above it sits by the sheet. */
export function fittedStage(sheet: Size, box: { width: number; height: number }): { width: number; height: number } {
  const { scale } = sheetTransform(sheet, box);
  if (scale === 0) return box;
  return { width: sheet.width * scale + 2 * PADDING, height: sheet.height * scale + 2 * PADDING };
}

/**
 * How to show a sheet's front and back in `area` (CSS pixels): side by side or stacked, whichever
 * shows the sheet larger, and the stage each side gets. `gap` separates the sides; `caption` is the
 * height above each stage taken by its label.
 */
export function sidesLayout(
  sheet: Size,
  area: { width: number; height: number },
  gap: number,
  caption: number,
): { direction: "row" | "column"; stage: { width: number; height: number } } {
  const box = (width: number, height: number) => ({ width: Math.max(0, width), height: Math.max(0, height) });
  const row = box((area.width - gap) / 2, area.height - caption);
  const column = box(area.width, (area.height - gap) / 2 - caption);
  return sheetTransform(sheet, column).scale > sheetTransform(sheet, row).scale
    ? { direction: "column", stage: column }
    : { direction: "row", stage: row };
}

function mapRect(r: Rect, t: SheetTransform): Rect {
  return { x: t.offsetX + t.scale * r.x, y: t.offsetY + t.scale * r.y, width: t.scale * r.width, height: t.scale * r.height };
}

/**
 * Where to draw a placement's page image: the upright page's box, to be turned `rotation`
 * degrees clockwise about its centre (SVG `rotate(rotation cx cy)`, y down), and clipped to `clip`.
 * Turned a quarter, the upright box is `content` with width and height swapped, on the same centre,
 * so after turning it fills `content` exactly.
 */
export function placementSvg(
  p: PagePlacement,
  t: SheetTransform,
): { x: number; y: number; width: number; height: number; rotation: Rotation; clip: Rect } {
  const content = mapRect(p.content, t);
  const quarter = p.rotation === 90 || p.rotation === 270;
  const width = quarter ? content.height : content.width;
  const height = quarter ? content.width : content.height;
  return {
    x: content.x + content.width / 2 - width / 2,
    y: content.y + content.height / 2 - height / 2,
    width,
    height,
    rotation: p.rotation,
    clip: mapRect(p.clip, t),
  };
}

const UNIT: SheetTransform = { scale: 1, offsetX: 0, offsetY: 0 };

/**
 * The page's crop box around its trim as the page displays (after /Rotate), y down: how far each
 * crop edge lies beyond the trim, and the trim's displayed size.
 */
function displayedMargins(b: PageBoxes) {
  const left = b.trim.left - b.crop.left;
  const bottom = b.trim.bottom - b.crop.bottom;
  const right = b.crop.left + b.crop.width - (b.trim.left + b.trim.width);
  const top = b.crop.bottom + b.crop.height - (b.trim.bottom + b.trim.height);
  const quarter = b.rotation === 90 || b.rotation === 270;
  const trimWidth = quarter ? b.trim.height : b.trim.width;
  const trimHeight = quarter ? b.trim.width : b.trim.height;
  // Turning clockwise, the side that was at the bottom shows on the left, and so on round
  // (the same mapping as the Rust crate's geometry::displayed_box).
  switch (b.rotation) {
    case 90: return { left: bottom, top: left, right: top, bottom: right, trimWidth, trimHeight };
    case 180: return { left: right, top: bottom, right: left, bottom: top, trimWidth, trimHeight };
    case 270: return { left: top, top: right, right: bottom, bottom: left, trimWidth, trimHeight };
    default: return { left, top, right, bottom, trimWidth, trimHeight };
  }
}

/**
 * Where to draw a page's rendered image, in sheet points: the thumbnail covers the page's displayed
 * crop box, so it is scaled for the trim to fill the placement's upright content box and pushed out
 * by the crop's margins around the trim. Turn it `rotation` degrees clockwise about the centre of
 * `p.content` (not of this rect, which is off-centre when the margins are uneven), then clip to `p.clip`:
 * what shows is what prints, bleed included.
 */
export function imageRectForPlacement(
  p: PagePlacement,
  boxes: PageBoxes,
): { x: number; y: number; width: number; height: number; rotation: Rotation } {
  const upright = placementSvg(p, UNIT);
  const m = displayedMargins(boxes);
  const sx = upright.width / m.trimWidth;
  const sy = upright.height / m.trimHeight;
  return {
    x: upright.x - m.left * sx,
    y: upright.y - m.top * sy,
    width: (m.trimWidth + m.left + m.right) * sx,
    height: (m.trimHeight + m.top + m.bottom) * sy,
    rotation: p.rotation,
  };
}

/** The width in device pixels the page's rendered image is shown at, sheet scaled by `scale` CSS px per point. */
export function thumbnailWidth(p: PagePlacement, boxes: PageBoxes, scale: number, devicePixelRatio: number): number {
  return imageRectForPlacement(p, boxes).width * scale * devicePixelRatio;
}
