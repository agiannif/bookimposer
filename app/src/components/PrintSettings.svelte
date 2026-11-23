<script lang="ts">
  import { SHEET_SIZES, type SheetName } from "../../../engine/src/index.ts";
  import type { BookWorkspace } from "../lib/workspace.svelte.ts";
  import { presetLabel, UNITS, type Unit } from "../lib/units.ts";
  import NumberField from "./NumberField.svelte";

  /** `full` adds what the setup screen leaves out: the page size mismatch policy and marks. */
  let { ws, full = false }: { ws: BookWorkspace; full?: boolean } = $props();
  const print = $derived(ws.settings.print);

  const sheetChoice = $derived(typeof print.sheet === "string" ? print.sheet : "custom");

  function chooseSheet(e: Event & { currentTarget: HTMLSelectElement }) {
    const choice = e.currentTarget.value;
    if (Object.hasOwn(SHEET_SIZES, choice)) print.sheet = choice as SheetName;
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

<label class="stack">
  <span>Units</span>
  <select value={ws.unit} onchange={(e) => ws.chooseUnit(e.currentTarget.value as Unit)} data-testid="unit">
    {#each UNITS as u (u)}
      <option value={u}>{u}</option>
    {/each}
  </select>
</label>
<label class="stack">
  <span>Sheet size</span>
  <select value={sheetChoice} onchange={chooseSheet} data-testid="sheet-size">
    {#each Object.keys(SHEET_SIZES) as name (name)}
      <option value={name}>{presetLabel(name as SheetName, ws.unit)}</option>
    {/each}
    <option value="custom">Custom</option>
  </select>
</label>
{#if sheetChoice === "custom"}
  <NumberField label="Width" bind:value={width.get, width.set} unit={ws.unit} testid="sheet-width" />
  <NumberField label="Height" bind:value={height.get, height.set} unit={ws.unit} testid="sheet-height" />
{/if}

<div class="stack">
  <label class="stack">
    <span>Duplex</span>
    <select bind:value={print.duplex} data-testid="duplex">
      <option value="long-edge">Long edge</option>
      <option value="short-edge">Short edge</option>
    </select>
  </label>
  <p class="hint">Long edge is the usual setting for portrait paper</p>
</div>

<NumberField label="Margin" bind:value={print.margin} unit={ws.unit} testid="margin" />
<NumberField label="Gap" bind:value={print.gap} unit={ws.unit} testid="gap" />
<NumberField label="Bleed" bind:value={print.bleed} unit={ws.unit} testid="bleed" />

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
  /* Choices stack their label above a full-width select; numbers sit inline (NumberField). */
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  select {
    width: 100%;
  }
</style>
