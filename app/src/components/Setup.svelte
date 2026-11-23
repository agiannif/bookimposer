<script lang="ts">
  import type { BookWorkspace } from "../lib/workspace.svelte.ts";
  import FoldsField from "./FoldsField.svelte";
  import NumberField from "./NumberField.svelte";
  import PrintSettings from "./PrintSettings.svelte";

  let { ws, onstart }: { ws: BookWorkspace; onstart: () => void } = $props();
  const pageCount = $derived(ws.pdf?.pageSizes.length ?? 0);

  // The suggested signature count depends on folds and boards, so it follows them until the
  // person types their own count.
  let signaturesTyped = $state(false);
  function resuggest() {
    if (!signaturesTyped) ws.suggestSignatures();
  }
  function typeSignatures(n: number) {
    ws.settings.signatures = n;
    signaturesTyped = true;
  }
</script>

<main class="setup">
  <header>
    <h1>Set up your book</h1>
    <p class="hint">{ws.pdf?.name} · {pageCount} pages. You can change all of this later.</p>
  </header>

  <div class="columns">
    <section class="panel" aria-labelledby="paper-heading">
      <h2 id="paper-heading">Paper</h2>
      <PrintSettings {ws} />
    </section>

    <section class="panel" aria-labelledby="book-heading">
      <h2 id="book-heading">Book</h2>
      <FoldsField bind:value={ws.settings.folds} onchange={resuggest} />
      <label class="check"><input type="checkbox" bind:checked={ws.settings.frontBoard} onchange={resuggest} data-testid="front-board" /> Front board</label>
      <label class="check"><input type="checkbox" bind:checked={ws.settings.backBoard} onchange={resuggest} data-testid="back-board" /> Back board</label>
      <NumberField label="Signatures" bind:value={() => ws.settings.signatures, typeSignatures} testid="signatures" />
    </section>
  </div>

  <div class="actions">
    <button type="button" class="primary" onclick={onstart} data-testid="start">Start</button>
  </div>
</main>

<style>
  .setup {
    max-width: 720px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  /* One white sheet with the two groups side by side, a hairline between them. */
  .columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .columns .panel + .panel {
    border-top: 0;
    border-left: 1px solid var(--line);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
  .actions button {
    padding-inline: var(--space-5);
  }
</style>
