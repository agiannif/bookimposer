// What the app needs from the outside world: PDF inspection and export, and saving or opening files.
// The browser dev build uses DevBackend (backend-dev.ts); the Tauri app uses TauriBackend (backend-tauri.ts).
import type { Layout, Size } from "../../../engine/src/index.ts";
import { DevBackend } from "./backend-dev.ts";
import { TauriBackend } from "./backend-tauri.ts";

/** A rectangle in PDF points, origin bottom-left, y up, as the Rust crate reports it. */
export interface PdfBox {
  left: number;
  bottom: number;
  width: number;
  height: number;
}

/** One page's boxes as stored in the PDF (before /Rotate), from the Rust crate's PageBoxes. */
export interface PageBoxes {
  /** The TrimBox, or the crop box when the page has none. */
  trim: PdfBox;
  /** The effective CropBox: what a viewer (and the thumbnail renderer) shows. */
  crop: PdfBox;
  media: PdfBox;
  bleed: PdfBox | null;
  /** The page's /Rotate, degrees clockwise: 0, 90, 180 or 270. */
  rotation: number;
}

export interface PdfBackend {
  pageSizes(pdf: ArrayBuffer): Promise<{ pageSizes: Size[]; boxes: PageBoxes[] }>;
  exportPdf(pdf: ArrayBuffer, layout: Layout, marks: { cut: boolean; fold: boolean }): Promise<{ pdf: ArrayBuffer; warnings: string[] }>;
  savePdf(bytes: ArrayBuffer, suggestedName: string): Promise<void>;
  saveProject(text: string, suggestedName: string): Promise<void>;
  /** The chosen project file's text, or null if the person cancels. */
  openProject(): Promise<string | null>;
}

export function pickBackend(): PdfBackend {
  if ("__TAURI_INTERNALS__" in window) return new TauriBackend();
  return new DevBackend();
}
