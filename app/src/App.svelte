<script lang="ts">
  import { pickBackend } from "./lib/backend.ts";
  import { parseProject, pdfWarnings, type ProjectFile } from "./lib/project.ts";
  import { BookWorkspace } from "./lib/workspace.svelte.ts";
  import Setup from "./components/Setup.svelte";
  import Start from "./components/Start.svelte";
  import Workspace from "./components/Workspace.svelte";

  const backend = pickBackend();
  const ws = new BookWorkspace();
  let screen: "start" | "setup" | "workspace" = $state("start");
  let busy = $state(false);
  let error: string | null = $state(null);
  let project: ProjectFile | null = $state(null);
  let projectError: string | null = $state(null);

  async function openPdf(file: File) {
    busy = true;
    error = null;
    try {
      if (project) {
        const saved = project;
        await ws.open(file, backend, saved.settings, (chosen) => pdfWarnings(saved.pdf, chosen));
        screen = "workspace";
      } else {
        await ws.open(file, backend);
        screen = "setup";
      }
    } catch (e) {
      error = `Could not open ${file.name}: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      busy = false;
    }
  }

  async function openProject() {
    projectError = null;
    error = null;
    try {
      const text = await backend.openProject();
      if (text === null) return;
      const result = parseProject(text);
      if (result.ok) project = result.project;
      else projectError = `Could not open the project: ${result.error}`;
    } catch (e) {
      projectError = `Could not open the project: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
</script>

{#if screen === "start"}
  <Start {busy} {error} {project} {projectError} onpdf={openPdf} onproject={openProject} oncancelproject={() => (project = null)} />
{:else if screen === "setup"}
  <Setup {ws} onstart={() => (screen = "workspace")} />
{:else}
  <Workspace {ws} {backend} />
{/if}
