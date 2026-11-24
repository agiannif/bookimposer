// The production build (vite build, served by vite preview) under the Content-Security-Policy the Tauri app ships:
// app.security.csp in tauri.conf.json, which the preview server sends as a header on every response, the
// thumbnail worker's script included. The core flow works with no violation reported.
//
// A violation inside the worker can't be listened for from here, so the worker's part is checked by its effect:
// a thumbnail only arrives once the worker has fetched and compiled PDFium's wasm.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { FIRST_BUILD_MS, openWithBoards } from "./open-book.ts";

const CSP: string = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")).app.security.csp;

test.describe.configure({ timeout: FIRST_BUILD_MS + 60_000 });

test("the built app opens a book, renders thumbnails and the 3D book, and verifies the export under the app's CSP", async ({ page }) => {
  const index = await page.request.get("/");
  expect(index.headers()["content-security-policy"]).toBe(CSP);

  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as { __cspViolations?: string[] }).__cspViolations = seen;
    document.addEventListener("securitypolicyviolation", (e) => seen.push(`${e.effectiveDirective} blocked ${e.blockedURI}`));
  });
  const errors = await openWithBoards(page);

  await expect(page.locator("[data-testid=placement-image][data-pdf-page='2']")).toHaveAttribute("href", /^blob:/, { timeout: 10_000 });
  const book = page.getByTestId("preview-3d");
  await expect(book).toHaveAttribute("data-webgl", "true");
  await expect(book.locator("canvas")).toBeVisible();
  await expect(page.locator("[data-testid=spread-face][data-position=right]")).toHaveAttribute("data-painted", "true");

  await page.getByTestId("verify-export").click();
  await expect(page.getByTestId("verify-result")).toHaveText("Export verified: all 76 pages match the preview, in order.", { timeout: FIRST_BUILD_MS });

  expect(await page.evaluate(() => (window as { __cspViolations?: string[] }).__cspViolations)).toEqual([]);
  expect(errors).toEqual([]);
});
