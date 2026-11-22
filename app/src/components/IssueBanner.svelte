<script lang="ts">
  import type { Issue } from "../../../engine/src/index.ts";

  let { issues }: { issues: Issue[] } = $props();
</script>

{#if issues.length > 0}
  <ul class="issues">
    {#each issues as issue, i (i)}
      <li class={issue.severity} role={issue.severity === "error" ? "alert" : "status"} data-testid="issue-{issue.severity}" data-code={issue.code}>{issue.message}</li>
    {/each}
  </ul>
{/if}

<style>
  .issues {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  li {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius);
    border-left: 4px solid;
  }
  .error {
    background: var(--error-soft);
    border-color: var(--error);
    color: var(--error);
  }
  .warning {
    background: var(--warning-soft);
    border-color: var(--warning);
    color: var(--warning);
  }
</style>
