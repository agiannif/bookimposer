// Exporting the imposed PDF from the workspace.
//
// data-testids used here:
//   export-pdf      the export button (downloads <pdf-name>-imposed.pdf)
//   export-busy     shown while an export runs
//   export-warning  one exporter warning after a successful export
//   export-error    the exporter's message after a failed export
//   dismiss-export  hides the export warnings or error
//   margin          workspace margin input
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { FIRST_BUILD_MS, fixture, openSetup, openWithBoards } from "./open-book.ts";

test.describe.configure({ timeout: FIRST_BUILD_MS + 60_000 });

async function exportPdf(page: Page) {
  const download = page.waitForEvent("download", { timeout: FIRST_BUILD_MS });
  await page.getByTestId("export-pdf").click();
  return download;
}

test("exporting the worked example downloads a 20 page PDF of letter sheets", async ({ page }) => {
  const errors = await openWithBoards(page);
  const download = await exportPdf(page);
  expect(download.suggestedFilename()).toBe("book-76-imposed.pdf");
  const res = await page.request.post("/__dev/page-sizes", { data: readFileSync((await download.path())!) });
  expect(res.ok()).toBe(true);
  const { pageSizes } = await res.json();
  expect(pageSizes).toHaveLength(20);
  for (const size of pageSizes) expect(size).toEqual({ width: 612, height: 792 });
  await expect(page.getByTestId("export-busy")).toHaveCount(0);
  await expect(page.getByTestId("export-warning")).toHaveCount(0);
  await expect(page.getByTestId("export-error")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a book with an annotation exports and lists the exporter's warning, which can be dismissed", async ({ page }) => {
  const errors = await openSetup(page, fixture("annotated-8.pdf"));
  await page.getByTestId("start").click();
  await exportPdf(page);
  await expect(page.getByTestId("export-warning")).toHaveText(/page 4 has 1 annotation\(s\) or form field\(s\) that are not included in the output/);
  await page.getByTestId("dismiss-export").click();
  await expect(page.getByTestId("export-warning")).toHaveCount(0);
  expect(errors).toEqual([]);
});
