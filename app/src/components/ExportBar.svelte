<script lang="ts">
  import type { PdfBackend } from "../lib/backend.ts";
  import type { BookWorkspace } from "../lib/workspace.svelte.ts";

  let { ws, backend }: { ws: BookWorkspace; backend: PdfBackend } = $props();

  let busy = $state(false);
  let warnings: string[] = $state([]);
  let error: string | null = $state(null);

  // Sends the original PDF bytes and the layout as it is at click time; settings changed during the
  // export do not affect it.
  async function exportPdf() {
    const pdf = ws.pdf!;
    const layout = $state.snapshot(ws.layout!);
    const marks = { cut: ws.settings.cutMarks, fold: ws.settings.foldMarks };
    busy = true;
    warnings = [];
    error = null;
    try {
      const result = await backend.exportPdf(pdf.bytes, layout, marks);
      await backend.savePdf(result.pdf, `${pdf.name.replace(/\.pdf$/i, "")}-imposed.pdf`);
      warnings = result.warnings;
    } catch (e) {
      error = `Export failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      busy = false;
    }
  }
</script>

<!-- Sits in the header; its result shows as a dismissible notice just below the button. -->
<div class="bar">
  {#if busy}<span class="hint" role="status" data-testid="export-busy">Exporting…</span>{/if}
  <button type="button" class="primary" disabled={ws.hasErrors || busy} onclick={exportPdf} data-testid="export-pdf">Export PDF</button>

  {#if error || warnings.length}
    <div class="notice" class:failed={error} role={error ? "alert" : "status"}>
      {#if error}
        <p data-testid="export-error">{error}</p>
      {:else}
        <ul>
          {#each warnings as warning}<li data-testid="export-warning">{warning}</li>{/each}
        </ul>
      {/if}
      <button type="button" aria-label="Dismiss export messages" onclick={() => ((error = null), (warnings = []))} data-testid="dismiss-export">×</button>
    </div>
  {/if}
</div>

<style>
  .bar {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .notice {
    position: absolute;
    top: calc(100% + var(--space-2));
    right: 0;
    z-index: 1;
    width: max-content;
    max-width: 480px;
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.12);
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--warning-soft);
    color: var(--warning);
    border-radius: var(--radius);
  }
  .notice.failed {
    background: var(--error-soft);
    color: var(--error);
  }
  ul, p {
    list-style: none;
    padding: 0;
    margin: 0;
  }
</style>
