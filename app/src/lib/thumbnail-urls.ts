// Blob URLs for thumbnails, since an SVG <image> draws from a URL, not an ImageBitmap.

/**
 * Draws `bitmap` onto a canvas at once (so closing it later is harmless) and encodes it as PNG,
 * which keeps the preview's colours exact.
 */
export function encodePng(bitmap: ImageBitmap): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

/**
 * URLs kept beyond the ones on screen: when the sheet changes, requests from the previous sheet can
 * still be finishing, and the margin keeps them from revoking the new sheet's URLs.
 */
export const KEEP_MARGIN = 16;

/**
 * One blob URL per bitmap, keeping the `maxUrls` most recently used and revoking the rest.
 * A big sheet can show more pages than that, so the view raises the cap with `keepAtLeast`.
 */
export class BitmapUrls {
  #encode: (bitmap: ImageBitmap) => Promise<Blob>;
  #maxUrls: number;
  #keep = 0;
  /** Map order is recency order: the first key is the least recently used. */
  #urls = new Map<ImageBitmap, Promise<string>>();

  constructor(encode: (bitmap: ImageBitmap) => Promise<Blob> = encodePng, maxUrls = 64) {
    this.#encode = encode;
    this.#maxUrls = maxUrls;
  }

  url(bitmap: ImageBitmap): Promise<string> {
    let url = this.#urls.get(bitmap);
    if (url) {
      this.#urls.delete(bitmap);
    } else {
      url = this.#encode(bitmap).then((blob) => URL.createObjectURL(blob));
      // A failed encoding isn't kept, so the next request tries again.
      url.catch(() => this.#urls.get(bitmap) === url && this.#urls.delete(bitmap));
    }
    this.#urls.set(bitmap, url);
    for (const [oldest, evicted] of this.#urls) {
      if (this.#urls.size <= Math.max(this.#maxUrls, this.#keep)) break;
      this.#urls.delete(oldest);
      evicted.then((u) => URL.revokeObjectURL(u), () => {});
    }
    return url;
  }

  /**
   * Keeps at least the `count` + KEEP_MARGIN most recently used URLs alive. The view passes how many
   * pages are on screen before asking for their URLs, so none of them is revoked while it shows.
   */
  keepAtLeast(count: number): void {
    this.#keep = count + KEEP_MARGIN;
  }

  /** Revokes every URL, when the view that shows them goes away. */
  clear(): void {
    for (const url of this.#urls.values()) url.then((u) => URL.revokeObjectURL(u), () => {});
    this.#urls.clear();
  }
}
