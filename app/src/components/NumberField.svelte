<script lang="ts">
  import type { Snippet } from "svelte";
  import { formatLength, parseLength, type Unit } from "../lib/units.ts";

  // A live number input: every valid keystroke updates `value`; an empty or unparsable entry
  // mid-typing keeps the last valid value. Nothing is clamped, the engine reports bad values.
  // With `unit`, `value` is a length in points shown and typed in that unit. While the field has focus it
  // shows what was typed, so a keystroke is never reformatted; otherwise it shows `value`.
  /** `action` is drawn after the input, e.g. a button that fills it in. */
  let { label, value = $bindable(), testid, unit, action }: { label: string; value: number; testid: string; unit?: Unit; action?: Snippet } = $props();

  // Typed text is in the unit it was typed in, so a unit change drops it even without a blur.
  let typed = $state<{ text: string; unit?: Unit } | null>(null);
  const shown = $derived(typed && typed.unit === unit ? typed.text : unit ? formatLength(value, unit) : value);

  function oninput(e: Event & { currentTarget: HTMLInputElement }) {
    const text = e.currentTarget.value;
    typed = { text, unit };
    const n = unit ? parseLength(text, unit) : e.currentTarget.valueAsNumber;
    if (n !== null && Number.isFinite(n)) value = n;
  }
</script>

<label class="field">
  <span class="label">{label}</span>
  <span class={["input", { "with-action": action }]}>
    <input type="number" step="any" value={shown} {oninput} onblur={() => (typed = null)} data-testid={testid} />
    {#if unit}<span class="unit">{unit}</span>{/if}
    {@render action?.()}
  </span>
</label>

<style>
  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  /* The label stays on one line beside the input. */
  .label {
    white-space: nowrap;
  }
  .input {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
  }
  input {
    width: 5.5em;
    text-align: right;
  }
  /* Leaves room for the action in a narrow panel. */
  .with-action input {
    width: 4em;
  }
  .unit {
    color: var(--muted);
    font-size: var(--text-sm);
    width: 1.75em;
  }
</style>
