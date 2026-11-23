// Sheet side textures for the 3D preview, painted on demand and kept for the most recently wanted sides.
import { CanvasTexture, SRGBColorSpace } from "three";
import type { FaceSource } from "../../../assembler/assemble.ts";
import { sideKey } from "./book-model.ts";

type Side = Pick<FaceSource, "sheet" | "side">;

/** Paints one sheet side onto a canvas of the texture size. */
export type PaintSide = (ctx: CanvasRenderingContext2D, side: Side) => Promise<void>;

/** Makes the canvas a side is painted on; the default is a DOM canvas. */
export type MakeCanvas = (width: number, height: number) => HTMLCanvasElement;

const domCanvas: MakeCanvas = (width, height) => Object.assign(document.createElement("canvas"), { width, height });

/**
 * One set of textures for one source (a Layout, or an exported PDF): make a new set when the source changes.
 * `want` paints the sides not yet painted and keeps at most `max` textures, dropping (and disposing) the least
 * recently wanted. `onChange` runs when a texture is ready and, synchronously, when `want` drops one: the
 * caller must then take `get`'s answers again, so no material keeps a disposed texture (three.js would upload
 * it again on the next render). `onError` runs when a side could not be fully painted (what did render is kept).
 */
export class SideTextures {
  #size: { width: number; height: number };
  #paint: PaintSide;
  #onChange: () => void;
  #makeCanvas: MakeCanvas;
  #onError: (error: unknown) => void;
  #max: number;
  /** Map order is recency order: the first key is the least recently wanted. */
  #textures = new Map<string, { texture: CanvasTexture; painted: boolean }>();
  #disposed = false;

  constructor(
    size: { width: number; height: number }, paint: PaintSide, onChange: () => void, onError: (error: unknown) => void,
    max = 16, makeCanvas = domCanvas,
  ) {
    this.#size = size;
    this.#paint = paint;
    this.#onChange = onChange;
    this.#makeCanvas = makeCanvas;
    this.#onError = onError;
    this.#max = max;
  }

  want(sides: Side[]): void {
    for (const side of sides) {
      const key = sideKey(side);
      const entry = this.#textures.get(key);
      if (entry) {
        this.#textures.delete(key);
        this.#textures.set(key, entry);
        continue;
      }
      const canvas = this.#makeCanvas(this.#size.width, this.#size.height);
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      const created = { texture, painted: false };
      this.#textures.set(key, created);
      const done = () => {
        if (this.#disposed || this.#textures.get(key) !== created) return;
        created.painted = true;
        texture.needsUpdate = true;
        this.#onChange();
      };
      this.#paint(canvas.getContext("2d")!, side).then(done, (error) => {
        done();
        if (!this.#disposed) this.#onError(error);
      });
    }
    let dropped = false;
    for (const [key, entry] of this.#textures) {
      if (this.#textures.size <= this.#max) break;
      this.#textures.delete(key);
      entry.texture.dispose();
      dropped = true;
    }
    if (dropped) this.#onChange();
  }

  /** The side's texture once painted. */
  get(side: Side): CanvasTexture | null {
    const entry = this.#textures.get(sideKey(side));
    return entry?.painted ? entry.texture : null;
  }

  dispose(): void {
    this.#disposed = true;
    for (const { texture } of this.#textures.values()) texture.dispose();
    this.#textures.clear();
  }
}
