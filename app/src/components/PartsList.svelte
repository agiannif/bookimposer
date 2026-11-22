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
      <li class={["row", row.board ? "board" : "body", { included }]}>
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
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-left: var(--space-2);
    border-left: 4px solid var(--line);
    border-radius: var(--radius);
  }
  .row input {
    margin: 0;
  }
  .row.body {
    border-left-color: var(--accent);
    /* lines the body's name up with the boards' names, which sit after a checkbox */
    padding-left: calc(var(--space-2) + 13px + var(--space-2));
  }
  .row.board.included {
    border-left-color: var(--board);
  }
  .part {
    flex: 1;
    text-align: left;
    padding: var(--space-2) var(--space-3);
  }
  span.part {
    color: var(--muted);
  }
  button.part[aria-pressed="true"] {
    background: var(--accent-soft);
    font-weight: 600;
  }
</style>
