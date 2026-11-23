import { test } from "node:test";
import assert from "node:assert/strict";
import { MeshBasicMaterial, type Mesh } from "three";
import { impose } from "../../engine/src/index.ts";
import { assemble } from "../../assembler/assemble.ts";
import { DEFAULT_SETTINGS, toBookSpec } from "../src/lib/book.ts";
import { turningLeaves } from "../src/lib/book-model.ts";
import { BookModel } from "../src/lib/book-scene.ts";
import { SideTextures, type MakeCanvas } from "../src/lib/side-textures.ts";

// A stand-in canvas: the paint below never draws, and three.js only keeps the canvas as the texture's image.
const makeCanvas: MakeCanvas = (width, height) => ({ width, height, getContext: () => ({}) }) as unknown as HTMLCanvasElement;

const layout = impose(toBookSpec(Array.from({ length: 76 }, () => ({ width: 288, height: 378 })), {
  ...DEFAULT_SETTINGS, frontBoard: true, backBoard: true, signatures: 10,
}));
const units = turningLeaves(assemble(layout));

test("a dropped side's texture is disposed and the book stops using it before the next render", async () => {
  let changes = 0;
  const book = new BookModel(units, layout.sheet);
  const textures = new SideTextures({ width: 4, height: 4 }, async () => {}, () => {
    changes++;
    book.setTextures((face) => textures.get(face));
  }, (error) => assert.fail(String(error)), 1, makeCanvas);
  const cover = units[0].front;
  textures.want([cover]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const texture = textures.get(cover);
  assert.ok(texture);
  const material = ((book.group.children[0]!.children[0] as Mesh).material as MeshBasicMaterial[])[4]!;
  assert.equal(material.map, texture);
  let disposed = false;
  texture.addEventListener("dispose", () => (disposed = true));

  const other = units.find((u) => u.front.sheet !== cover.sheet)!.front;
  const before = changes;
  textures.want([other]);
  assert.equal(changes, before + 1, "dropping a side is a change");
  assert.equal(disposed, true);
  assert.equal(textures.get(cover), null);
  assert.equal(material.map, null);
  textures.dispose();
  book.dispose();
});
