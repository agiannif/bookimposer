// The sheet view: each sheet's front and back as printed, a stepper, and page thumbnails.
//
// data-testids used here:
//   sheet-stepper          "Sheet n of N" with its prev/next buttons (sheet-prev, sheet-next)
//   sheet-front, sheet-back   the two side SVGs
//   badge                  a panel's 1-based page number (data-side = front/back, data-pdf-page = 0-based page)
//   placement-image        a panel's page thumbnail (data-pdf-page = 0-based page)
//   blank-panel            a hatched panel with no page
//   cut-line, fold-line    the front's cut and fold lines (fold-line data-opens-by-trim = true/false)
//   previews-unavailable   the note shown when thumbnails can't be rendered
import { test, expect, type Page } from "@playwright/test";
import { BOOK_76, FIRST_BUILD_MS, fixture, openSetup, openWithBoards } from "./open-book.ts";

test.describe.configure({ timeout: FIRST_BUILD_MS + 30_000 });

/** A side's badge numbers in reading order: top to bottom, then left to right. */
async function badges(page: Page, side: "front" | "back"): Promise<string[]> {
  const found = await page.locator(`[data-testid=badge][data-side=${side}]`).evaluateAll((all) =>
    all.map((badge) => ({ text: badge.textContent!.trim(), box: badge.getBoundingClientRect() })));
  found.sort((a, b) => Math.round(a.box.top - b.box.top) || a.box.left - b.box.left);
  return found.map((badge) => badge.text);
}

const stepper = (page: Page) => page.getByTestId("sheet-stepper");

test("sheet 1 shows the worked example's pages on both sides, as printed", async ({ page }) => {
  // Body pages 8 1 6 3 and 2 7 4 5, counted after the front board's two pages.
  const errors = await openWithBoards(page);
  await expect(stepper(page)).toContainText("Sheet 1 of 10");
  await expect(page.getByTestId("sheet-front")).toBeVisible();
  await expect(page.getByText("Front", { exact: true })).toBeVisible();
  await expect(page.getByText("Back (as printed)", { exact: true })).toBeVisible();
  expect(await badges(page, "front")).toEqual(["10", "3", "8", "5"]);
  expect(await badges(page, "back")).toEqual(["4", "9", "6", "7"]);
  expect(errors).toEqual([]);
});

test("the front shows cut lines and the folds; the back shows no lines", async ({ page }) => {
  const errors = await openWithBoards(page);
  const front = page.getByTestId("sheet-front");
  await expect(front.getByTestId("cut-line")).toHaveCount(7);
  await expect(front.getByTestId("fold-line")).toHaveCount(2);
  await expect(front.getByTestId("fold-line").first()).toHaveAttribute("stroke-dasharray", /\d/);
  await expect(page.getByTestId("sheet-back").locator("[data-testid=cut-line], [data-testid=fold-line]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a fold that is trimmed open is dotted", async ({ page }) => {
  const errors = await openSetup(page);
  await page.getByTestId("folds-2").click();
  await page.getByTestId("start").click();
  const opens = page.getByTestId("sheet-front").locator("[data-testid=fold-line][data-opens-by-trim=true]");
  const spine = page.getByTestId("sheet-front").locator("[data-testid=fold-line][data-opens-by-trim=false]");
  await expect(opens).not.toHaveCount(0);
  await expect(spine).not.toHaveCount(0);
  expect(await opens.first().getAttribute("stroke-dasharray")).not.toEqual(await spine.first().getAttribute("stroke-dasharray"));
  expect(errors).toEqual([]);
});

test("pressing → three times shows sheet 4, and the buttons step too", async ({ page }) => {
  const errors = await openWithBoards(page);
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await expect(stepper(page)).toContainText("Sheet 4 of 10");
  await page.getByTestId("sheet-prev").click();
  await expect(stepper(page)).toContainText("Sheet 3 of 10");
  await page.getByTestId("sheet-next").click();
  await page.keyboard.press("ArrowLeft");
  await expect(stepper(page)).toContainText("Sheet 3 of 10");
  expect(errors).toEqual([]);
});

test("the stepper stops at the first and last sheet", async ({ page }) => {
  const errors = await openWithBoards(page);
  await expect(page.getByTestId("sheet-prev")).toBeDisabled();
  await page.keyboard.press("ArrowLeft");
  await expect(stepper(page)).toContainText("Sheet 1 of 10");
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
  await expect(stepper(page)).toContainText("Sheet 10 of 10");
  await expect(page.getByTestId("sheet-next")).toBeDisabled();
  expect(errors).toEqual([]);
});

test("arrow keys in a text field edit the field, not the sheet", async ({ page }) => {
  const errors = await openWithBoards(page);
  await page.getByTestId("signatures").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(stepper(page)).toContainText("Sheet 1 of 10");
  expect(errors).toEqual([]);
});

test("the thumbnail for page 3 arrives within 2 s", async ({ page }) => {
  const errors = await openWithBoards(page);
  const image = page.locator("[data-testid=placement-image][data-pdf-page='2']");
  await expect(image).toHaveAttribute("href", /^blob:/, { timeout: 2_000 });
  expect(errors).toEqual([]);
});

test("changing the signatures updates the sheet count without a reload, clamping to the last sheet", async ({ page }) => {
  const errors = await openWithBoards(page);
  // 18 signatures of 4 pages still take 10 sheets; 4 signatures of 18 pages take 11.
  await page.getByTestId("signatures").fill("18");
  await expect(stepper(page)).toContainText(`Sheet 1 of ${await page.getByTestId("derived-sheets").textContent()}`);
  await page.getByTestId("signatures").fill("4");
  await expect(stepper(page)).toContainText("Sheet 1 of 11");
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
  await expect(stepper(page)).toContainText("Sheet 11 of 11");
  await page.getByTestId("signatures").fill("9");
  await expect(stepper(page)).toContainText("Sheet 10 of 10");
  expect(errors).toEqual([]);
});

test("switching sheets doesn't block input: ten quick presses land on sheet 10 within 1 s", async ({ page }) => {
  const errors = await openWithBoards(page);
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
  await expect(stepper(page)).toContainText("Sheet 10 of 10", { timeout: 1_000 });
  expect(errors).toEqual([]);
});

test("every sheet's pages get thumbnails after stepping through quickly", async ({ page }) => {
  const errors = await openWithBoards(page);
  for (let i = 0; i < 9; i++) await page.keyboard.press("ArrowRight");
  await expect(stepper(page)).toContainText("Sheet 10 of 10");
  // Sheet 10 holds the two boards, whose backs are left blank: four pages, all on the front.
  const images = page.locator("[data-testid=placement-image]");
  await expect(images).toHaveCount(4);
  for (const image of await images.all()) await expect(image).toHaveAttribute("href", /^blob:/);
  expect(errors).toEqual([]);
});

test("blank panels are hatched and have no page number", async ({ page }) => {
  // 74 pages leave the body 2 pages short, so the last body sheet (sheet 9) has blank panels.
  const errors = await openWithBoards(page, fixture("book-74.pdf"));
  await expect(page.getByTestId("blank-panel")).toHaveCount(0);
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowRight");
  await expect(stepper(page)).toContainText("Sheet 9 of 10");
  await expect(page.getByTestId("blank-panel")).toHaveCount(2);
  await expect(page.getByTestId("badge")).toHaveCount(6);
  await expect(page.getByTestId("blank-panel").first()).toHaveAttribute("fill", /url\(#/);
  expect(errors).toEqual([]);
});

test("a landscape sheet turns the pages a quarter, upright box centred on the panel", async ({ page }) => {
  const errors = await openSetup(page, fixture("book-8.pdf"));
  await page.getByTestId("sheet-size").selectOption("custom");
  await page.getByTestId("sheet-width").fill("792");
  await page.getByTestId("sheet-height").fill("612");
  await page.getByTestId("start").click();
  await expect(stepper(page)).toContainText("Sheet 1 of 1");
  const image = page.getByTestId("sheet-front").locator("[data-testid=placement-image]").first();
  const transform = (await image.getAttribute("transform"))!;
  expect(transform).toMatch(/^rotate\((90|270) /);
  // The upright box is portrait, 288 wide by 378 tall in sheet points.
  expect(Number(await image.getAttribute("width"))).toBe(288);
  expect(Number(await image.getAttribute("height"))).toBe(378);
  await expect(image).toHaveAttribute("href", /^blob:/);
  expect(errors).toEqual([]);
});

/** Page 3's image box and its clip rect, in sheet points. */
const page3 = (page: Page) => placementBox(page, "2");

/** The image box and clip rect, in sheet points, of 0-based PDF page `pdfPage`. */
async function placementBox(page: Page, pdfPage: string) {
  const image = page.locator(`[data-testid=placement-image][data-pdf-page='${pdfPage}']`);
  const number = async (name: string) => Number(await image.getAttribute(name));
  // The clip is on the image's group, so it doesn't turn with the image.
  const clipId = (await image.locator("xpath=..").getAttribute("clip-path"))!.match(/url\(#(.+)\)/)![1]!;
  const clip = page.locator(`clipPath[id='${clipId}'] rect`);
  const clipNumber = async (name: string) => Number(await clip.getAttribute(name));
  return {
    x: await number("x"),
    y: await number("y"),
    width: await number("width"),
    height: await number("height"),
    clipX: await clipNumber("x"),
    clipY: await clipNumber("y"),
    clipWidth: await clipNumber("width"),
    clipHeight: await clipNumber("height"),
  };
}

test("the page size mismatch control scales page 3 to fit or centres it unscaled and clipped", async ({ page }) => {
  const errors = await openSetup(page, fixture("mixed-8.pdf"));
  await page.getByTestId("start").click();
  await expect(page.getByTestId("issue-warning")).toHaveAttribute("data-code", "page-size-mismatch");

  // 300x400 in a 288x378 panel: fit scales by 378/400, so it is 283.5 wide, centred.
  const fit = await page3(page);
  expect(fit.clipWidth).toBe(288);
  expect(fit.width).toBeCloseTo(283.5);
  expect(fit.x + fit.width / 2).toBeCloseTo(fit.clipX + fit.clipWidth / 2);

  await page.getByTestId("mismatch").selectOption("center");
  await expect(page.locator("[data-testid=placement-image][data-pdf-page='2']")).toHaveAttribute("width", "300");
  const center = await page3(page);
  expect(center.width).toBe(300);
  expect(center.x).toBeLessThan(center.clipX);
  expect(center.x + center.width / 2).toBeCloseTo(center.clipX + center.clipWidth / 2);

  await page.getByTestId("mismatch").selectOption("fit");
  await expect(page.locator("[data-testid=placement-image][data-pdf-page='2']")).toHaveAttribute("width", "283.5");
  expect(errors).toEqual([]);
});

test("a page with a TrimBox inside its crop box is drawn so the trim fills the panel", async ({ page }) => {
  const errors = await openSetup(page, fixture("trimmed-8.pdf"));
  await page.getByTestId("start").click();
  const image = page.locator("[data-testid=placement-image][data-pdf-page='0']");
  await expect(image).toHaveAttribute("href", /^blob:/);
  const box = await placementBox(page, "0");
  // No bleed, so the clip is the panel; the 9 pt crop margins reach past it on every side, clipped off.
  expect(box.x).toBeCloseTo(box.clipX - 9);
  expect(box.width).toBeCloseTo(box.clipWidth + 18);
  expect(box.y).toBeCloseTo(box.clipY - 9);
  expect(box.height).toBeCloseTo(box.clipHeight + 18);
  expect(errors).toEqual([]);
});

test("a page whose preview fails keeps its number; the others still get theirs, with no note", async ({ page }) => {
  // Every render of page 3 asks the worker for a page the PDF doesn't have, so only that render fails.
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]) {
      const m = message as { type?: string; page?: number };
      const rewritten = m?.type === "render" && m.page === 2 ? { ...m, page: 9999 } : message;
      return (post as (this: Worker, ...args: unknown[]) => void).call(this, rewritten, ...rest);
    };
  });
  const errors = await openWithBoards(page);
  await expect(page.locator("[data-testid=placement-image][data-pdf-page='9']")).toHaveAttribute("href", /^blob:/);
  await expect(page.locator("[data-testid=placement-image][href]")).toHaveCount(7);
  await expect(page.locator("[data-testid=placement-image][data-pdf-page='2']")).not.toHaveAttribute("href", /./);
  expect(await badges(page, "front")).toEqual(["10", "3", "8", "5"]);
  await expect(page.getByTestId("previews-unavailable")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("if PDFium can't start, a note says so and page numbers stay", async ({ page }) => {
  await page.route("**/pdfium.wasm*", (route) => route.fulfill({ status: 404, body: "" }));
  const errors = await openWithBoards(page, BOOK_76);
  await expect(page.getByTestId("previews-unavailable")).toHaveText("Page previews are unavailable");
  expect(await badges(page, "front")).toEqual(["10", "3", "8", "5"]);
  await page.keyboard.press("ArrowRight");
  await expect(stepper(page)).toContainText("Sheet 2 of 10");
  await expect(page.locator("[data-testid=placement-image][href]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("if the preview worker fails to load, a note says so and page numbers stay", async ({ page }) => {
  await page.route(/thumbnail-worker/, (route) => route.abort());
  const errors = await openWithBoards(page, BOOK_76);
  await expect(page.getByTestId("previews-unavailable")).toHaveText("Page previews are unavailable");
  expect(await badges(page, "front")).toEqual(["10", "3", "8", "5"]);
  await expect(page.locator("[data-testid=placement-image][href]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a sheet with more than 64 pages keeps every page's thumbnail live", async ({ page }) => {
  // 10 folio signatures on a 2400 pt square sheet: all 20 pieces, all 76 pages, on one sheet.
  const errors = await openSetup(page);
  await page.getByTestId("sheet-size").selectOption("custom");
  await page.getByTestId("sheet-width").fill("2400");
  await page.getByTestId("sheet-height").fill("2400");
  await page.getByTestId("start").click();
  await expect(stepper(page)).toContainText("Sheet 1 of 1");
  const images = page.locator("[data-testid=placement-image]");
  await expect(images).toHaveCount(76);
  await expect(page.locator("[data-testid=placement-image][href^='blob:']")).toHaveCount(76, { timeout: 30_000 });
  // A revoked blob URL can no longer be fetched.
  const live = await images.evaluateAll((all) =>
    Promise.all(all.map((image) => fetch(image.getAttribute("href")!).then((r) => r.ok, () => false))));
  expect(live.filter((ok) => !ok)).toHaveLength(0);
  expect(errors).toEqual([]);
});
