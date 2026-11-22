import { defineConfig } from "@playwright/test";

// The export-failure project runs against a second dev server whose export endpoint always fails
// (BOOKCOMPOSER_DEV_EXPORT_FAIL=1, read only by dev/exporter-middleware.ts). `make app-dev` never sets it.
export default defineConfig({
  testDir: "e2e",
  projects: [
    { name: "app", testIgnore: "export-failure.spec.ts", use: { baseURL: "http://127.0.0.1:5173" } },
    { name: "export-failure", testMatch: "export-failure.spec.ts", use: { baseURL: "http://127.0.0.1:5174" } },
  ],
  webServer: [
    { command: "npm run dev", url: "http://127.0.0.1:5173", reuseExistingServer: true },
    {
      command: "npx vite --host 127.0.0.1 --port 5174 --strictPort",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
      env: { BOOKCOMPOSER_DEV_EXPORT_FAIL: "1" },
    },
  ],
});
