<script lang="ts">
  import type { AppIssue, AppIssueCode } from "../lib/issues.ts";

  let { issues }: { issues: AppIssue[] } = $props();

  /** What the user can do about an issue, shown after its message, for codes the workspace has a fix for. */
  const hints: Partial<Record<AppIssueCode, string>> = {
    "too-many-signatures": "Use Suggest next to Signatures to pick a count that fits.",
  };
</script>

{#if issues.length > 0}
  <ul class="issues">
    {#each issues as issue, i (i)}
      {@const hint = hints[issue.code]}
      <li class={["notice", issue.severity]} role={issue.severity === "error" ? "alert" : "status"} data-testid="issue-{issue.severity}" data-code={issue.code}>{issue.message}{#if hint}{" "}{hint}{/if}</li>
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
</style>
