<script lang="ts">
  import type { AllocationSegment } from "../lib/layout-view.ts";

  let { segments }: { segments: AllocationSegment[] } = $props();
</script>

<div class="bar" role="group" aria-label="PDF pages per part">
  {#each segments as segment, i (i)}
    <div class={["segment", segment.kind === "body" ? "body" : "board"]} style:flex-grow={segment.pages} data-testid="allocation-segment">
      <span class="name">{segment.name}</span>
      {#if segment.leafBefore > 0}<span class="note" data-testid="leaf-note" data-position="before">+{segment.leafBefore} blank (cover leaf)</span>{/if}
      <span class="ranges">{segment.ranges}</span>
      {#if segment.blanks > 0}<span class="note">+{segment.blanks} blank</span>{/if}
      {#if segment.leafAfter > 0}<span class="note" data-testid="leaf-note" data-position="after">+{segment.leafAfter} blank (cover leaf)</span>{/if}
    </div>
  {/each}
</div>

<style>
  /* One ruled strip, each part's share as wide as its pages; boards are set off by the canvas grey. */
  .bar {
    display: flex;
    min-height: 44px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .segment {
    flex-basis: 0;
    min-width: 88px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: var(--space-1) var(--space-3);
    white-space: nowrap;
    overflow: hidden;
  }
  .segment + .segment {
    border-left: 1px solid var(--line);
  }
  .segment.board {
    background: var(--canvas);
  }
  .name, .note {
    font-size: var(--text-sm);
    color: var(--muted);
  }
  .ranges {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
</style>
