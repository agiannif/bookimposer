<script lang="ts">
  import type { FoldCount } from "../../../engine/src/index.ts";

  let { value = $bindable(), onchange }: { value: FoldCount; onchange?: () => void } = $props();
  const choices: { folds: FoldCount; label: string }[] = [
    { folds: 1, label: "Folio · 1 fold" },
    { folds: 2, label: "Quarto · 2 folds" },
    { folds: 3, label: "Octavo · 3 folds" },
  ];
</script>

<div class="field">
  <span id="folds-label">Fold style</span>
  <div class="segmented" role="group" aria-labelledby="folds-label" aria-describedby="folds-help">
    {#each choices as { folds, label } (folds)}
      <button
        type="button"
        aria-pressed={value === folds}
        data-testid="folds-{folds}"
        onclick={() => {
          value = folds;
          onchange?.();
        }}>{label}</button>
    {/each}
  </div>
</div>
<p class="hint" id="folds-help">
  How many times each cut piece is folded. Folio suits most zines. Quarto and octavo need the head or fore-edge trimmed open after sewing.
</p>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  /* Stacked, so each label stays on one line in a narrow column. */
  .segmented {
    display: flex;
    flex-direction: column;
  }
  .segmented button {
    text-align: left;
    border-radius: 0;
    margin-top: -1px;
  }
  .segmented button:first-child {
    margin-top: 0;
    border-radius: var(--radius) var(--radius) 0 0;
  }
  .segmented button:last-child {
    border-radius: 0 0 var(--radius) var(--radius);
  }
  /* Raised so its accent border shows on all four sides over its neighbours'. */
  .segmented button[aria-pressed="true"] {
    position: relative;
    z-index: 1;
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }
</style>
