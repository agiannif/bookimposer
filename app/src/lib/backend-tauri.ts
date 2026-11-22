// Tauri backend: PDF work goes to the app's native commands (app/src-tauri/src/commands.rs), files
// go through the native open and save dialogs. The fs plugin may only touch the files picked there.
//
// PDF bytes cross the IPC bridge raw, never as JSON number arrays:
//   page_sizes  body: the raw PDF -> { pageSizes, boxes } as JSON
//   export_pdf  (framing in ipc-frame.ts)
//               body: 4-byte big-endian length N, N bytes of UTF-8 JSON
//                     { layout: <Layout JSON as a string>, cutMarks, foldMarks }, then the raw PDF
//               answer: 4-byte big-endian length M, M bytes of the warnings as a UTF-8 JSON array of
//                       strings, then the sheets PDF
// Errors reject with the exporter's message string.
//
// The class needs the Tauri runtime, so it has no unit tests; app/test/ipc-frame.test.ts and the Rust
// tests in commands.rs check the framing against shared golden fixtures, and the e2e suite covers the
// app through DevBackend.
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeFile } from "@tauri-apps/plugin-fs";
import type { Layout, Size } from "../../../engine/src/index.ts";
import type { PageBoxes, PdfBackend } from "./backend.ts";
import { frame, unframe } from "./ipc-frame.ts";

// The invoke wrappers turn Tauri's string rejections into Errors, as DevBackend throws.
async function command<T>(name: string, body: Uint8Array): Promise<T> {
  try {
    return await invoke<T>(name, body);
  } catch (e) {
    throw new Error(String(e));
  }
}

async function saveFile(bytes: Uint8Array, suggestedName: string, filter: { name: string; extensions: string[] }): Promise<void> {
  const path = await save({ defaultPath: suggestedName, filters: [filter] });
  if (path !== null) await writeFile(path, bytes);
}

export class TauriBackend implements PdfBackend {
  pageSizes(pdf: ArrayBuffer): Promise<{ pageSizes: Size[]; boxes: PageBoxes[] }> {
    return command("page_sizes", new Uint8Array(pdf));
  }

  async exportPdf(pdf: ArrayBuffer, layout: Layout, marks: { cut: boolean; fold: boolean }): Promise<{ pdf: ArrayBuffer; warnings: string[] }> {
    const header = { layout: JSON.stringify(layout), cutMarks: marks.cut, foldMarks: marks.fold };
    const answer = await command<ArrayBuffer>("export_pdf", frame(header, new Uint8Array(pdf)));
    const { json, rest } = unframe(answer);
    return { pdf: rest, warnings: json as string[] };
  }

  savePdf(bytes: ArrayBuffer, suggestedName: string): Promise<void> {
    return saveFile(new Uint8Array(bytes), suggestedName, { name: "PDF", extensions: ["pdf"] });
  }

  saveProject(text: string, suggestedName: string): Promise<void> {
    return saveFile(new TextEncoder().encode(text), suggestedName, { name: "Project", extensions: ["json"] });
  }

  async openProject(): Promise<string | null> {
    const path = await open({ multiple: false, directory: false, filters: [{ name: "Project", extensions: ["json"] }] });
    return path === null ? null : readTextFile(path);
  }
}
