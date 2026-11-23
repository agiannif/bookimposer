// Page thumbnails rendered by the PDFium worker (thumbnail-worker.ts), with an
// LRU cache in front of it.

/** Messages the cache posts to the worker. `page` is the 0-based PDF page. */
export type ThumbnailRequest =
  | { type: "load"; id: number; pdf: ArrayBuffer }
  | { type: "render"; id: number; page: number; width: number };

/** The worker's answer to the request with the same `id`. A load reply has no bitmap. */
export type ThumbnailReply = { id: number; bitmap?: ImageBitmap } | { id: number; error: string };

/** The part of a `Worker` the cache uses, so tests can stand in for it. */
export interface ThumbnailWorker {
  onmessage: ((event: MessageEvent<ThumbnailReply>) => void) | null;
  /** The worker failed to start or threw outside a request; it answers nothing after this. */
  onerror: ((event: ErrorEvent) => void) | null;
  /** A reply could not be deserialized, so its request will never be answered. */
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: ThumbnailRequest): void;
}

/** The cache's worker has failed; no thumbnail can be rendered until the cache is replaced. */
export class ThumbnailsUnavailable extends Error {
  constructor(reason: string) {
    super(`Page previews are unavailable: ${reason}`);
    this.name = "ThumbnailsUnavailable";
  }
}

/** Starts the PDFium render worker. */
export function startThumbnailWorker(): Worker {
  return new Worker(new URL("./thumbnail-worker.ts", import.meta.url), { type: "module" });
}

const BUCKET = 64;
/** The default width cap: enough for a page on screen. */
const MAX_WIDTH = 1024;

/** 256 MB of RGBA pixels, about 750 letter-size thumbnails at 256 px wide. */
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

/**
 * The render width for a requested width: rounded up to a multiple of 64, at most `maxWidth`.
 * A width that isn't a positive number is a caller bug (an unmeasured element, say), so it
 * throws instead of being clamped into a thumbnail nobody can see.
 */
function bucketed(widthPx: number, maxWidth: number): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) {
    throw new RangeError(`Thumbnail width must be a positive number, not ${widthPx}`);
  }
  return Math.min(maxWidth, Math.max(BUCKET, Math.ceil(widthPx / BUCKET) * BUCKET));
}

const bytesOf = (bitmap: ImageBitmap) => bitmap.width * bitmap.height * 4;

function keyOf(page: number, width: number): string {
  return `${page}@${width}`;
}

interface Waiter {
  resolve(bitmap: ImageBitmap): void;
  reject(error: unknown): void;
}

interface Job {
  page: number;
  width: number;
  waiters: Waiter[];
}

/**
 * How a failed thumbnail request should show: a cancel is routine and shows nothing, a single page
 * keeps its number placeholder, and `unavailable` (the cache is dead) earns the "previews are
 * unavailable" note.
 */
export function previewFailure(error: unknown): "cancelled" | "page" | "unavailable" {
  if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
  return error instanceof ThumbnailsUnavailable ? "unavailable" : "page";
}

function cancelled(): DOMException {
  return new DOMException("Thumbnail render cancelled", "AbortError");
}

/**
 * Renders PDF pages to `ImageBitmap`s through the worker and caches them by
 * page and width bucket (at most `maxWidth`, a multiple of 64), keeping the most recently used within `maxBytes` of
 * pixels (4 bytes each). The newest bitmap is always kept, even alone over budget.
 *
 * An evicted bitmap is closed, freeing its memory at once, unless its page was
 * among the visible pages last given to `cancelAllExcept`: a consumer may still
 * be drawing that one, so it is only dropped and left to the garbage collector.
 * Consumers must draw a bitmap when it resolves, not keep it to draw later.
 *
 * Renders go to the worker one at a time, so a cancelled request never
 * reaches it. For each page only the newest request counts: an older request
 * still in flight resolves with the newest render, so a rapid run of changes
 * never shows a stale thumbnail. Cancelled requests, and requests pending when
 * a new PDF loads, reject with an `AbortError` `DOMException`, as does a load
 * superseded by another before it settles.
 *
 * If the worker fails (`onerror` or `onmessageerror`) or a load fails, every
 * pending load and render rejects with `ThumbnailsUnavailable`, and so does
 * every later call.
 */
export class ThumbnailCache {
  #worker: ThumbnailWorker;
  #maxBytes: number;
  #maxWidth: number;
  /** Map order is recency order: the first key is the least recently used. */
  #bitmaps = new Map<string, { page: number; bitmap: ImageBitmap }>();
  #bytes = 0;
  /** The pages last passed to `cancelAllExcept`, whose bitmaps may be on screen. */
  #visible = new Set<number>();
  #dead: ThumbnailsUnavailable | null = null;
  #queue: Job[] = [];
  #inFlight: { id: number; job: Job } | null = null;
  /** The newest job for each page, queued or in flight. */
  #newest = new Map<number, Job>();
  #loads = new Map<number, { resolve(): void; reject(error: unknown): void }>();
  #nextId = 0;

  constructor(worker: ThumbnailWorker, maxBytes = DEFAULT_MAX_BYTES, maxWidth = MAX_WIDTH) {
    this.#worker = worker;
    this.#maxBytes = maxBytes;
    this.#maxWidth = maxWidth;
    worker.onmessage = (event) => this.#receive(event.data);
    worker.onerror = (event) => this.#fail(event.message || "the preview worker stopped");
    worker.onmessageerror = () => this.#fail("the preview worker sent an unreadable reply");
  }

  /** Opens `pdf` in the worker, replacing the previous PDF. `pdf` is copied, not transferred. */
  load(pdf: ArrayBuffer): Promise<void> {
    if (this.#dead) return Promise.reject(this.#dead);
    for (const load of this.#loads.values()) load.reject(cancelled());
    this.#loads.clear();
    for (const job of [...this.#queue, ...(this.#inFlight ? [this.#inFlight.job] : [])]) {
      this.#rejectAll(job, cancelled());
    }
    this.#queue = [];
    this.#inFlight = null;
    this.#newest.clear();
    this.#bitmaps.clear();
    this.#bytes = 0;
    const id = this.#nextId++;
    this.#worker.postMessage({ type: "load", id, pdf });
    return new Promise((resolve, reject) => {
      this.#loads.set(id, { resolve, reject });
    });
  }

  /** The 0-based `pdfPage` rendered at `widthPx` rounded up to a multiple of 64, at most the cache's `maxWidth`. */
  get(pdfPage: number, widthPx: number): Promise<ImageBitmap> {
    if (this.#dead) return Promise.reject(this.#dead);
    let width: number;
    try {
      width = bucketed(widthPx, this.#maxWidth);
    } catch (error) {
      return Promise.reject(error);
    }
    const key = keyOf(pdfPage, width);
    const entry = this.#bitmaps.get(key);
    if (entry) {
      const cached = entry.bitmap;
      this.#bitmaps.delete(key);
      this.#bitmaps.set(key, entry);
      // This is now the newest request for the page, so older ones get its bitmap too.
      const older = this.#newest.get(pdfPage);
      if (older) {
        this.#resolveAll(older, cached);
        this.#queue = this.#queue.filter((queued) => queued !== older);
      }
      return Promise.resolve(cached);
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      const newest = this.#newest.get(pdfPage);
      if (newest?.width === width) {
        newest.waiters.push(waiter);
        return;
      }
      const job: Job = { page: pdfPage, width, waiters: [waiter] };
      if (newest) {
        job.waiters.unshift(...newest.waiters);
        newest.waiters = [];
        this.#queue = this.#queue.filter((queued) => queued !== newest);
      }
      this.#newest.set(pdfPage, job);
      this.#queue.push(job);
      this.#next();
    });
  }

  /** Cancels every pending render for a page not in `pages`. */
  cancelAllExcept(pages: Set<number>): void {
    this.#visible = new Set(pages);
    const hidden = (job: Job) => !pages.has(job.page);
    for (const job of this.#queue.filter(hidden)) this.#rejectAll(job, cancelled());
    this.#queue = this.#queue.filter((job) => !hidden(job));
    // The worker can't stop a render it has started; its result is still cached.
    if (this.#inFlight && hidden(this.#inFlight.job)) this.#rejectAll(this.#inFlight.job, cancelled());
  }

  #receive(reply: ThumbnailReply): void {
    const load = this.#loads.get(reply.id);
    if (load) {
      this.#loads.delete(reply.id);
      // Without an open PDF nothing can render, so a failed load is as final as a dead worker.
      if ("error" in reply) {
        this.#fail(reply.error);
        load.reject(this.#dead);
      } else load.resolve();
      return;
    }
    if (this.#inFlight?.id !== reply.id) {
      // A render for a PDF that has since been replaced.
      if ("bitmap" in reply) reply.bitmap?.close();
      return;
    }
    const { job } = this.#inFlight;
    this.#inFlight = null;
    if ("error" in reply || !reply.bitmap) {
      this.#rejectAll(job, new Error("error" in reply ? reply.error : "The worker sent no image"));
    } else {
      this.#store(keyOf(job.page, job.width), job.page, reply.bitmap);
      this.#resolveAll(job, reply.bitmap);
    }
    this.#next();
  }

  #store(key: string, page: number, bitmap: ImageBitmap): void {
    this.#bitmaps.set(key, { page, bitmap });
    this.#bytes += bytesOf(bitmap);
    for (const [oldest, evicted] of this.#bitmaps) {
      if (this.#bytes <= this.#maxBytes || oldest === key) break;
      this.#bitmaps.delete(oldest);
      this.#bytes -= bytesOf(evicted.bitmap);
      if (!this.#visible.has(evicted.page)) evicted.bitmap.close();
    }
  }

  /** Rejects everything pending and every later call: the worker will answer nothing more. */
  #fail(reason: string): void {
    if (this.#dead) return;
    this.#dead = new ThumbnailsUnavailable(reason);
    for (const load of this.#loads.values()) load.reject(this.#dead);
    this.#loads.clear();
    for (const job of [...this.#queue, ...(this.#inFlight ? [this.#inFlight.job] : [])]) {
      this.#rejectAll(job, this.#dead);
    }
    this.#queue = [];
    this.#inFlight = null;
  }

  #resolveAll(job: Job, bitmap: ImageBitmap): void {
    for (const waiter of job.waiters) waiter.resolve(bitmap);
    job.waiters = [];
    if (this.#newest.get(job.page) === job) this.#newest.delete(job.page);
  }

  #rejectAll(job: Job, error: unknown): void {
    for (const waiter of job.waiters) waiter.reject(error);
    job.waiters = [];
    if (this.#newest.get(job.page) === job) this.#newest.delete(job.page);
  }

  #next(): void {
    if (this.#inFlight) return;
    const job = this.#queue.shift();
    if (!job) return;
    const id = this.#nextId++;
    this.#inFlight = { id, job };
    this.#worker.postMessage({ type: "render", id, page: job.page, width: job.width });
  }
}
