// The 3D preview's book, from the leaves the assembler builds out of the printed sheets: which leaves turn
// together, what each spread shows, and where on a sheet side's texture each face's picture comes from.
// Pure, so the scene only draws what it returns and tests can check it without WebGL.
import type { AssembledBook, BookFace, BookLeaf } from "../../../assembler/assemble.ts";
import type { Size } from "../../../engine/src/index.ts";

/**
 * Leaves that turn as one: a leaf whose verso is glued out of sight is glued to the next one, so a board's
 * outer half, the blank leaf it wraps and its inner half turn together. `front` is the first leaf's recto,
 * `back` the last leaf's verso. `cover` is true when it holds a board's leaves.
 */
export interface TurningLeaf {
  leaves: BookLeaf[];
  front: BookFace;
  back: BookFace;
  cover: boolean;
}

export function turningLeaves(book: AssembledBook): TurningLeaf[] {
  const units: TurningLeaf[] = [];
  let glued: BookLeaf[] = [];
  for (const leaf of book.leaves) {
    glued.push(leaf);
    if (leaf.lower.hidden) continue;
    units.push({ leaves: glued, front: glued[0].upper, back: leaf.lower, cover: glued.some((l) => l.kind === "board") });
    glued = [];
  }
  // Only a broken assembly ends on a hidden face; keep its leaves so they still show.
  if (glued.length > 0) units.push({ leaves: glued, front: glued[0].upper, back: glued.at(-1)!.lower, cover: glued.some((l) => l.kind === "board") });
  return units;
}

/**
 * What one opening of the book shows. Spread 0 is the closed book's front, spread n (the number of turning
 * leaves) its back; in between, `left` is the verso of the last turned leaf and `right` the recto of the next.
 */
export interface Spread {
  left: BookFace | null;
  right: BookFace | null;
  label: string;
}

const pageName = (face: BookFace) => (face.page === null ? "blank" : `page ${face.page + 1}`);

export function spreads(units: TurningLeaf[]): Spread[] {
  if (units.length === 0) return [];
  const opened = units.slice(1).map((unit, i): Spread => {
    const left = units[i].back;
    const right = unit.front;
    let label: string;
    if (left.page !== null && right.page !== null) label = `Pages ${left.page + 1}–${right.page + 1}`;
    else if (left.page === null && right.page === null) label = "Blank pages";
    else label = `${pageName(left)}, ${pageName(right)}`.replace(/^./, (c) => c.toUpperCase());
    return { left, right, label };
  });
  return [
    { left: null, right: units[0].front, label: `Cover, ${pageName(units[0].front)}` },
    ...opened,
    { left: units.at(-1)!.back, right: null, label: `Back cover, ${pageName(units.at(-1)!.back)}` },
  ];
}

/** A sheet side's texture, by sheet index and side. */
export const sideKey = (face: { sheet: number; side: "front" | "back" }) => `${face.sheet}-${face.side}`;

/**
 * The sheet sides whose textures spread `at` needs: both faces of the leaves it shows and of the ones next
 * to them, which show while a page turns.
 */
export function sidesNear(units: TurningLeaf[], at: number): Set<string> {
  const near = units.slice(Math.max(0, at - 2), at + 2);
  return new Set(near.flatMap((u) => [sideKey(u.front), sideKey(u.back)]));
}

/**
 * Texture coordinates (u right, v up, over the whole sheet side) for a face's picture at its corners as the
 * reader sees it, in the order top-left, top-right, bottom-left, bottom-right. The face shows its region
 * turned `rotation` clockwise, so a quarter turn brings the region's bottom-left corner to the top-left.
 */
export function faceUvs(face: BookFace, sheet: Size): [number, number][] {
  const { x, y, width, height } = face.region;
  // The region's corners clockwise from its top-left, in sheet points.
  const corners: [number, number][] = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
  const shift = face.rotation / 90;
  // Clockwise from the reader's top-left: top-left, top-right, bottom-right, bottom-left.
  const seen = [0, 1, 2, 3].map((i) => corners[(i - shift + 4) % 4]);
  const uv = ([px, py]: [number, number]): [number, number] => [px / sheet.width, 1 - py / sheet.height];
  return [seen[0], seen[1], seen[3], seen[2]].map(uv);
}
