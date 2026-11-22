import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveObjectURL } from "node:buffer";
import { BitmapUrls } from "../src/lib/thumbnail-urls.ts";

const bitmap = (name: string) => ({ name }) as unknown as ImageBitmap;

/** Encodes each bitmap as a blob of its name, counting the calls. */
function setup(maxUrls?: number) {
  const encoded: string[] = [];
  const encode = async (b: ImageBitmap) => {
    const { name } = b as unknown as { name: string };
    encoded.push(name);
    return new Blob([name], { type: "image/png" });
  };
  return { encoded, urls: new BitmapUrls(encode, maxUrls) };
}

const live = (url: string) => resolveObjectURL(url) !== undefined;

test("a bitmap becomes a blob URL of its encoding", async () => {
  const { urls } = setup();
  const url = await urls.url(bitmap("A"));
  assert.match(url, /^blob:/);
  assert.equal(await resolveObjectURL(url)!.text(), "A");
});

test("the same bitmap reuses its URL without encoding again", async () => {
  const { encoded, urls } = setup();
  const a = bitmap("A");
  const [first, second] = await Promise.all([urls.url(a), urls.url(a)]);
  assert.equal(first, second);
  assert.equal(await urls.url(a), first);
  assert.deepEqual(encoded, ["A"]);
});

test("URLs beyond maxUrls are revoked, least recently used first", async () => {
  const { encoded, urls } = setup(2);
  const a = bitmap("A");
  const urlA = await urls.url(a);
  const urlB = await urls.url(bitmap("B"));
  await urls.url(a);
  await urls.url(bitmap("C"));
  assert.equal(live(urlA), true, "A was used more recently than B");
  assert.equal(live(urlB), false);
  assert.deepEqual(encoded, ["A", "B", "C"]);
});

test("a failed encoding rejects and is tried again next time", async () => {
  let fail = true;
  const urls = new BitmapUrls(async () => {
    if (fail) throw new Error("no canvas");
    return new Blob(["ok"]);
  });
  const a = bitmap("A");
  await assert.rejects(urls.url(a), /no canvas/);
  fail = false;
  assert.match(await urls.url(a), /^blob:/);
});

test("clear revokes every URL and encodes again after", async () => {
  const { encoded, urls } = setup();
  const a = bitmap("A");
  const url = await urls.url(a);
  urls.clear();
  await Promise.resolve();
  assert.equal(live(url), false);
  assert.notEqual(await urls.url(a), url);
  assert.deepEqual(encoded, ["A", "A"]);
});

test("keepAtLeast raises the cap so every URL on screen stays live", async () => {
  const { urls } = setup(2);
  urls.keepAtLeast(3);
  const all = [await urls.url(bitmap("A")), await urls.url(bitmap("B")), await urls.url(bitmap("C"))];
  assert.deepEqual(all.map(live), [true, true, true]);
  await urls.url(bitmap("D"));
  await Promise.resolve();
  assert.equal(live(all[0]!), false, "the cap is 3 now, so A goes");
});

test("keepAtLeast never lowers the cap below maxUrls", async () => {
  const { urls } = setup(2);
  urls.keepAtLeast(1);
  const a = await urls.url(bitmap("A"));
  await urls.url(bitmap("B"));
  await Promise.resolve();
  assert.equal(live(a), true);
});
