<script lang="ts">
  // A live number input: every valid keystroke updates `value`; an empty or unparsable entry
  // mid-typing keeps the last valid value. Nothing is clamped, the engine reports bad values.
  let { label, value = $bindable(), testid, unit = "" }: { label: string; value: number; testid: string; unit?: string } = $props();

  function oninput(e: Event & { currentTarget: HTMLInputElement }) {
    const n = e.currentTarget.valueAsNumber;
    if (Number.isFinite(n)) value = n;
  }
</script>

<label class="field">
  <span>{label}</span>
  <span class="input">
    <input type="number" {value} {oninput} data-testid={testid} />
    {#if unit}<span class="unit">{unit}</span>{/if}
  </span>
</label>

<style>
  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .input {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  input {
    width: 5.5em;
    text-align: right;
  }
  .unit {
    color: var(--muted);
    font-size: 12px;
    width: 1.5em;
  }
</style>
