// Web Worker that renders PDF pages with PDFium wasm. Every PDFium call in the
// app happens here; ThumbnailCache (thumbnails.ts) is its only client.

import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import wasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import type { ThumbnailReply, ThumbnailRequest } from "./thumbnails.ts";

// Render flags from PDFium's fpdfview.h.
const FPDF_ANNOT = 0x01;
const FPDF_REVERSE_BYTE_ORDER = 0x10; // RGBA instead of BGRA, as ImageData wants.
const OPAQUE_WHITE = 0xffffffff;

type Pdfium = WrappedPdfiumModule;

/** Milliseconds from the worker's start until PDFium is ready, reported with the first load. */
let startupMs = 0;

async function startPdfium(): Promise<Pdfium> {
  const began = performance.now();
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`Could not fetch PDFium (HTTP ${response.status})`);
  const pdfium = await init({ wasmBinary: await response.arrayBuffer() });
  pdfium.PDFiumExt_Init();
  startupMs = performance.now() - began;
  return pdfium;
}

/** The wasm heap. Read it fresh each time: it is replaced when memory grows. */
function heap(pdfium: Pdfium): Uint8Array {
  return (pdfium.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
}

/** The open document and the heap copy of its bytes, which PDFium reads until the document closes. */
let open: { document: number; bytes: number } | null = null;

function closeDocument(pdfium: Pdfium): void {
  if (!open) return;
  pdfium.FPDF_CloseDocument(open.document);
  pdfium.pdfium.wasmExports.free(open.bytes);
  open = null;
}

/** Fills in `timings.copyIn` and `timings.open`. */
function loadDocument(pdfium: Pdfium, pdf: ArrayBuffer, timings: Record<string, number>): void {
  closeDocument(pdfium);
  const copying = performance.now();
  const bytes = pdfium.pdfium.wasmExports.malloc(pdf.byteLength);
  heap(pdfium).set(new Uint8Array(pdf), bytes);
  const opening = performance.now();
  timings.copyIn = opening - copying;
  const document = pdfium.FPDF_LoadMemDocument(bytes, pdf.byteLength, "");
  timings.open = performance.now() - opening;
  if (!document) {
    const code = pdfium.FPDF_GetLastError();
    pdfium.pdfium.wasmExports.free(bytes);
    throw new Error(`PDFium could not open the PDF (error ${code})`);
  }
  open = { document, bytes };
}

/** Copies a `width`x`height` RGBA bitmap out of the heap, dropping any row padding. */
function copyPixels(pdfium: Pdfium, bitmap: number, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const stride = pdfium.FPDFBitmap_GetStride(bitmap);
  const buffer = pdfium.FPDFBitmap_GetBuffer(bitmap);
  const source = heap(pdfium);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = buffer + y * stride;
    pixels.set(source.subarray(row, row + width * 4), y * width * 4);
  }
  return pixels;
}

/** Renders 0-based `pageIndex` `width` pixels wide, as the page displays. */
async function renderPage(pdfium: Pdfium, pageIndex: number, width: number, timings: Record<string, number>): Promise<ImageBitmap> {
  if (!open) throw new Error("No PDF is loaded");
  const loading = performance.now();
  const page = pdfium.FPDF_LoadPage(open.document, pageIndex);
  timings.loadPage = performance.now() - loading;
  if (!page) throw new Error(`The PDF has no page ${pageIndex + 1}`);
  let height: number;
  let pixels: Uint8ClampedArray<ArrayBuffer>;
  try {
    // PDFium reports the size as displayed, with /Rotate applied.
    height = Math.max(1, Math.round((width * pdfium.FPDF_GetPageHeightF(page)) / pdfium.FPDF_GetPageWidthF(page)));
    const bitmap = pdfium.FPDFBitmap_Create(width, height, 1);
    if (!bitmap) throw new Error(`PDFium could not make a ${width}x${height} bitmap`);
    try {
      pdfium.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, OPAQUE_WHITE);
      const rendering = performance.now();
      // Rotation 0 means no turn beyond the page's own /Rotate, which PDFium applies.
      pdfium.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, FPDF_ANNOT | FPDF_REVERSE_BYTE_ORDER);
      const copying = performance.now();
      timings.render = copying - rendering;
      pixels = copyPixels(pdfium, bitmap, width, height);
      timings.copyPixels = performance.now() - copying;
    } finally {
      pdfium.FPDFBitmap_Destroy(bitmap);
    }
  } finally {
    pdfium.FPDF_ClosePage(page);
  }
  const making = performance.now();
  const image = await createImageBitmap(new ImageData(pixels, width, height));
  timings.imageBitmap = performance.now() - making;
  return image;
}

const pdfium = startPdfium();
// Every request awaits `pdfium` and answers with its error, so a failed start is reported there;
// this handler only stops it being an unhandled rejection before the first request arrives.
pdfium.catch(() => {});

async function handle(request: ThumbnailRequest): Promise<void> {
  try {
    // Stage times in ms, for the perf probe (the cache records them only when timing is on).
    const timings: Record<string, number> = {};
    if (request.type === "load") {
      const waiting = performance.now();
      const ready = await pdfium;
      timings.waitForPdfium = performance.now() - waiting;
      timings.pdfiumStartup = startupMs;
      loadDocument(ready, request.pdf, timings);
      self.postMessage({ id: request.id, timings } satisfies ThumbnailReply);
    } else {
      const bitmap = await renderPage(await pdfium, request.page, request.width, timings);
      self.postMessage({ id: request.id, bitmap, timings } satisfies ThumbnailReply, { transfer: [bitmap] });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({ id: request.id, error: message } satisfies ThumbnailReply);
  }
}

// Requests are handled strictly in order, so a load never overtakes a render posted before it.
let previous = Promise.resolve();
self.onmessage = (event: MessageEvent<ThumbnailRequest>) => {
  previous = previous.then(() => handle(event.data));
};
