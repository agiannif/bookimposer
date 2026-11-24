<script lang="ts">
  import { bookParts, type PartKind } from "../lib/book.ts";
  import { allocationSegments, derivedNumbers } from "../lib/layout-view.ts";
  import type { PdfBackend } from "../lib/backend.ts";
  import { serializeProject } from "../lib/project.ts";
  import { sha256Hex } from "../lib/hash.ts";
  import type { BookWorkspace } from "../lib/workspace.svelte.ts";
  import AllocationBar from "./AllocationBar.svelte";
  import BookPreview from "./BookPreview.svelte";
  import ExportBar from "./ExportBar.svelte";
  import IssueBanner from "./IssueBanner.svelte";
  import PartSettings from "./PartSettings.svelte";
  import PartsList from "./PartsList.svelte";
  import PrintSettings from "./PrintSettings.svelte";
  import SheetView from "./SheetView.svelte";

  let { ws, backend }: { ws: BookWorkspace; backend: PdfBackend } = $props();

  const parts = $derived(bookParts(ws.settings));
  const layout = $derived(ws.layout!);
  // An error layout has no allocations, so the bar is hidden rather than shown empty.
  const segments = $derived(allocationSegments(layout, parts));
  let selected: PartKind = $state("body");
  // A removed board can't stay selected; fall back to the body, which always exists.
  const part = $derived(parts.find((p) => p.kind === selected) ?? parts.find((p) => p.kind === "body")!);

  /** The 3D book takes as much width as the sheets when larger. */
  let wideBook = $state(false);

  let saveError: string | null = $state(null);
  async function saveProject() {
    const pdf = ws.pdf!;
    saveError = null;
    try {
      const text = serializeProject({
        version: 1,
        unit: ws.unit,
        pdf: { name: pdf.name, pageCount: pdf.pageSizes.length, sha256: await sha256Hex(pdf.bytes) },
        settings: $state.snapshot(ws.settings),
      });
      await backend.saveProject(text, `${pdf.name.replace(/\.pdf$/i, "")}.bookimposer.json`);
    } catch (e) {
      saveError = `Could not save the project: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
</script>

<div class="workspace">
  <header class="top">
    <div class="title">
      <h1>bookimposer</h1>
      <span class="hint">{ws.pdf?.name} · {ws.pdf?.pageSizes.length} pages</span>
    </div>
    <div class="buttons">
      <button type="button" onclick={saveProject} data-testid="save-project">Save project</button>
      <ExportBar {ws} {backend} />
    </div>
  </header>

  <div class="status">
    {#if saveError}<p class="error" role="alert" data-testid="save-error">{saveError}</p>{/if}
    {#if ws.warnings.length}
      <div class="notice warning" role="status">
        <ul>
          {#each ws.warnings as warning}<li data-testid="project-warning">{warning}</li>{/each}
        </ul>
        <button type="button" aria-label="Dismiss warnings" onclick={() => (ws.warnings = [])} data-testid="dismiss-warnings">×</button>
      </div>
    {/if}

    {#if segments.length > 0}<AllocationBar {segments} />{/if}
    <IssueBanner issues={ws.issues} />
  </div>

  <div class="columns" class:wide-book={wideBook}>
    <aside class="left">
      <PartsList {ws} bind:selected />
      <section class="panel" aria-labelledby="print-heading">
        <h2 id="print-heading">Print</h2>
        <PrintSettings {ws} full />
      </section>
    </aside>
    <div class="middle">
      <PartSettings {ws} {part} derived={derivedNumbers(layout)} />
    </div>
    <section class="sheets" aria-label="Sheets" data-testid="sheet-area">
      <SheetView {layout} pdf={ws.pdf!.bytes} boxes={ws.pdf!.boxes} marks={{ cut: ws.settings.cutMarks, fold: ws.settings.foldMarks }} />
    </section>
    <div class="preview">
      <BookPreview layout={layout} pdf={ws.pdf!.bytes} boxes={ws.pdf!.boxes} {backend} bind:wide={wideBook} />
    </div>
  </div>
</div>

<style>
  /* Fills the window exactly, so the sheets can size to the height left; the side columns scroll.
     The minimums match the Tauri window's; narrower browser windows scroll instead.
     The chrome is white and ruled off by hairlines; only the sheets sit on the grey canvas. */
  .workspace {
    height: 100vh;
    min-width: 1100px;
    min-height: 700px;
    display: flex;
    flex-direction: column;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    background: var(--surface);
  }
  .title {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
  }
  .top h1 {
    font-size: var(--text-md);
  }
  .buttons {
    display: flex;
    gap: var(--space-2);
  }
  .status {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 var(--space-4) var(--space-3);
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }
  .status > p {
    margin: 0;
  }
  .error {
    color: var(--error);
  }
  .columns {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 240px 260px minmax(0, 1fr) 320px;
  }
  .columns.wide-book {
    grid-template-columns: 240px 260px minmax(0, 1fr) minmax(0, 1fr);
  }
  .left, .middle {
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-right: 1px solid var(--line);
  }
  .sheets {
    min-height: 0;
    padding: var(--space-4);
  }
  .preview {
    min-height: 0;
    border-left: 1px solid var(--line);
  }
</style>
