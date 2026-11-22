<script lang="ts">
  import type { FoldCount } from "../../../engine/src/index.ts";

  let { value = $bindable(), onchange }: { value: FoldCount; onchange?: () => void } = $props();
  const choices: FoldCount[] = [1, 2, 3];
</script>

<div class="field">
  <span id="folds-label">Folds per piece</span>
  <div class="segmented" role="group" aria-labelledby="folds-label">
    {#each choices as folds (folds)}
      <button
        type="button"
        aria-pressed={value === folds}
        data-testid="folds-{folds}"
        onclick={() => {
          value = folds;
          onchange?.();
        }}>{folds}</button>
    {/each}
  </div>
</div>

<style>
  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .segmented {
    display: flex;
  }
  .segmented button {
    border-radius: 0;
    padding: var(--space-1) var(--space-3);
    margin-left: -1px;
  }
  .segmented button:first-child {
    border-radius: var(--radius) 0 0 var(--radius);
  }
  .segmented button:last-child {
    border-radius: 0 var(--radius) var(--radius) 0;
  }
  .segmented button[aria-pressed="true"] {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    position: relative;
  }
</style>
