// The open → setup → workspace flow, with live derived numbers, allocation bar and issues.
//
// data-testids used here:
//   open-pdf               the start screen's PDF file input
//   signatures, margin, sheet-width, sheet-height   number inputs (setup screen and workspace)
//   sheet-size             sheet size select (letter, a4, custom)
//   folds-1, folds-2, folds-3   fold count buttons
//   front-board, back-board  board checkboxes (setup screen and workspace)
//   start                  setup screen's button into the workspace
//   derived-pages-per-signature, derived-pieces-per-signature, derived-pieces-per-sheet, derived-sheets
//                          read-only derived numbers in part settings
//   allocation-segment     one part's page ranges in the allocation bar
//   parts-list             the workspace's parts panel
//   part-item              one part in the book, in the parts list (unticked boards are not part-items)
//   mismatch               page size mismatch select (fit, center)
//   issue-warning          a warning issue in the banner (data-code = issue code)
//   issue-error            an error issue in the banner (data-code = issue code)
//   export-pdf             the export button
import { test, expect } from "@playwright/test";
import { FIRST_BUILD_MS, fixture, openSetup, openWithBoards } from "./open-book.ts";

// Page 2 has /Rotate 90, so it displays landscape among portrait pages: a page size mismatch.
const ROTATED_8 = fixture("rotated-8.pdf");

test.describe.configure({ timeout: FIRST_BUILD_MS + 30_000 });

test("setup with 9 signatures and both boards opens a workspace with the derived numbers", async ({ page }) => {
  const errors = await openWithBoards(page);
  await expect(page.getByTestId("derived-pages-per-signature")).toHaveText("8");
  await expect(page.getByTestId("derived-sheets")).toHaveText("10");
  await expect(page.getByTestId("allocation-segment")).toContainText(["1–2", "3–74", "75–76"]);
  await expect(page.getByTestId("part-item")).toHaveCount(3);
  await expect(page.getByTestId("export-pdf")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("a margin too large for the piece shows the engine's error and disables export", async ({ page }) => {
  const errors = await openWithBoards(page);
  await page.getByTestId("margin").fill("400");
  const issue = page.getByTestId("issue-error");
  await expect(issue).toBeVisible();
  await expect(issue).toHaveAttribute("data-code", "piece-does-not-fit");
  await expect(issue).toHaveText("A piece is too large for the sheet.");
  await expect(page.getByTestId("export-pdf")).toBeDisabled();

  await page.getByTestId("margin").fill("18");
  await expect(page.getByTestId("issue-error")).toHaveCount(0);
  await expect(page.getByTestId("export-pdf")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("removing the front board updates the parts list and the allocation bar", async ({ page }) => {
  const errors = await openWithBoards(page);
  await page.getByTestId("front-board").uncheck();
  await expect(page.getByTestId("part-item")).toHaveCount(2);
  await expect(page.getByTestId("allocation-segment")).toHaveCount(2);
  await expect(page.getByTestId("allocation-segment")).toContainText(["1–74", "75–76"]);
  // The board's row stays, unticked, so it can be added back; its name appears once.
  await expect(page.getByTestId("parts-list").getByText("Front board")).toHaveCount(1);
  await page.getByTestId("front-board").check();
  await expect(page.getByTestId("part-item")).toHaveCount(3);
  await expect(page.getByTestId("parts-list").getByText("Front board")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("clearing a number mid-typing keeps the last valid value", async ({ page }) => {
  const errors = await openWithBoards(page);
  await page.getByTestId("signatures").fill("");
  await expect(page.getByTestId("derived-sheets")).toHaveText("10");
  await page.getByTestId("signatures").fill("18");
  await expect(page.getByTestId("derived-pages-per-signature")).toHaveText("4");
  expect(errors).toEqual([]);
});

test("a custom sheet size and a fold count re-impose live", async ({ page }) => {
  const errors = await openWithBoards(page);
  await page.getByTestId("sheet-size").selectOption("custom");
  await page.getByTestId("sheet-width").fill("1300");
  await page.getByTestId("sheet-height").fill("850");
  await expect(page.getByTestId("derived-pieces-per-sheet")).toHaveText("4");
  await expect(page.getByTestId("derived-sheets")).toHaveText("5");

  await page.getByTestId("sheet-size").selectOption("letter");
  await page.getByTestId("folds-2").click();
  await expect(page.getByTestId("derived-pieces-per-signature")).toHaveText("1");
  await expect(page.getByTestId("derived-pieces-per-sheet")).toHaveText("1");
  await expect(page.getByTestId("derived-sheets")).toHaveText("10");
  expect(errors).toEqual([]);
});

test("setup re-suggests signatures when folds or boards change", async ({ page }) => {
  const errors = await openSetup(page);
  await expect(page.getByTestId("signatures")).toHaveValue("10");
  await page.getByTestId("front-board").check();
  await page.getByTestId("back-board").check();
  await expect(page.getByTestId("signatures")).toHaveValue("9");
  await page.getByTestId("folds-3").click();
  await expect(page.getByTestId("signatures")).toHaveValue("5");
  expect(errors).toEqual([]);
});

test("setup keeps a typed signature count when folds or boards change", async ({ page }) => {
  const errors = await openSetup(page);
  await page.getByTestId("signatures").fill("12");
  await page.getByTestId("front-board").check();
  await page.getByTestId("folds-2").click();
  await expect(page.getByTestId("signatures")).toHaveValue("12");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("signatures")).toHaveValue("12");
  expect(errors).toEqual([]);
});

test("the page size mismatch control switches between scaling and centering", async ({ page }) => {
  const errors = await openSetup(page, ROTATED_8);
  await page.getByTestId("start").click();
  const warning = page.getByTestId("issue-warning");
  await expect(warning).toHaveAttribute("data-code", "page-size-mismatch");
  await expect(warning).toHaveText("Some pages differ in size from the panel.");
  const mismatch = page.getByTestId("mismatch");
  await expect(mismatch).toHaveValue("fit");
  await mismatch.selectOption("center");
  await expect(mismatch).toHaveValue("center");
  await expect(page.getByTestId("issue-warning")).toHaveAttribute("data-code", "page-size-mismatch");
  await expect(page.getByTestId("export-pdf")).toBeEnabled();
  expect(errors).toEqual([]);
});
