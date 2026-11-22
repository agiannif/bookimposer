import { ThumbnailCache, startThumbnailWorker } from "../../src/lib/thumbnails.ts";

const params = new URLSearchParams(location.search);
const canvas = document.querySelector("canvas")!;
try {
  const response = await fetch(`../fixtures/${params.get("pdf")}`);
  if (!response.ok) throw new Error(`fixture: HTTP ${response.status}`);
  const cache = new ThumbnailCache(startThumbnailWorker());
  await cache.load(await response.arrayBuffer());
  const bitmap = await cache.get(Number(params.get("page")), Number(params.get("width")));
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  canvas.dataset.ready = "true";
} catch (error) {
  document.body.dataset.error = String(error);
}
