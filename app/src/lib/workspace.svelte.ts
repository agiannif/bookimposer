// The open book: the PDF, its settings, and the Layout imposed from them. `layout` is derived, so
// every settings change re-imposes synchronously and everything reading it updates in the same frame.
import type { Layout, Size } from "../../../engine/src/index.ts";
import { DEFAULT_SETTINGS, suggestSignatures, toBookSpec, type BookSettings } from "./book.ts";
import { sha256Hex } from "./hash.ts";
import { bleedWarnings, imposeSafely, type AppIssue } from "./issues.ts";
import type { PageBoxes, PdfBackend } from "./backend.ts";

export interface OpenPdf {
  name: string;
  bytes: ArrayBuffer;
  pageSizes: Size[];
  /** Each page's boxes, which place its preview so the trim lands where the Layout puts it. */
  boxes: PageBoxes[];
}

export class BookWorkspace {
  pdf = $state.raw<OpenPdf | null>(null);
  settings = $state<BookSettings>(structuredClone(DEFAULT_SETTINGS));
  #imposed = $derived(this.pdf ? imposeSafely(toBookSpec(this.pdf.pageSizes, $state.snapshot(this.settings))) : null);
  layout: Layout | null = $derived(this.#imposed?.layout ?? null);
  /** The engine's issues and the app's own; any error disables export. */
  issues: AppIssue[] = $derived(
    this.#imposed && this.pdf
      ? [...this.#imposed.issues, ...bleedWarnings(this.settings.print.bleed, this.#imposed.layout, this.pdf.boxes)]
      : [],
  );
  hasErrors = $derived(this.issues.some((i) => i.severity === "error"));

  /** Warnings about the PDF not matching the project it was opened with, shown until dismissed. */
  warnings = $state<string[]>([]);

  /**
   * Reads the PDF's page sizes and starts from `saved` settings, or from the defaults with suggested
   * signatures. Warnings are for the person opening a project.
   */
  async open(file: File, backend: PdfBackend, saved?: BookSettings, warnings: (pdf: { sha256: string; pageCount: number }) => string[] = () => []): Promise<void> {
    const bytes = await file.arrayBuffer();
    const { pageSizes, boxes } = await backend.pageSizes(bytes);
    let settings = saved;
    if (!settings) {
      settings = structuredClone(DEFAULT_SETTINGS);
      settings.signatures = suggestSignatures(pageSizes.length, settings);
    }
    this.warnings = warnings({ sha256: await sha256Hex(bytes), pageCount: pageSizes.length });
    this.settings = settings;
    this.pdf = { name: file.name, bytes, pageSizes, boxes };
  }

  /** Re-suggests the signature count for the current parts and folds. */
  suggestSignatures(): void {
    if (this.pdf) this.settings.signatures = suggestSignatures(this.pdf.pageSizes.length, this.settings);
  }
}
