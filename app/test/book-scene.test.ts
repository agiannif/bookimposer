import { test } from "node:test";
import assert from "node:assert/strict";
import { Mesh, MeshBasicMaterial, Texture, Vector3 } from "three";
import { impose } from "../../engine/src/index.ts";
import { assemble } from "../../assembler/assemble.ts";
import { DEFAULT_SETTINGS, toBookSpec } from "../src/lib/book.ts";
import { faceUvs, turningLeaves } from "../src/lib/book-model.ts";
import { BookModel, leafGeometry } from "../src/lib/book-scene.ts";

const layout = impose(toBookSpec(Array.from({ length: 76 }, () => ({ width: 378, height: 288 })), {
  ...DEFAULT_SETTINGS, frontBoard: true, backBoard: true, signatures: 10,
}));
const units = turningLeaves(assemble(layout));
const round = (xs: number[]) => xs.map((x) => +x.toFixed(6));

test("a leaf's recto and verso carry their faces' regions at the corners the reader sees", () => {
  const geometry = leafGeometry(units[1], { width: 1.3, height: 1 }, 0.01, layout.sheet);
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const at = (i: number) => round([position.getX(i), position.getY(i), position.getZ(i)]);
  // The recto (+z) seen from the front: top-left is at the spine (-x), top.
  assert.deepEqual([16, 17, 18, 19].map(at), [[-0.65, 0.5, 0.005], [0.65, 0.5, 0.005], [-0.65, -0.5, 0.005], [0.65, -0.5, 0.005]]);
  // The verso (-z) seen once the leaf has turned: top-left is at the fore-edge (+x before turning), top.
  assert.deepEqual([20, 21, 22, 23].map(at), [[0.65, 0.5, -0.005], [-0.65, 0.5, -0.005], [0.65, -0.5, -0.005], [-0.65, -0.5, -0.005]]);
  const uvs = (from: number) => [0, 1, 2, 3].map((i) => round([uv.getX(from + i), uv.getY(from + i)]));
  assert.deepEqual(uvs(16), faceUvs(units[1].front, layout.sheet).map(round));
  assert.deepEqual(uvs(20), faceUvs(units[1].back, layout.sheet).map(round));
});

test("open at a spread, the turned leaves lie left of the spine and the rest right, the top ones uppermost", () => {
  const book = new BookModel(units, layout.sheet);
  book.place(1);
  const centre = (k: number) => book.group.children[k]!.children[0]!.getWorldPosition(new Vector3());
  book.group.updateMatrixWorld(true);
  assert.ok(centre(0).x < 0, "the cover turned to the left");
  assert.ok(centre(1).x > 0 && centre(2).x > 0, "the rest still on the right");
  assert.ok(centre(1).z > centre(2).z, "leaf 2 lies on leaf 3");
  assert.ok(Math.abs(centre(1).x + centre(0).x) < 1e-9, "the spread is centred on the spine");
  book.dispose();
});

test("faces take their sheet side's texture, or none until it is painted", () => {
  const book = new BookModel(units, layout.sheet);
  const texture = new Texture();
  book.setTextures((face) => (face.sheet === units[1].front.sheet && face.side === units[1].front.side ? texture : null));
  const [, , , , front] = (book.group.children[1]!.children[0] as Mesh).material as MeshBasicMaterial[];
  assert.equal(front.map, texture);
  book.dispose();
});
