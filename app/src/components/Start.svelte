<script lang="ts">
  import type { ProjectFile } from "../lib/project.ts";

  let { busy, error, project, projectError, onpdf, onproject, oncancelproject }: {
    busy: boolean;
    error: string | null;
    /** A project that was just opened and is waiting for its PDF. */
    project: ProjectFile | null;
    projectError: string | null;
    onpdf: (file: File) => void;
    onproject: () => void;
    oncancelproject: () => void;
  } = $props();

  function onchange(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    if (file) onpdf(file);
    e.currentTarget.value = "";
  }
</script>

<main class="start">
  <h1>bookcomposer</h1>
  <p class="hint">Turn a PDF into printable sheets for a zine or book.</p>
  {#if project}
    <div class="actions">
      <label class={["open", "button", "primary", { busy }]}>
        {busy ? "Reading PDF…" : `Choose ${project.pdf.name} to continue`}
        <input type="file" accept=".pdf,application/pdf" disabled={busy} {onchange} data-testid="choose-pdf" />
      </label>
      <button type="button" disabled={busy} onclick={oncancelproject} data-testid="cancel-project">Cancel</button>
    </div>
  {:else}
    <div class="actions">
      <label class={["open", "button", "primary", { busy }]}>
        {busy ? "Reading PDF…" : "Open PDF"}
        <input type="file" accept=".pdf,application/pdf" disabled={busy} {onchange} data-testid="open-pdf" />
      </label>
      <button type="button" onclick={onproject} data-testid="open-project">Open project</button>
    </div>
  {/if}
  {#if projectError}<p class="error" role="alert" data-testid="project-error">{projectError}</p>{/if}
  {#if error}<p class="error" role="alert" data-testid="open-error">{error}</p>{/if}
</main>

<style>
  .start {
    max-width: 480px;
    margin: 18vh auto 0;
    padding: 0 var(--space-4);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    text-align: center;
  }
  .start > .hint {
    font-size: var(--text-md);
  }
  .actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }
  .open {
    position: relative;
  }
  .open.busy {
    opacity: 0.7;
    cursor: progress;
  }
  .open:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  /* The real input stays in the page (for keyboard use and tests) but is invisible over the label. */
  input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: inherit;
  }
  .error {
    color: var(--error);
  }
</style>
