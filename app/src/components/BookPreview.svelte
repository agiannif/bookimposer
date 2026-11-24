<script lang="ts">
  // The 3D book, assembled from the printed sheets by the Layout's assembly steps (assembler/), never from
  // the PDF's page order: a page the engine misplaces shows up misplaced here. Its faces show the sheet
  // sides as the Layout prints them, or, after "Verify export", as the exported PDF renders them.
  import { onDestroy } from "svelte";
  import { Tween } from "svelte/motion";
  import { cubicOut } from "svelte/easing";
  import { Canvas } from "@threlte/core";
  import { NoToneMapping } from "three";
  import type { Layout } from "../../../engine/src/index.ts";
  import { assemble, type BookFace } from "../../../assembler/assemble.ts";
  import type { PageBoxes, PdfBackend } from "../lib/backend.ts";
  import { sidesNear, spreads, turningLeaves } from "../lib/book-model.ts";
  import { BookModel } from "../lib/book-scene.ts";
  import { exportedPage, paintExportedSide, paintLayoutSide, textureSize, TEXTURE_LONG_SIDE } from "../lib/sheet-textures.ts";
  import { SideTextures } from "../lib/side-textures.ts";
  import { timed } from "../lib/perf.ts";
  import { verifyExport, type PerturbExport, type Verdict } from "../lib/verify-export.ts";
  import { ThumbnailCache, previewFailure, startThumbnailWorker } from "../lib/thumbnails.ts";
  import BookScene from "./BookScene.svelte";

  let { layout: imposed, pdf, boxes, backend, wide = $bindable(false) }: {
    layout: Layout;
    pdf: ArrayBuffer;
    boxes: PageBoxes[];
    backend: PdfBackend;
    wide?: boolean;
  } = $props();

  // Test hook (dev builds only): e2e specs corrupt the Layout the 3D book is built from, to show that a
  // misplaced page shows up here.
  type CorruptHook = (layout: Layout) => void;
  const corrupt = import.meta.env.DEV ? (window as { __bookimposerCorruptLayout?: CorruptHook }).__bookimposerCorruptLayout : undefined;
  const layout = $derived.by(() => {
    if (!corrupt) return imposed;
    const copy = $state.snapshot(imposed) as Layout;
    corrupt(copy);
    return copy;
  });

  const book = $derived(assemble(layout));
  const units = $derived(turningLeaves(book));
  const all = $derived(spreads(units));

  let chosen = $state(0);
  const index = $derived(Math.min(chosen, Math.max(0, all.length - 1)));
  const spread = $derived(all[index]);
  const turn = new Tween(0, { duration: 450, easing: cubicOut });
  $effect(() => {
    turn.target = index;
  });
  function step(by: number) {
    chosen = Math.max(0, Math.min(all.length - 1, index + by));
  }
  function onkeydown(e: KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
    else return;
    // The sheet view's arrow keys listen on the window; a handled key is not theirs.
    e.preventDefault();
  }

  const pageWorker = startThumbnailWorker();
  const pages = new ThumbnailCache(pageWorker, undefined, TEXTURE_LONG_SIDE);
  let exportWorker: Worker | null = null;
  let exportedPdf: ThumbnailCache | null = null;
  let previewsUnavailable = $state(false);
  onDestroy(() => {
    pageWorker.terminate();
    exportWorker?.terminate();
  });
  $effect(() => {
    pages.load(pdf).catch(failed);
  });
  function failed(error: unknown) {
    if (previewFailure(error) === "unavailable") previewsUnavailable = true;
  }

  // The exported PDF the textures come from, while the settings are those it was exported with, and what
  // checking it against the preview found.
  let verified = $state.raw<{ layout: Layout; verdict: Verdict } | null>(null);
  const fromExport = $derived(verified !== null && verified.layout === imposed);
  const verdict = $derived(fromExport ? verified!.verdict : null);
  let phase: "exporting" | "checking" | null = $state(null);
  let verifyError: string | null = $state(null);

  // Test hook (dev builds only): e2e specs draw over an exported side to show the check catches it.
  const perturbExport = import.meta.env.DEV ? (window as { __bookimposerPerturbExport?: PerturbExport }).__bookimposerPerturbExport : undefined;

  async function verifyTheExport() {
    const at = imposed;
    const checked = layout;
    phase = "exporting";
    verifyError = null;
    try {
      const result = await timed("verify.export", () => backend.exportPdf(pdf, $state.snapshot(at), { cut: false, fold: false }));
      if (!exportedPdf) {
        exportWorker = startThumbnailWorker();
        exportedPdf = new ThumbnailCache(exportWorker, undefined, TEXTURE_LONG_SIDE);
      }
      await timed("verify.load-exported", () => exportedPdf!.load(result.pdf));
      phase = "checking";
      const found = await timed("verify.check", () => verifyExport($state.snapshot(checked) as Layout, assemble(checked), boxes, pages, exportedPdf!, perturbExport));
      verified = { layout: at, verdict: found };
    } catch (e) {
      if (previewFailure(e) !== "cancelled") verifyError = `Could not verify the export: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      phase = null;
    }
  }
  function showFirstDifference() {
    const page = verdict?.differing[0];
    const at = all.findIndex((s) => s.left?.page === page || s.right?.page === page);
    if (at >= 0) chosen = at;
  }

  let painted = $state(0);
  const size = $derived(textureSize(layout.sheet));
  const textures = $derived.by(() => {
    const source = layout;
    const cache = fromExport ? exportedPdf! : pages;
    const paint = fromExport
      ? (ctx: CanvasRenderingContext2D, s: { sheet: number; side: "front" | "back" }) => paintExportedSide(ctx, cache, exportedPage(s.sheet, s.side))
      : (ctx: CanvasRenderingContext2D, s: { sheet: number; side: "front" | "back" }) =>
          paintLayoutSide(ctx, source.sheets[s.sheet]![s.side], boxes, cache, size.scale);
    return new SideTextures(size, paint, () => painted++, failed);
  });
  $effect(() => {
    const current = textures;
    return () => current.dispose();
  });
  $effect(() => {
    const wanted = sidesNear(units, index);
    textures.want([...wanted].map((key) => {
      const [sheet, side] = key.split("-");
      return { sheet: Number(sheet), side: side as "front" | "back" };
    }));
  });
  const textureFor = (face: BookFace) => textures.get(face);

  const model = $derived(new BookModel(units, layout.sheet));
  $effect(() => {
    const current = model;
    return () => current.dispose();
  });

  const webgl = (() => {
    try {
      const probe = document.createElement("canvas");
      return Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
    } catch {
      return false;
    }
  })();

  let width = $state(0);
  let height = $state(0);
  // Read by the scene-state list so specs can see whether a face's picture has been painted.
  const isPainted = (face: BookFace) => (void painted, textures.get(face) !== null);
</script>

<!-- Focusable so ← and → turn the pages while the panel has focus; the buttons do the same for pointers. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<section
  class="book-preview"
  aria-label="3D preview"
  data-testid="preview-3d"
  data-spread={index}
  data-source={fromExport ? "export" : "layout"}
  data-webgl={webgl}
  tabindex="0"
  {onkeydown}
>
  <header>
    <h2>Book</h2>
    <button type="button" aria-pressed={wide} data-testid="preview-wide" onclick={() => (wide = !wide)}>{wide ? "Smaller" : "Larger"}</button>
  </header>

  <div class="stage" bind:clientWidth={width} bind:clientHeight={height}>
    {#if !webgl}
      <p class="hint" data-testid="no-webgl">The 3D book needs WebGL, which this browser does not offer.</p>
    {:else if units.length > 0 && width > 0 && height > 0}
      <Canvas toneMapping={NoToneMapping}>
        <BookScene {model} position={turn.current} {textureFor} {painted} aspect={width / height} />
      </Canvas>
    {/if}
  </div>

  <div class="turn" data-testid="spread-stepper">
    <button type="button" aria-label="Previous pages" data-testid="spread-prev" disabled={index === 0} onclick={() => step(-1)}>←</button>
    <span data-testid="spread-label">{spread?.label ?? "No book to show"}</span>
    <button type="button" aria-label="Next pages" data-testid="spread-next" disabled={index >= all.length - 1} onclick={() => step(1)}>→</button>
  </div>

  <div class="check">
    <button type="button" data-testid="verify-export" disabled={phase !== null || fromExport || units.length === 0} onclick={verifyTheExport}>
      Verify export
    </button>
    {#if phase}<span data-testid="verify-progress">{phase === "exporting" ? "Exporting…" : "Checking page faces…"}</span>{/if}
    {#if fromExport}<span class="badge" data-testid="from-export">Built from exported PDF</span>{/if}
  </div>
  {#if verdict}
    {#if verdict.differing.length === 0}
      <p data-testid="verify-result">Export verified: all {verdict.checked} pages match the preview, in order.</p>
    {:else}
      <p class="warning" data-testid="verify-result">
        Export differs on {verdict.differing.length} {verdict.differing.length === 1 ? "page" : "pages"}: {verdict.differing.map((p) => p + 1).join(", ")}
        <button type="button" data-testid="show-difference" onclick={showFirstDifference}>Show first difference</button>
      </p>
    {/if}
  {/if}
  {#if verifyError}<p class="error" role="alert" data-testid="check-error">{verifyError}</p>{/if}
  {#if book.errors.length > 0}
    <p class="warning" data-testid="assembly-problem">The sheets do not assemble cleanly: {book.errors[0]}{book.errors.length > 1 ? ` (and ${book.errors.length - 1} more)` : ""}</p>
  {/if}
  {#if previewsUnavailable}<p class="hint" data-testid="book-previews-unavailable">Page previews are unavailable</p>{/if}

  <!-- The scene's state for tests: where each face of the open spread was printed. -->
  <ul hidden data-testid="scene-state">
    {#each [["left", spread?.left], ["right", spread?.right]] as const as [position, face] (position)}
      {#if face}
        <li
          data-testid="spread-face"
          data-position={position}
          data-page={face.page ?? "blank"}
          data-sheet={face.sheet}
          data-side={face.side}
          data-region="{face.region.x} {face.region.y} {face.region.width} {face.region.height}"
          data-rotation={face.rotation}
          data-painted={isPainted(face)}
        ></li>
      {/if}
    {/each}
  </ul>
</section>

<style>
  .book-preview {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--surface);
    outline: none;
  }
  .book-preview:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  header button, .turn button {
    padding: var(--space-1) var(--space-3);
  }
  .stage {
    flex: 1;
    min-height: 0;
    position: relative;
    background: var(--canvas);
  }
  .turn, .check {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    white-space: nowrap;
  }
  .check {
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .badge {
    font-size: var(--text-sm);
    padding: 2px var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  p {
    margin: 0;
    font-size: var(--text-sm);
  }
  .error {
    color: var(--error);
  }
  .warning {
    color: var(--warning);
  }
</style>
