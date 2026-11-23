// The 3D book: one thin box per turning leaf, hinged at the spine (x = 0), the recto facing +z with the
// book closed. Each face shows its region of a sheet side texture (book-model.ts faceUvs).
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, type Texture } from "three";
import type { BookFace } from "../../../assembler/assemble.ts";
import type { Size } from "../../../engine/src/index.ts";
import { faceUvs, type TurningLeaf } from "./book-model.ts";

/** A leaf of paper and a board, as a share of the page height. */
const PAPER = 0.004;
const BOARD = 0.02;
/** How high a turning leaf lifts at its steepest, so it clears the leaves under it. */
const LIFT = 0.01;

// BoxGeometry builds its faces in the order +x, -x, +y, -y, +z, -z, four vertices each, and lays every face's
// vertices out as top-left, top-right, bottom-left, bottom-right seen from outside the box.
const FRONT_VERTICES = 16;
const BACK_VERTICES = 20;

const PAPER_EDGE = 0xf1ede4;
const BOARD_EDGE = 0x5a4636;

/** The leaf's box: `size` in scene units, its two faces' corners on their regions of `sheet` (in points). */
export function leafGeometry(unit: TurningLeaf, size: Size, thickness: number, sheet: Size): BoxGeometry {
  const geometry = new BoxGeometry(size.width, size.height, thickness);
  const uv = geometry.getAttribute("uv");
  for (const [start, face] of [[FRONT_VERTICES, unit.front], [BACK_VERTICES, unit.back]] as const) {
    faceUvs(face, sheet).forEach(([u, v], i) => uv.setXY(start + i, u, v));
  }
  uv.needsUpdate = true;
  return geometry;
}

const thicknessOf = (unit: TurningLeaf) => unit.leaves.reduce((sum, leaf) => sum + (leaf.kind === "board" ? BOARD : PAPER), 0);

interface Built {
  unit: TurningLeaf;
  hinge: Group;
  front: MeshBasicMaterial;
  back: MeshBasicMaterial;
  /** z of its centre lying on the right (unturned) and on the left (turned). */
  right: number;
  left: number;
}

/**
 * The book's scene graph. `place(position)` lays it out for a spread position: at a whole number n the book
 * is open at spread n; in between, leaf n is turning. The closed book is centred, the open book centred on
 * its spine.
 */
export class BookModel {
  readonly group = new Group();
  readonly width: number;
  #built: Built[];
  #edges: MeshLambertMaterial[];

  constructor(units: TurningLeaf[], sheet: Size) {
    const page = units[0]?.leaves[0]?.size ?? { width: 1, height: 1 };
    const size = { width: page.width / page.height, height: 1 };
    this.width = size.width;
    const thick = units.map(thicknessOf);
    const total = thick.reduce((a, b) => a + b, 0);
    const paperEdge = new MeshLambertMaterial({ color: PAPER_EDGE });
    const boardEdge = new MeshLambertMaterial({ color: BOARD_EDGE });
    this.#edges = [paperEdge, boardEdge];
    let below = 0;
    this.#built = units.map((unit, k) => {
      const front = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      const back = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      const edge = unit.cover ? boardEdge : paperEdge;
      const mesh = new Mesh(leafGeometry(unit, size, thick[k], sheet), [edge, edge, edge, edge, front, back]);
      mesh.position.x = size.width / 2;
      const hinge = new Group();
      hinge.add(mesh);
      this.group.add(hinge);
      const left = below + thick[k] / 2 - total / 2;
      below += thick[k];
      const right = total - below + thick[k] / 2 - total / 2;
      return { unit, hinge, front, back, right, left };
    });
  }

  place(position: number): void {
    const n = this.#built.length;
    for (const [k, b] of this.#built.entries()) {
      const turned = Math.min(1, Math.max(0, position - k));
      b.hinge.rotation.y = -Math.PI * turned;
      b.hinge.position.z = b.right + (b.left - b.right) * turned + LIFT * Math.sin(Math.PI * turned);
    }
    const opening = Math.min(1, Math.max(0, position));
    const closing = Math.min(1, Math.max(0, position - (n - 1)));
    this.group.position.x = (-this.width / 2) * (1 - opening) + (this.width / 2) * closing;
  }

  /** Puts each face's sheet side texture on it, or plain paper where `textureFor` has none yet. */
  setTextures(textureFor: (face: BookFace) => Texture | null): void {
    for (const b of this.#built) {
      for (const [material, face] of [[b.front, b.unit.front], [b.back, b.unit.back]] as const) {
        const map = textureFor(face);
        if (material.map === map) continue;
        material.map = map;
        material.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    for (const b of this.#built) {
      for (const child of b.hinge.children) if (child instanceof Mesh) child.geometry.dispose();
      b.front.dispose();
      b.back.dispose();
    }
    for (const edge of this.#edges) edge.dispose();
  }
}
