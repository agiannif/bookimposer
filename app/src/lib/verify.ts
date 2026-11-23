// Compares a page face as the preview paints it with the same face as the exported PDF renders it. Pure:
// callers pass RGBA pixels, so the comparison runs in tests without a canvas.

/** RGBA pixels, row by row, like ImageData. */
export interface Pixels {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/** Cells per side of the grid a face is reduced to. */
export const GRID = 32;

/**
 * A face counts as different when any one grid cell's average brightness differs by more than this
 * fraction of full scale. Averaging 32x32 cells absorbs anti-aliasing and the small edge shifts between the
 * two renderers (a pixel or two, under a tenth of a cell at face size); a moved, turned or missing block of content changes
 * whole cells by far more.
 */
export const FACE_THRESHOLD = 0.15;

/** `image` reduced to GRID x GRID cells of average brightness, 0 (black) to 255 (white). */
export function grayGrid(image: Pixels, grid = GRID): number[] {
  const { width, height, data } = image;
  const cells: number[] = [];
  for (let row = 0; row < grid; row++) {
    const y0 = Math.floor((row * height) / grid);
    const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * height) / grid));
    for (let col = 0; col < grid; col++) {
      const x0 = Math.floor((col * width) / grid);
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * width) / grid));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < Math.min(y1, height); y++) {
        for (let x = x0; x < Math.min(x1, width); x++) {
          const i = 4 * (y * width + x);
          sum += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
          count++;
        }
      }
      cells.push(count === 0 ? 255 : sum / count);
    }
  }
  return cells;
}

/** The largest difference between corresponding cells of the two images' grids, as a fraction of full scale. */
export function faceDifference(a: Pixels, b: Pixels): number {
  const ga = grayGrid(a);
  const gb = grayGrid(b);
  return Math.max(...ga.map((v, i) => Math.abs(v - gb[i]!))) / 255;
}

export const facesMatch = (a: Pixels, b: Pixels) => faceDifference(a, b) <= FACE_THRESHOLD;
