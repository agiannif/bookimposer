import { defineConfig } from "@playwright/test";

// The export-failure project runs against a second dev server whose export endpoint always fails
// (BOOKIMPOSER_DEV_EXPORT_FAIL=1, read only by dev/exporter-middleware.ts). `make app-dev` never sets it.
// The csp project runs against the production build, served by vite preview with the app's CSP.
export default defineConfig({
  testDir: "e2e",
  // WebGL (the 3D book) on SwiftShader: Chromium's default headless GL logs "GPU stall due to ReadPixels"
  // console warnings, which every spec counts as errors.
  use: { launchOptions: { args: ["--use-angle=swiftshader"] } },
  projects: [
    { name: "app", testIgnore: ["export-failure.spec.ts", "csp.spec.ts"], use: { baseURL: "http://127.0.0.1:5173" } },
    { name: "export-failure", testMatch: "export-failure.spec.ts", use: { baseURL: "http://127.0.0.1:5174" } },
    { name: "csp", testMatch: "csp.spec.ts", use: { baseURL: "http://127.0.0.1:5175" } },
  ],
  webServer: [
    { command: "npm run dev", url: "http://127.0.0.1:5173", reuseExistingServer: true },
    {
      command: "npx vite --host 127.0.0.1 --port 5174 --strictPort",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
      env: { BOOKIMPOSER_DEV_EXPORT_FAIL: "1" },
    },
    {
      command: "npm run build && npx vite preview --host 127.0.0.1 --port 5175 --strictPort",
      url: "http://127.0.0.1:5175",
      reuseExistingServer: false,
    },
  ],
});
