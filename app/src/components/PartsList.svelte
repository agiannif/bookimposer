<script lang="ts">
  import { PART_NAMES, type PartKind } from "../lib/book.ts";
  import type { BookWorkspace } from "../lib/workspace.svelte.ts";

  let { ws, selected = $bindable() }: { ws: BookWorkspace; selected: PartKind } = $props();

  // Every possible part has a row; a board's checkbox adds it to or removes it from the book.
  const rows: { kind: PartKind; board?: "frontBoard" | "backBoard"; testid?: string }[] = [
    { kind: "front-board", board: "frontBoard", testid: "front-board" },
    { kind: "body" },
    { kind: "back-board", board: "backBoard", testid: "back-board" },
  ];
</script>

<section class="panel" aria-labelledby="parts-heading" data-testid="parts-list">
  <h2 id="parts-heading">Parts</h2>
  <ul>
    {#each rows as row (row.kind)}
      {@const included = !row.board || ws.settings[row.board]}
      <li class="row">
        {#if row.board}
          <input type="checkbox" bind:checked={ws.settings[row.board]} aria-label="Include {PART_NAMES[row.kind]}" data-testid={row.testid} />
        {/if}
        {#if included}
          <button type="button" class="part" aria-pressed={selected === row.kind} data-testid="part-item" onclick={() => (selected = row.kind)}>{PART_NAMES[row.kind]}</button>
        {:else}
          <span class="part">{PART_NAMES[row.kind]}</span>
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  /* Two columns, checkboxes and names, shared by every row so the names line up whether or not a
     row has a checkbox. */
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: var(--space-2);
    row-gap: var(--space-1);
    align-items: center;
  }
  .row {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    align-items: center;
  }
  .row input {
    margin: 0;
  }
  .part {
    grid-column: 2;
    text-align: left;
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-radius: var(--radius);
    background: none;
  }
  span.part {
    color: var(--muted);
  }
  button.part[aria-pressed="true"] {
    background: var(--hover);
    color: var(--accent);
    font-weight: 600;
  }
</style>
