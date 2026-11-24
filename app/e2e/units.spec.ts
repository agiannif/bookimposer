// Length units: inches by default, millimetres and points on request, stored as points.
//
// data-testids used here:
//   unit                  the unit select in the print settings (in, mm, pt)
//   sheet-size, margin, bleed, sheet-width, sheet-height   length inputs and the preset select
//   issue-warning         the bleed warning, which names its value in the unit
//   save-project, open-project, choose-pdf   saving and reopening a project
import { test, expect } from "@playwright/test";
import { BOOK_76, FIRST_BUILD_MS, openSetup, openWithBoards } from "./open-book.ts";

test.describe.configure({ timeout: FIRST_BUILD_MS + 30_000 });

test("lengths and sheet presets are in inches by default, and convert when the unit changes", async ({ page }) => {
  const errors = await openSetup(page, BOOK_76, "in");
  await expect(page.getByTestId("unit")).toHaveValue("in");
  await expect(page.getByTestId("margin")).toHaveValue("0.25");
  const presets = page.getByTestId("sheet-size").locator("option");
  await expect(presets).toHaveText(["Letter (8.5 × 11 in)", "A4 (8.268 × 11.693 in)", "Tabloid (11 × 17 in)", "A3 (11.693 × 16.535 in)", "Custom"]);
  await page.getByTestId("unit").selectOption("mm");
  await expect(presets).toHaveText(["Letter (215.9 × 279.4 mm)", "A4 (210 × 297 mm)", "Tabloid (279.4 × 431.8 mm)", "A3 (297 × 420 mm)", "Custom"]);
  await expect(page.getByTestId("margin")).toHaveValue("6.4");
  await page.getByTestId("unit").selectOption("pt");
  await expect(page.getByTestId("margin")).toHaveValue("18");
  await expect(presets.first()).toHaveText("Letter (612 × 792 pt)");
  expect(errors).toEqual([]);
});

test("typing 0.5 in stores 36 pt, and the field is not reformatted while typing", async ({ page }) => {
  const errors = await openSetup(page, BOOK_76, "in");
  const margin = page.getByTestId("margin");
  await margin.fill("");
  await margin.pressSequentially("0.50");
  await expect(margin).toHaveValue("0.50");
  await margin.blur();
  await expect(margin).toHaveValue("0.5");
  await page.getByTestId("unit").selectOption("pt");
  await expect(margin).toHaveValue("36");
  expect(errors).toEqual([]);
});

test("a custom sheet takes its size in the selected unit", async ({ page }) => {
  const errors = await openSetup(page, BOOK_76, "mm");
  await page.getByTestId("sheet-size").selectOption("custom");
  await expect(page.getByTestId("sheet-width")).toHaveValue("215.9");
  await expect(page.getByTestId("sheet-height")).toHaveValue("279.4");
  await page.getByTestId("sheet-width").fill("300");
  await page.getByTestId("unit").selectOption("in");
  await expect(page.getByTestId("sheet-width")).toHaveValue("11.811");
  expect(errors).toEqual([]);
});

test("the bleed warning uses the unit", async ({ page }) => {
  const errors = await openWithBoards(page, BOOK_76, "in");
  await page.getByTestId("bleed").fill("0.125");
  await expect(page.locator("[data-testid=issue-warning][data-code=no-bleed-box]"))
    .toHaveText("Bleed is set to 0.125 in, but this PDF has no bleed area, so page edges will show white");
  await page.getByTestId("unit").selectOption("mm");
  await expect(page.locator("[data-testid=issue-warning][data-code=no-bleed-box]")).toContainText("Bleed is set to 3.2 mm");
  expect(errors).toEqual([]);
});

test("the unit is remembered for next time and saved with the project", async ({ page }) => {
  const errors = await openSetup(page, BOOK_76, "mm");
  await page.getByTestId("start").click();
  const download = page.waitForEvent("download");
  await page.getByTestId("save-project").click();
  const path = (await (await download).path())!;

  // Remembered: a fresh load starts in mm.
  await page.goto("/");
  await page.getByTestId("open-pdf").setInputFiles(BOOK_76);
  await expect(page.getByTestId("unit")).toHaveValue("mm");

  // Saved: the project's unit wins over what was remembered.
  await page.evaluate(() => localStorage.setItem("bookimposer.unit", "in"));
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("open-project").click();
  await (await chooser).setFiles(path);
  await page.getByTestId("choose-pdf").setInputFiles(BOOK_76);
  await expect(page.getByTestId("export-pdf")).toBeVisible({ timeout: FIRST_BUILD_MS });
  await expect(page.getByTestId("unit")).toHaveValue("mm");
  expect(errors).toEqual([]);
});
