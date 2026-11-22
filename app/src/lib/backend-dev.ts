// Browser backend: PDF work goes to the dev server's /__dev endpoints, files go through downloads
// and a hidden file input.
import type { Layout, Size } from "../../../engine/src/index.ts";
import type { PageBoxes, PdfBackend } from "./backend.ts";

async function checked(res: Response): Promise<Response> {
  if (res.ok) return res;
  let message = `${res.url} failed with status ${res.status}`;
  try {
    const body = await res.json();
    if (typeof body?.error === "string") message = body.error;
  } catch {
    // not JSON; keep the status message
  }
  throw new Error(message);
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export class DevBackend implements PdfBackend {
  async pageSizes(pdf: ArrayBuffer): Promise<{ pageSizes: Size[]; boxes: PageBoxes[] }> {
    const res = await checked(await fetch("/__dev/page-sizes", { method: "POST", body: pdf }));
    return res.json();
  }

  async exportPdf(pdf: ArrayBuffer, layout: Layout, marks: { cut: boolean; fold: boolean }): Promise<{ pdf: ArrayBuffer; warnings: string[] }> {
    const form = new FormData();
    form.set("pdf", new Blob([pdf], { type: "application/pdf" }), "book.pdf");
    form.set("layout", JSON.stringify(layout));
    form.set("cutMarks", String(marks.cut));
    form.set("foldMarks", String(marks.fold));
    const res = await checked(await fetch("/__dev/export", { method: "POST", body: form }));
    return { pdf: await res.arrayBuffer(), warnings: JSON.parse(res.headers.get("X-Export-Warnings") ?? "[]") };
  }

  async savePdf(bytes: ArrayBuffer, suggestedName: string): Promise<void> {
    download(new Blob([bytes], { type: "application/pdf" }), suggestedName);
  }

  async saveProject(text: string, suggestedName: string): Promise<void> {
    download(new Blob([text], { type: "application/json" }), suggestedName);
  }

  openProject(): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.onchange = async () => resolve((await input.files?.[0]?.text()) ?? null);
      input.oncancel = () => resolve(null);
      input.click();
    });
  }
}
