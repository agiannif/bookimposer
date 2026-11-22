<script lang="ts">
  import { SHEET_SIZES } from "../../../engine/src/index.ts";
  import type { BookWorkspace } from "../lib/workspace.svelte.ts";
  import NumberField from "./NumberField.svelte";

  /** `full` adds what the setup screen leaves out: the page size mismatch policy and marks. */
  let { ws, full = false }: { ws: BookWorkspace; full?: boolean } = $props();
  const print = $derived(ws.settings.print);

  const sheetChoice = $derived(typeof print.sheet === "string" ? print.sheet : "custom");

  function chooseSheet(e: Event & { currentTarget: HTMLSelectElement }) {
    const choice = e.currentTarget.value;
    if (choice === "letter" || choice === "a4") print.sheet = choice;
    else if (typeof print.sheet === "string") print.sheet = { ...SHEET_SIZES[print.sheet] };
  }

  function customSide(side: "width" | "height") {
    return {
      get: () => (typeof print.sheet === "string" ? SHEET_SIZES[print.sheet][side] : print.sheet[side]),
      set: (n: number) => {
        if (typeof print.sheet !== "string") print.sheet[side] = n;
      },
    };
  }
  const width = customSide("width");
  const height = customSide("height");
</script>

<label class="field">
  <span>Sheet size</span>
  <select value={sheetChoice} onchange={chooseSheet} data-testid="sheet-size">
    <option value="letter">Letter</option>
    <option value="a4">A4</option>
    <option value="custom">Custom</option>
  </select>
</label>
{#if sheetChoice === "custom"}
  <NumberField label="Width" bind:value={width.get, width.set} unit="pt" testid="sheet-width" />
  <NumberField label="Height" bind:value={height.get, height.set} unit="pt" testid="sheet-height" />
{/if}

<div class="stack">
  <label class="field">
    <span>Duplex</span>
    <select bind:value={print.duplex} data-testid="duplex">
      <option value="long-edge">Long edge</option>
      <option value="short-edge">Short edge</option>
    </select>
  </label>
  <p class="hint">Long edge is the usual setting for portrait paper</p>
</div>

<NumberField label="Margin" bind:value={print.margin} unit="pt" testid="margin" />
<NumberField label="Gap" bind:value={print.gap} unit="pt" testid="gap" />
<NumberField label="Bleed" bind:value={print.bleed} unit="pt" testid="bleed" />

{#if full}
  <label class="stack">
    <span>Page size mismatch</span>
    <select bind:value={ws.settings.mismatch} data-testid="mismatch">
      <option value="fit">Scale to fit</option>
      <option value="center">Center, no scaling</option>
    </select>
  </label>
  <label class="check"><input type="checkbox" bind:checked={ws.settings.cutMarks} data-testid="cut-marks" /> Cut marks</label>
  <label class="check"><input type="checkbox" bind:checked={ws.settings.foldMarks} data-testid="fold-marks" /> Fold marks</label>
{/if}

<style>
  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  select {
    max-width: 100%;
  }
</style>
