<script lang="ts">
  import type { AllocationSegment } from "../lib/layout-view.ts";

  let { segments }: { segments: AllocationSegment[] } = $props();
</script>

<div class="bar" aria-label="PDF pages per part">
  {#each segments as segment, i (i)}
    <div class={["segment", segment.kind === "body" ? "body" : "board"]} style:flex-grow={segment.pages} data-testid="allocation-segment">
      <span class="name">{segment.name}</span>
      <span class="ranges">{segment.ranges}</span>
      {#if segment.blanks > 0}<span class="blanks">+{segment.blanks} blank</span>{/if}
    </div>
  {/each}
</div>

<style>
  .bar {
    display: flex;
    gap: 2px;
    min-height: 44px;
  }
  .segment {
    flex-basis: 0;
    min-width: 88px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius);
    white-space: nowrap;
    overflow: hidden;
  }
  .segment.body {
    background: var(--accent-soft);
    border-bottom: 3px solid var(--accent);
  }
  .segment.board {
    background: var(--board-soft);
    border-bottom: 3px solid var(--board);
  }
  .name {
    font-size: 12px;
    color: var(--muted);
  }
  .ranges {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .blanks {
    font-size: 12px;
    color: var(--muted);
  }
</style>
