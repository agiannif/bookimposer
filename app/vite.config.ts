import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createExporterHandler } from "./dev/exporter-middleware.ts";

export default defineConfig(({ command }) => ({
  plugins: [
    svelte(),
    // The browser build has no native backend, so the dev server runs the export CLI for it.
    ...(command === "serve"
      ? [{ name: "bookcomposer-dev-exporter", configureServer(server: { middlewares: { use(handler: ReturnType<typeof createExporterHandler>): unknown } }) {
          server.middlewares.use(createExporterHandler());
        },
      }]
      : []),
  ],
  // The app imports the engine sources by relative path, so the dev server must serve ../engine.
  server: { host: "127.0.0.1", port: 5173, strictPort: true, fs: { allow: [".."] } },
}));
