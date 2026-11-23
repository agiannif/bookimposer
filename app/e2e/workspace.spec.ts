// The open → setup → workspace flow, with live derived numbers, allocation bar and issues.
//
// data-testids used here:
//   open-pdf               the start screen's PDF file input
//   signatures, margin, sheet-width, sheet-height   number inputs (setup screen and workspace)
//   sheet-size             sheet size select (letter, a4, tabloid, a3, custom)
//   folds-1, folds-2, folds-3   fold count buttons
//   front-board, back-board  board checkboxes (setup screen and workspace)
//   start                  setup screen's button into the workspace
//   suggest-signatures     the workspace's button that suggests a signature count
//   derived-pages-per-signature, derived-pieces-per-signature, derived-pieces-per-sheet, derived-sheets
//                          read-only derived numbers in part settings
//   allocation-segment     one part's page ranges in the allocation bar
//   leaf-note              a body segment's note on a blank leaf a board wraps (data-position = before, after)
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

test("setup with 10 signatures and both boards opens a workspace with the derived numbers", async ({ page }) => {
  const errors = await openWithBoards(page);
  await expect(page.getByTestId("derived-pages-per-signature")).toHaveText("8");
  await expect(page.getByTestId("derived-sheets")).toHaveText("11");
  await expect(page.getByTestId("derived-blanks-added")).toHaveText("4");
  // Each board takes two pages, the first two and the last two of the PDF, and wraps a blank leaf at its end of the body.
  await expect(page.getByTestId("allocation-segment").first()).toHaveText(/^\s*Front board\s*1–2\s*$/);
  await expect(page.getByTestId("allocation-segment").nth(1)).toHaveText(/^\s*Body\s*\+2 blank \(cover leaf\)\s*3–74\s*\+4 blank\s*\+2 blank \(cover leaf\)\s*$/);
  await expect(page.getByTestId("allocation-segment").last()).toHaveText(/^\s*Back board\s*75–76\s*$/);
  await expect(page.getByTestId("leaf-note").first()).toHaveAttribute("data-position", "before");
  await expect(page.getByTestId("leaf-note").last()).toHaveAttribute("data-position", "after");
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
  // The PDF's first two pages join the body in place of the front blank leaf: still 76 body pages.
  await expect(page.getByTestId("allocation-segment")).toHaveCount(2);
  await expect(page.getByTestId("allocation-segment")).toContainText(["1–74", "75–76"]);
  await expect(page.getByTestId("leaf-note")).toHaveCount(1);
  await expect(page.getByTestId("leaf-note")).toHaveAttribute("data-position", "after");
  // 76 body pages in 12 signatures of 8 pages leave two signatures blank.
  await page.getByTestId("signatures").fill("12");
  await expect(page.getByTestId("issue-error")).toHaveAttribute("data-code", "too-many-signatures");
  await expect(page.getByTestId("issue-error")).toHaveText("Too many signatures: with 76 body pages, 12 signatures of 8 pages leave 2 entirely blank. Use Suggest next to Signatures to pick a count that fits.");
  await expect(page.getByTestId("export-pdf")).toBeDisabled();
  await page.getByTestId("signatures").fill("10");
  await expect(page.getByTestId("issue-error")).toHaveCount(0);
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
  await expect(page.getByTestId("derived-sheets")).toHaveText("11");
  await page.getByTestId("signatures").fill("19");
  await expect(page.getByTestId("derived-pages-per-signature")).toHaveText("4");
  expect(errors).toEqual([]);
});

test("a custom sheet size and a fold count re-impose live", async ({ page }) => {
  const errors = await openWithBoards(page);
  await page.getByTestId("sheet-size").selectOption("custom");
  await page.getByTestId("sheet-width").fill("1300");
  await page.getByTestId("sheet-height").fill("850");
  await expect(page.getByTestId("derived-pieces-per-sheet")).toHaveText("4");
  await expect(page.getByTestId("derived-sheets")).toHaveText("6");

  await page.getByTestId("sheet-size").selectOption("letter");
  await page.getByTestId("folds-2").click();
  await expect(page.getByTestId("derived-pieces-per-signature")).toHaveText("1");
  await expect(page.getByTestId("derived-pieces-per-sheet")).toHaveText("1");
  await expect(page.getByTestId("derived-sheets")).toHaveText("11");
  expect(errors).toEqual([]);
});

test("setup re-suggests signatures when folds change; boards keep the body at the PDF's page count", async ({ page }) => {
  const errors = await openSetup(page);
  await expect(page.getByTestId("signatures")).toHaveValue("10");
  // Each board takes 2 pages and gives the body a 2-page blank leaf, so 76 pages stay 76 body pages.
  await page.getByTestId("front-board").check();
  await page.getByTestId("back-board").check();
  await expect(page.getByTestId("signatures")).toHaveValue("10");
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

test("tabloid and A3 are sheet presets in setup and in the print panel", async ({ page }) => {
  const errors = await openSetup(page);
  await page.getByTestId("front-board").check();
  await page.getByTestId("back-board").check();
  await page.getByTestId("sheet-size").selectOption("tabloid");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("sheet-size")).toHaveValue("tabloid");
  // 576 x 378 pieces, turned, fit 2 x 2 on 792 x 1224 inside the 18 pt margin.
  await expect(page.getByTestId("derived-pieces-per-sheet")).toHaveText("4");
  await page.getByTestId("sheet-size").selectOption("a3");
  await expect(page.getByTestId("sheet-size")).toHaveValue("a3");
  await expect(page.getByTestId("derived-pieces-per-sheet")).toHaveText("4");
  await page.getByTestId("sheet-size").selectOption("custom");
  await expect(page.getByTestId("sheet-width")).toHaveValue("841.89");
  await expect(page.getByTestId("sheet-height")).toHaveValue("1190.55");
  expect(errors).toEqual([]);
});

test("an absurd signature count shows an error and disables export, then recovers", async ({ page }) => {
  const errors = await openWithBoards(page);
  await page.getByTestId("signatures").fill("9000000000");
  const issue = page.getByTestId("issue-error");
  await expect(issue).toHaveAttribute("data-code", "too-many-signatures");
  await expect(issue).toHaveText("Too many signatures: with 76 body pages, at most 19 signatures can hold content. Use Suggest next to Signatures to pick a count that fits.");
  await expect(page.getByTestId("export-pdf")).toBeDisabled();
  // Nothing is allocated, so the allocation bar is hidden rather than shown empty.
  await expect(page.getByRole("group", { name: "PDF pages per part" })).toHaveCount(0);
  await page.getByTestId("signatures").fill("10");
  await expect(page.getByTestId("issue-error")).toHaveCount(0);
  await expect(page.getByTestId("allocation-segment")).toHaveCount(3);
  await expect(page.getByTestId("derived-sheets")).toHaveText("11");
  await expect(page.getByTestId("export-pdf")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("bleed on a PDF without a bleed box warns that the edges will show white", async ({ page }) => {
  const errors = await openWithBoards(page);
  await page.getByTestId("bleed").fill("9");
  const warning = page.locator("[data-testid=issue-warning][data-code=no-bleed-box]");
  await expect(warning).toHaveText("Bleed is set to 9 pt, but this PDF has no bleed area, so page edges will show white");
  await expect(page.getByTestId("export-pdf")).toBeEnabled();
  await page.getByTestId("bleed").fill("0");
  await expect(warning).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a board's panel says it wraps the blank end leaf of the book block", async ({ page }) => {
  const errors = await openWithBoards(page);
  const hint = page.getByText("A board takes 2 pages: the cover and the inside cover. It wraps the blank first (or last) leaf of the book block and is glued to both sides.");
  await page.getByTestId("part-item").filter({ hasText: "Front board" }).click();
  await expect(hint).toBeVisible();
  await page.getByTestId("part-item").filter({ hasText: "Back board" }).click();
  await expect(hint).toBeVisible();
  await page.getByTestId("part-item").filter({ hasText: "Body" }).click();
  await expect(hint).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Export sits next to Save project in the header, and the allocation bar is a labelled group", async ({ page }) => {
  const errors = await openWithBoards(page);
  const header = page.getByRole("banner");
  await expect(header.getByTestId("save-project")).toBeVisible();
  await expect(header.getByTestId("export-pdf")).toBeVisible();
  await expect(page.getByRole("group", { name: "PDF pages per part" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Suggest picks a signature count for the current folds and boards; folds alone keep the typed count", async ({ page }) => {
  const errors = await openWithBoards(page);
  // The button fits inside its panel's padding.
  const button = (await page.getByTestId("suggest-signatures").boundingBox())!;
  const panel = (await page.locator("section[aria-labelledby=part-settings-heading]").boundingBox())!;
  expect(button.x + button.width).toBeLessThanOrEqual(panel.x + panel.width - 16);
  await page.getByTestId("signatures").fill("18");
  await page.getByTestId("suggest-signatures").click();
  await expect(page.getByTestId("signatures")).toHaveValue("10");
  await page.getByTestId("folds-3").click();
  await expect(page.getByTestId("signatures")).toHaveValue("10");
  await page.getByTestId("suggest-signatures").click();
  await expect(page.getByTestId("signatures")).toHaveValue("5");
  // 76 body pages in 5 signatures of 16; a three-fold piece is too big for Letter, which the engine reports.
  await expect(page.getByTestId("derived-pages-per-signature")).toHaveText("16");
  expect(errors).toEqual([]);
});
