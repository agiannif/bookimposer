// A failed export. Runs in the "export-failure" project, whose dev server (see playwright.config.ts)
// has BOOKCOMPOSER_DEV_EXPORT_FAIL=1 so the export endpoint always answers 422.
import { test, expect } from "@playwright/test";
import { FIRST_BUILD_MS, openWithBoards } from "./open-book.ts";

test.describe.configure({ timeout: FIRST_BUILD_MS + 60_000 });

test("a failed export shows the exporter's message and the workspace stays usable", async ({ page }) => {
  const errors = await openWithBoards(page);
  await page.getByTestId("export-pdf").click();
  await expect(page.getByTestId("export-error")).toContainText("forced failure");
  await expect(page.getByTestId("export-pdf")).toBeEnabled();
  await page.getByTestId("margin").fill("20");
  await expect(page.getByTestId("margin")).toHaveValue("20");
  await expect(page.getByTestId("allocation-segment")).toContainText(["1–2", "3–74", "75–76"]);
  await page.getByTestId("dismiss-export").click();
  await expect(page.getByTestId("export-error")).toHaveCount(0);
  // The failed request is the only console message the browser logs for it.
  expect(errors.filter((e) => !e.includes("422"))).toEqual([]);
});
