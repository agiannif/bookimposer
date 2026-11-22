<script lang="ts">
  import type { BookPart } from "../lib/book.ts";
  import type { BookWorkspace } from "../lib/workspace.svelte.ts";
  import type { DerivedNumbers } from "../lib/layout-view.ts";
  import FoldsField from "./FoldsField.svelte";
  import NumberField from "./NumberField.svelte";

  /** `fillerNote` says what to cut for the boards' fillers; null when there are no boards. */
  let { ws, part, derived, fillerNote }: { ws: BookWorkspace; part: BookPart; derived: DerivedNumbers; fillerNote: string | null } = $props();

  const rows: { label: string; key: keyof DerivedNumbers; testid: string }[] = [
    { label: "Pages per signature", key: "pagesPerSignature", testid: "derived-pages-per-signature" },
    { label: "Pieces per signature", key: "piecesPerSignature", testid: "derived-pieces-per-signature" },
    { label: "Pieces per sheet", key: "piecesPerSheet", testid: "derived-pieces-per-sheet" },
    { label: "Sheets", key: "sheets", testid: "derived-sheets" },
    { label: "Blank pages added", key: "blanksAdded", testid: "derived-blanks-added" },
  ];
</script>

<section class="panel" aria-labelledby="part-settings-heading">
  <h2 id="part-settings-heading">{part.name}</h2>
  {#if part.kind === "body"}
    <NumberField label="Signatures" bind:value={ws.settings.signatures} testid="signatures">
      {#snippet action()}
        <button type="button" class="suggest" onclick={() => ws.suggestSignatures()} data-testid="suggest-signatures">Suggest</button>
      {/snippet}
    </NumberField>
    <FoldsField bind:value={ws.settings.folds} />
    <dl>
      {#each rows as row (row.key)}
        <div>
          <dt>{row.label}</dt>
          <dd data-testid={row.testid}>{derived[row.key] ?? "–"}</dd>
        </div>
      {/each}
    </dl>
  {:else}
    <p class="hint">A board takes 2 pages of the PDF and has no settings of its own.</p>
    {#if fillerNote}<p data-testid="filler-note">{fillerNote}</p>{/if}
  {/if}
</section>

<style>
  .suggest {
    padding: var(--space-1) var(--space-2);
    font-size: 12px;
  }
  dl {
    margin: 0;
    padding-top: var(--space-3);
    border-top: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  dl div {
    display: flex;
    justify-content: space-between;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
</style>
