import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ThumbnailCache,
  ThumbnailsUnavailable,
  previewFailure,
  type ThumbnailReply,
  type ThumbnailRequest,
  type ThumbnailWorker,
} from "../src/lib/thumbnails.ts";

/** Records what the cache posts and lets the test answer each request by hand. */
class FakeWorker implements ThumbnailWorker {
  onmessage: ((event: MessageEvent<ThumbnailReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  posted: ThumbnailRequest[] = [];

  postMessage(message: ThumbnailRequest): void {
    this.posted.push(message);
  }

  renders(): { page: number; width: number }[] {
    return this.posted.flatMap((m) => (m.type === "render" ? [{ page: m.page, width: m.width }] : []));
  }

  last(): ThumbnailRequest {
    const message = this.posted.at(-1);
    assert.ok(message, "nothing was posted");
    return message;
  }

  reply(reply: ThumbnailReply): void {
    this.onmessage?.({ data: reply } as MessageEvent<ThumbnailReply>);
  }

  /** Answers the most recent render request with a fake bitmap named `name`. */
  renderLast(name: string): ImageBitmap {
    const request = this.last();
    assert.equal(request.type, "render");
    const bitmap = fakeBitmap(name);
    this.reply({ id: request.id, bitmap });
    return bitmap;
  }
}

/** Stands in for an ImageBitmap; `closed` records whether the cache freed it. */
interface FakeBitmap {
  name: string;
  width: number;
  height: number;
  closed: boolean;
  close(): void;
}

/** A fake bitmap is 256x336, the size of a 288x378 page in the 256 bucket. */
const FAKE_BYTES = 256 * 336 * 4;

function fakeBitmap(name: string): ImageBitmap {
  const bitmap: FakeBitmap = { name, width: 256, height: 336, closed: false, close: () => (bitmap.closed = true) };
  return bitmap as unknown as ImageBitmap;
}

const isClosed = (bitmap: ImageBitmap) => (bitmap as unknown as FakeBitmap).closed;

function setup(maxBytes?: number): { worker: FakeWorker; cache: ThumbnailCache } {
  const worker = new FakeWorker();
  return { worker, cache: new ThumbnailCache(worker, maxBytes) };
}

async function rendered(cache: ThumbnailCache, worker: FakeWorker, page: number, name: string): Promise<ImageBitmap> {
  const bitmap = cache.get(page, 200);
  worker.renderLast(name);
  return bitmap;
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

test("load sends the PDF to the worker and resolves when it is open", async () => {
  const { worker, cache } = setup();
  const pdf = new ArrayBuffer(4);
  const loaded = cache.load(pdf);
  const request = worker.last();
  assert.equal(request.type, "load");
  assert.equal(request.type === "load" && request.pdf, pdf);
  worker.reply({ id: request.id });
  await loaded;
});

test("a failed load rejects with the worker's error and kills the cache", async () => {
  const { worker, cache } = setup();
  const loaded = cache.load(new ArrayBuffer(4));
  const page = cache.get(0, 200);
  worker.reply({ id: worker.posted[0]!.id, error: "Could not fetch PDFium (HTTP 404)" });
  const unavailable = (error: unknown) =>
    error instanceof ThumbnailsUnavailable && /Page previews are unavailable: Could not fetch PDFium \(HTTP 404\)/.test(error.message);
  await assert.rejects(loaded, unavailable);
  await assert.rejects(page, unavailable, "nothing can render without a PDF");
  await assert.rejects(cache.get(1, 200), unavailable);
});

test("previewFailure tells a cancel, a page that failed and previews that are gone apart", () => {
  assert.equal(previewFailure(new DOMException("cancelled", "AbortError")), "cancelled");
  assert.equal(previewFailure(new Error("The PDF has no page 10")), "page");
  assert.equal(previewFailure(new ThumbnailsUnavailable("worker crashed")), "unavailable");
});

test("widths round up to a multiple of 64, capped at 1024", () => {
  const { worker, cache } = setup();
  for (const [page, width] of [[0, 200], [1, 256], [2, 1], [3, 5000]]) {
    cache.get(page, width);
    worker.renderLast(`page ${page}`);
  }
  assert.deepEqual(worker.renders(), [
    { page: 0, width: 256 },
    { page: 1, width: 256 },
    { page: 2, width: 64 },
    { page: 3, width: 1024 },
  ]);
});

test("a cache made with a larger width cap renders up to it", () => {
  const worker = new FakeWorker();
  const cache = new ThumbnailCache(worker, undefined, 2048);
  cache.get(0, 1500);
  cache.get(1, 5000);
  assert.deepEqual(worker.renders(), [{ page: 0, width: 1536 }]);
  worker.renderLast("page 0");
  assert.deepEqual(worker.renders(), [{ page: 0, width: 1536 }, { page: 1, width: 2048 }]);
});

test("a cached page and width bucket is served without rendering again", async () => {
  const { worker, cache } = setup();
  const first = await rendered(cache, worker, 0, "A");
  assert.equal(await cache.get(0, 220), first);
  assert.equal(worker.renders().length, 1);
});

test("a different width bucket renders again", async () => {
  const { worker, cache } = setup();
  await rendered(cache, worker, 0, "A");
  cache.get(0, 300);
  assert.deepEqual(worker.renders().at(-1), { page: 0, width: 320 });
});

test("the LRU evicts the least recently used entries beyond the byte budget", async () => {
  const { worker, cache } = setup(2 * FAKE_BYTES);
  const a = await rendered(cache, worker, 0, "A");
  await rendered(cache, worker, 1, "B");
  assert.equal(await cache.get(0, 200), a, "page 0 is now the most recently used");
  await rendered(cache, worker, 2, "C");
  assert.equal(worker.renders().length, 3);

  assert.equal(await cache.get(0, 200), a, "page 0 was kept");
  assert.equal(worker.renders().length, 3);
  cache.get(1, 200);
  assert.equal(worker.renders().length, 4, "page 1 was evicted and renders again");
});

test("an evicted bitmap is closed unless its page is visible", async () => {
  const { worker, cache } = setup(FAKE_BYTES);
  cache.cancelAllExcept(new Set([0]));
  const visible = await rendered(cache, worker, 0, "visible");
  const hidden = await rendered(cache, worker, 1, "hidden");
  assert.equal(isClosed(visible), false, "page 0 is visible, so something may still be drawing it");
  await rendered(cache, worker, 2, "newest");
  assert.equal(isClosed(hidden), true, "page 1 isn't visible, so its memory is freed");
});

test("the newest bitmap is kept even when it alone is over the budget", async () => {
  const { worker, cache } = setup(FAKE_BYTES / 2);
  const bitmap = await rendered(cache, worker, 0, "big");
  assert.equal(isClosed(bitmap), false);
  assert.equal(await cache.get(0, 200), bitmap);
  assert.equal(worker.renders().length, 1);
});

test("the default budget is 256 MB", async () => {
  const { worker, cache } = setup();
  const fit = Math.floor((256 * 1024 * 1024) / FAKE_BYTES);
  const first = await rendered(cache, worker, 0, "first");
  for (let page = 1; page < fit; page++) await rendered(cache, worker, page, `page ${page}`);
  assert.equal(isClosed(first), false, "everything fits so far");
  await rendered(cache, worker, fit, "one too many");
  assert.equal(isClosed(first), true, "the least recently used is evicted");
});

test("requests for the same page and bucket in flight share one render", async () => {
  const { worker, cache } = setup();
  const first = cache.get(0, 200);
  const second = cache.get(0, 210);
  const bitmap = worker.renderLast("A");
  assert.equal(await first, bitmap);
  assert.equal(await second, bitmap);
  assert.equal(worker.renders().length, 1);
});

test("latest wins: two requests for the same page in flight both resolve with the newest render", async () => {
  const { worker, cache } = setup();
  const older = cache.get(0, 200);
  const newer = cache.get(0, 400);
  worker.renderLast("old");
  assert.deepEqual(worker.renders().at(-1), { page: 0, width: 448 });
  const newest = worker.renderLast("new");
  assert.equal(await older, newest);
  assert.equal(await newer, newest);
});

test("latest wins when the newest request is a cache hit", async () => {
  const { worker, cache } = setup();
  const wide = cache.get(0, 400);
  const cached = worker.renderLast("448 wide");
  await wide;
  cache.get(1, 200);
  const older = cache.get(0, 200);
  assert.equal(await cache.get(0, 400), cached);
  assert.equal(await older, cached);
  worker.renderLast("page 1");
  assert.deepEqual(
    worker.renders().map((r) => r.page),
    [0, 1],
    "the older request for page 0 never renders",
  );
});

test("renders go to the worker one at a time", () => {
  const { worker, cache } = setup();
  cache.get(0, 200);
  cache.get(1, 200);
  assert.equal(worker.renders().length, 1);
  worker.renderLast("A");
  assert.deepEqual(worker.renders(), [
    { page: 0, width: 256 },
    { page: 1, width: 256 },
  ]);
});

test("cancelAllExcept stops renders for pages that aren't visible", async () => {
  const { worker, cache } = setup();
  const page0 = cache.get(0, 200);
  const page1 = cache.get(1, 200);
  const page2 = cache.get(2, 200);
  const page3 = cache.get(3, 200);
  cache.cancelAllExcept(new Set([0, 2]));
  await assert.rejects(page1, isAbort);
  await assert.rejects(page3, isAbort);

  worker.renderLast("page 0");
  await page0;
  worker.renderLast("page 2");
  await page2;
  assert.deepEqual(
    worker.renders().map((r) => r.page),
    [0, 2],
  );
});

test("cancelAllExcept rejects an in-flight render that isn't visible", async () => {
  const { worker, cache } = setup();
  const page0 = cache.get(0, 200);
  cache.cancelAllExcept(new Set());
  await assert.rejects(page0, isAbort);
  worker.renderLast("page 0");
  cache.get(1, 200);
  assert.deepEqual(worker.renders().at(-1), { page: 1, width: 256 }, "the queue moves on");
});

test("a render error rejects with the worker's message", async () => {
  const { worker, cache } = setup();
  const page = cache.get(9, 200);
  worker.reply({ id: worker.last().id, error: "page 9 does not exist" });
  await assert.rejects(page, /page 9 does not exist/);
});

test("loading a new PDF cancels pending renders, ignores stale replies and empties the cache", async () => {
  const { worker, cache } = setup();
  await rendered(cache, worker, 0, "old A");
  const stale = cache.get(1, 200);
  const staleRequest = worker.last();
  cache.load(new ArrayBuffer(4));
  await assert.rejects(stale, isAbort);

  const fresh = cache.get(1, 200);
  const staleBitmap = fakeBitmap("old B");
  worker.reply({ id: staleRequest.id, bitmap: staleBitmap });
  assert.equal((staleBitmap as unknown as FakeBitmap).closed, true, "the stale render is freed");
  worker.reply({ id: worker.posted.find((m) => m.type === "load")!.id });
  const bitmap = worker.renderLast("new B");
  assert.equal(await fresh, bitmap);

  cache.get(0, 200);
  assert.deepEqual(worker.renders().at(-1), { page: 0, width: 256 }, "page 0 renders again");
});

test("a second load before the first settles rejects the first with AbortError", async () => {
  const { worker, cache } = setup();
  const first = cache.load(new ArrayBuffer(4));
  const firstRequest = worker.last();
  const second = cache.load(new ArrayBuffer(4));
  await assert.rejects(first, isAbort);
  worker.reply({ id: firstRequest.id });
  worker.reply({ id: worker.last().id });
  await second;
});

for (const width of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
  test(`a width of ${width} is rejected`, async () => {
    const { worker, cache } = setup();
    await assert.rejects(cache.get(0, width), (error: unknown) => {
      assert.ok(error instanceof RangeError);
      assert.match(error.message, new RegExp(`Thumbnail width must be a positive number, not ${width}`));
      return true;
    });
    assert.equal(worker.renders().length, 0);
  });
}

const isUnavailable = (error: unknown) =>
  error instanceof ThumbnailsUnavailable && /Page previews are unavailable: worker crashed/.test(error.message);

test("a worker error rejects the pending load and every render, and later calls reject at once", async () => {
  const { worker, cache } = setup();
  const loaded = cache.load(new ArrayBuffer(4));
  const inFlight = cache.get(0, 200);
  const queued = cache.get(1, 200);
  worker.onerror?.({ message: "worker crashed" } as ErrorEvent);
  await assert.rejects(loaded, isUnavailable);
  await assert.rejects(inFlight, isUnavailable);
  await assert.rejects(queued, isUnavailable);

  const posted = worker.posted.length;
  await assert.rejects(cache.get(2, 200), isUnavailable);
  await assert.rejects(cache.load(new ArrayBuffer(4)), isUnavailable);
  assert.equal(worker.posted.length, posted, "a dead cache posts nothing");
});

test("a message the worker can't deserialize also kills the cache", async () => {
  const { worker, cache } = setup();
  const page = cache.get(0, 200);
  worker.onmessageerror?.({} as MessageEvent);
  await assert.rejects(page, (error: unknown) => error instanceof ThumbnailsUnavailable);
});

test("a worker error with no message still says why", async () => {
  const { worker, cache } = setup();
  const page = cache.get(0, 200);
  worker.onerror?.({ message: "" } as ErrorEvent);
  await assert.rejects(page, /Page previews are unavailable: the preview worker stopped/);
});
