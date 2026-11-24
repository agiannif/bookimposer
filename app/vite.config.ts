import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { readFileSync } from "node:fs";
import { createExporterHandler } from "./dev/exporter-middleware.ts";

// The CSP the Tauri app ships. vite preview sends it on every response, so the e2e csp project runs the
// production build under it.
const appCsp: string = JSON.parse(readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8")).app.security.csp;

type Middlewares = { middlewares: { use(handler: ReturnType<typeof createExporterHandler>): unknown } };

export default defineConfig(({ command }) => ({
  plugins: [
    svelte(),
    // The browser build has no native backend, so the dev and preview servers run the export CLI for it.
    ...(command === "serve"
      ? [{
          name: "bookimposer-dev-exporter",
          configureServer(server: Middlewares) {
            server.middlewares.use(createExporterHandler());
          },
          configurePreviewServer(server: Middlewares) {
            server.middlewares.use(createExporterHandler());
          },
        }]
      : []),
  ],
  // The app imports the engine sources and the assembler by relative path, so the dev server serves
  // those too, and nothing else outside the app.
  // Pre-bundled at startup: dependencies the optimizer would only find once the page loads them make it reload the page.
  optimizeDeps: { include: ["three", "@threlte/core", "@threlte/extras", "@embedpdf/pdfium"] },
  // The desktop app loads its bundle from disk, so large chunks cost nothing; three.js and PDFium are most of it.
  build: { chunkSizeWarningLimit: 2000 },
  server: { host: "127.0.0.1", port: 5173, strictPort: true, fs: { allow: [".", "../engine/src", "../assembler"] } },
  preview: { headers: { "Content-Security-Policy": appCsp } },
}));
