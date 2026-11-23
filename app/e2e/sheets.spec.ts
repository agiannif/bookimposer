// The sheet view: each sheet's front and back as printed, a stepper, and page thumbnails.
//
// data-testids used here:
//   sheet-stepper          "Sheet n of N" with its prev/next buttons (sheet-prev, sheet-next)
//   sheet-front, sheet-back   the two side SVGs
//   badge                  a panel's 1-based page number (data-side = front/back, data-pdf-page = 0-based page,
//                          absent on a blank leaf's badge)
//   placement-image        a panel's page thumbnail (data-pdf-page = 0-based page)
//   blank-panel            a hatched panel with no page (data-leaf = true on a board's blank leaf, which is numbered)
//   cut-line, fold-line    a side's cut and fold lines (fold-line data-opens-by-trim = true/false)
//   rotate-left, rotate-right, rotate-reset   turn the sheet view a quarter, or return to the default
//   marks-preview          the "Show marks as exported" checkbox
//   mark                   a mark as exported, on either side (data-kind = cut/fold)
//   previews-unavailable   the note shown when thumbnails can't be rendered
import { test, expect, type Page } from "@playwright/test";
import { impose } from "../../engine/src/index.ts";
import { DEFAULT_SETTINGS, toBookSpec } from "../src/lib/book.ts";
import { BOOK_76, FIRST_BUILD_MS, fixture, openSetup, openWithBoards } from "./open-book.ts";

test.describe.configure({ timeout: FIRST_BUILD_MS + 30_000 });

/**
 * A side's panels in reading order, top to bottom, then left to right: each page's badge number, or "blank"
 * for an unnumbered blank panel. A badge sits a few pixels inside its panel's top-left corner, so panels whose tops are
 * within 20 px share a row.
 */
async function badges(page: Page, side: "front" | "back"): Promise<string[]> {
  const found = await page.getByTestId(`sheet-${side}`).locator("[data-testid=badge], [data-testid=blank-panel][data-leaf=false]").evaluateAll((all) =>
    all.map((panel) => ({
      text: panel.getAttribute("data-testid") === "blank-panel" ? "blank" : panel.textContent!.trim(),
      box: panel.getBoundingClientRect(),
    })));
  found.sort((a, b) => (Math.abs(a.box.top - b.box.top) > 20 ? a.box.top - b.box.top : a.box.left - b.box.left));
  return found.map((panel) => panel.text);
}

const stepper = (page: Page) => page.getByTestId("sheet-stepper");

test("sheet 1 shows the worked example's pages on both sides, as printed", async ({ page }) => {
  // Body pages 8 1 6 3 and 2 7 4 5: body pages 1 and 2 are the blank leaf the front board wraps, numbered
  // like the board's pages.
  const errors = await openWithBoards(page);
  await expect(stepper(page)).toContainText("Sheet 1 of 11");
  await expect(page.getByTestId("sheet-front")).toBeVisible();
  await expect(page.getByText("Front", { exact: true })).toBeVisible();
  await expect(page.getByText("Back (as printed)", { exact: true })).toBeVisible();
  expect(await badges(page, "front")).toEqual(["8", "1", "6", "3"]);
  expect(await badges(page, "back")).toEqual(["2", "7", "4", "5"]);
  expect(errors).toEqual([]);
});

test("landscape pages fill the sheet in reading order: the first piece is the top row as read", async ({ page }) => {
  // 378x288 pages turn a quarter on letter. Each side's view turns so its own pages read upright: the
  // front's sit at 90 and the back's at 270, so the sides turn opposite ways.
  const errors = await openWithBoards(page, fixture("landscape-76.pdf"));
  await expect(stepper(page)).toContainText("Sheet 1 of 11");
  expect(await badges(page, "front")).toEqual(["8", "1", "6", "3"]);
  expect(await badges(page, "back")).toEqual(["2", "7", "4", "5"]);
  // The rotate buttons turn both sides together; Reset returns each to its own default.
  await page.getByTestId("rotate-right").click();
  await page.getByTestId("rotate-right").click();
  expect(await badges(page, "front")).toEqual(["3", "6", "1", "8"]);
  expect(await badges(page, "back")).toEqual(["5", "4", "7", "2"]);
  await page.getByTestId("rotate-reset").click();
  expect(await badges(page, "back")).toEqual(["2", "7", "4", "5"]);
  expect(errors).toEqual([]);
});

test("both sides show the cut lines and folds, the back's exactly behind the front's", async ({ page }) => {
  const errors = await openWithBoards(page);
  const front = page.getByTestId("sheet-front");
  await expect(front.getByTestId("cut-line")).toHaveCount(7);
  await expect(front.getByTestId("fold-line")).toHaveCount(2);
  await expect(front.getByTestId("fold-line").first()).toHaveAttribute("stroke-dasharray", /\d/);
  // Long-edge duplex on a portrait sheet mirrors x between the sides.
  const ends = (side: "front" | "back") => page.getByTestId(`sheet-${side}`).locator("[data-testid=cut-line], [data-testid=fold-line]")
    .evaluateAll((all) => all.map((l) => ["x1", "y1", "x2", "y2"].map((a) => Number(l.getAttribute(a)))));
  const behind = (await ends("front")).map(([x1, y1, x2, y2]) => [612 - x2!, y1, 612 - x1!, y2]);
  expect(await ends("back")).toEqual(behind);
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
  await expect(stepper(page)).toContainText("Sheet 4 of 11");
  await page.getByTestId("sheet-prev").click();
  await expect(stepper(page)).toContainText("Sheet 3 of 11");
  await page.getByTestId("sheet-next").click();
  await page.keyboard.press("ArrowLeft");
  await expect(stepper(page)).toContainText("Sheet 3 of 11");
  expect(errors).toEqual([]);
});

test("the stepper stops at the first and last sheet", async ({ page }) => {
  const errors = await openWithBoards(page);
  await expect(page.getByTestId("sheet-prev")).toBeDisabled();
  await page.keyboard.press("ArrowLeft");
  await expect(stepper(page)).toContainText("Sheet 1 of 11");
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
  await expect(stepper(page)).toContainText("Sheet 11 of 11");
  await expect(page.getByTestId("sheet-next")).toBeDisabled();
  expect(errors).toEqual([]);
});

test("arrow keys in a text field edit the field, not the sheet", async ({ page }) => {
  const errors = await openWithBoards(page);
  await page.getByTestId("signatures").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(stepper(page)).toContainText("Sheet 1 of 11");
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
  // 19 signatures of 4 pages still take 11 sheets; 3 signatures of 28 pages take 12.
  await page.getByTestId("signatures").fill("19");
  await expect(stepper(page)).toContainText(`Sheet 1 of ${await page.getByTestId("derived-sheets").textContent()}`);
  await page.getByTestId("signatures").fill("3");
  await expect(stepper(page)).toContainText("Sheet 1 of 12");
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  for (let i = 0; i < 11; i++) await page.keyboard.press("ArrowRight");
  await expect(stepper(page)).toContainText("Sheet 12 of 12");
  await page.getByTestId("signatures").fill("10");
  await expect(stepper(page)).toContainText("Sheet 11 of 11");
  expect(errors).toEqual([]);
});

test("switching sheets doesn't block input: ten quick presses land on sheet 11 within 1 s", async ({ page }) => {
  const errors = await openWithBoards(page);
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
  await expect(stepper(page)).toContainText("Sheet 11 of 11", { timeout: 1_000 });
  expect(errors).toEqual([]);
});

test("every sheet's pages get thumbnails after stepping through quickly", async ({ page }) => {
  const errors = await openWithBoards(page);
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
  await expect(stepper(page)).toContainText("Sheet 11 of 11");
  // Sheet 11 holds the two boards, whose backs are left blank: four pages, all on the front.
  const images = page.locator("[data-testid=placement-image]");
  await expect(images).toHaveCount(4);
  for (const image of await images.all()) await expect(image).toHaveAttribute("href", /^blob:/);
  expect(errors).toEqual([]);
});

test("blank panels are hatched; a board's blank leaf is numbered like the board, padding is not", async ({ page }) => {
  // Sheet 1 holds the blank leaf the front board wraps (1 and 2); sheet 2 has no blanks; sheet 10 holds the
  // last signature: PDF pages 73 and 74, 4 padding blanks and the blank leaf the back board wraps (75 and 76).
  const errors = await openWithBoards(page);
  await expect(page.getByTestId("blank-panel")).toHaveCount(2);
  await expect(page.locator("[data-testid=blank-panel][data-leaf=true]")).toHaveCount(2);
  await expect(page.getByTestId("badge")).toHaveCount(8);
  await expect(page.getByTestId("blank-panel").first()).toHaveAttribute("fill", /url\(#/);
  await page.keyboard.press("ArrowRight");
  await expect(stepper(page)).toContainText("Sheet 2 of 11");
  await expect(page.getByTestId("blank-panel")).toHaveCount(0);
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowRight");
  await expect(stepper(page)).toContainText("Sheet 10 of 11");
  await expect(page.getByTestId("blank-panel")).toHaveCount(6);
  await expect(page.locator("[data-testid=blank-panel][data-leaf=false]")).toHaveCount(4);
  const numbers = await page.getByTestId("badge").allTextContents();
  expect(numbers.map((n) => n.trim()).sort()).toEqual(["73", "74", "75", "76"]);
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
  await expect(page.locator("[data-testid=placement-image][data-pdf-page='7']")).toHaveAttribute("href", /^blob:/);
  await expect(page.locator("[data-testid=placement-image][href]")).toHaveCount(5);
  await expect(page.locator("[data-testid=placement-image][data-pdf-page='2']")).not.toHaveAttribute("href", /./);
  expect(await badges(page, "front")).toEqual(["8", "1", "6", "3"]);
  await expect(page.getByTestId("previews-unavailable")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("if PDFium can't start, a note says so and page numbers stay", async ({ page }) => {
  await page.route("**/pdfium.wasm*", (route) => route.fulfill({ status: 404, body: "" }));
  const errors = await openWithBoards(page, BOOK_76);
  await expect(page.getByTestId("previews-unavailable")).toHaveText("Page previews are unavailable");
  expect(await badges(page, "front")).toEqual(["8", "1", "6", "3"]);
  await page.keyboard.press("ArrowRight");
  await expect(stepper(page)).toContainText("Sheet 2 of 11");
  await expect(page.locator("[data-testid=placement-image][href]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("if the preview worker fails to load, a note says so and page numbers stay", async ({ page }) => {
  await page.route(/thumbnail-worker/, (route) => route.abort());
  const errors = await openWithBoards(page, BOOK_76);
  await expect(page.getByTestId("previews-unavailable")).toHaveText("Page previews are unavailable");
  expect(await badges(page, "front")).toEqual(["8", "1", "6", "3"]);
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

test("marks as exported: off by default, on shows the engine's marks on both sides instead of the lines", async ({ page }) => {
  const errors = await openWithBoards(page);
  const front = page.getByTestId("sheet-front");
  const back = page.getByTestId("sheet-back");
  await expect(page.getByTestId("marks-preview")).not.toBeChecked();
  await expect(page.locator("[data-testid=mark]")).toHaveCount(0);

  // The same book the app imposes: 76 pages of 288x378 with boards and 10 signatures.
  const settings = { ...DEFAULT_SETTINGS, signatures: 10, frontBoard: true, backBoard: true };
  const sheet = impose(toBookSpec(Array.from({ length: 76 }, () => ({ width: 288, height: 378 })), settings)).sheets[0];
  await page.getByTestId("marks-preview").check();
  for (const [svg, marks] of [[front, sheet.front.marks], [back, sheet.back.marks]] as const) {
    await expect(svg.locator("[data-testid=mark][data-kind=cut]")).toHaveCount(marks.cut.length);
    await expect(svg.locator("[data-testid=mark][data-kind=fold]")).toHaveCount(marks.fold.length);
  }
  expect(sheet.back.marks.cut.length).toBeGreaterThan(0);
  const first = back.locator("[data-testid=mark][data-kind=cut]").first();
  const tick = sheet.back.marks.cut[0];
  expect(await first.evaluate((l) => ["x1", "y1", "x2", "y2"].map((a) => Number(l.getAttribute(a))))).toEqual([tick.x1, tick.y1, tick.x2, tick.y2]);
  await expect(page.locator("[data-testid=cut-line], [data-testid=fold-line]")).toHaveCount(0);

  // Only the kinds the export draws.
  await page.getByTestId("fold-marks").uncheck();
  await expect(front.locator("[data-testid=mark][data-kind=fold]")).toHaveCount(0);
  await expect(back.locator("[data-testid=mark][data-kind=cut]")).toHaveCount(sheet.back.marks.cut.length);

  await page.getByTestId("marks-preview").uncheck();
  await expect(page.locator("[data-testid=mark]")).toHaveCount(0);
  await expect(front.getByTestId("cut-line")).toHaveCount(7);
  expect(errors).toEqual([]);
});

test("a sheet with no room for either kind of mark warns while either kind is on", async ({ page }) => {
  // Two 288x378 pages side by side fill a 576x756 sheet with no margin.
  const errors = await openSetup(page, fixture("book-8.pdf"));
  await page.getByTestId("sheet-size").selectOption("custom");
  await page.getByTestId("sheet-width").fill("576");
  await page.getByTestId("sheet-height").fill("756");
  await page.getByTestId("margin").fill("0");
  await page.getByTestId("start").click();
  const warning = page.locator("[data-testid=issue-warning][data-code=no-room-for-marks]");
  await expect(warning).toHaveText("Cut/fold marks would overlap page content on sheet 1.");
  await page.getByTestId("cut-marks").uncheck();
  await expect(warning).toHaveCount(1);
  await page.getByTestId("fold-marks").uncheck();
  await expect(warning).toHaveCount(0);
  expect(errors).toEqual([]);
});

/** The sheet front's drawn size on screen. */
async function frontSize(page: Page) {
  const box = (await page.getByTestId("sheet-front").boundingBox())!;
  return { width: box.width, height: box.height };
}

test("rotating the view turns the sheet a quarter, keeps the numbers upright, and Reset returns to upright", async ({ page }) => {
  const errors = await openWithBoards(page);
  const front = page.getByTestId("sheet-front");
  const before = await frontSize(page);
  expect(before.height).toBeGreaterThan(before.width);
  await expect(page.getByTestId("rotate-reset")).toBeDisabled();

  await page.getByTestId("rotate-right").click();
  const after = await frontSize(page);
  expect(after.width).toBeGreaterThan(after.height);
  await expect(front).toHaveAttribute("viewBox", "0 0 792 612");
  // Every badge is counter-turned by exactly the view's turn.
  for (const transform of await front.getByTestId("badge").evaluateAll((all) => all.map((b) => b.getAttribute("transform")))) {
    expect(transform).toMatch(/rotate\(-90\)$/);
  }
  await expect(page.getByTestId("rotate-reset")).toBeEnabled();

  await page.getByTestId("rotate-left").click();
  await page.getByTestId("rotate-left").click();
  await expect(front).toHaveAttribute("viewBox", "0 0 792 612");
  await page.getByTestId("rotate-reset").click();
  await expect(front).toHaveAttribute("viewBox", "0 0 612 792");
  expect(errors).toEqual([]);
});

test("a landscape sheet opens turned so its pages read upright, and a chosen turn resets when the default changes", async ({ page }) => {
  const errors = await openSetup(page, fixture("book-8.pdf"));
  await page.getByTestId("sheet-size").selectOption("custom");
  await page.getByTestId("sheet-width").fill("792");
  await page.getByTestId("sheet-height").fill("612");
  await page.getByTestId("start").click();
  const front = page.getByTestId("sheet-front");
  // Pages sit at 90 on this sheet, so the view turns 270 and the drawn sheet is portrait.
  await expect(front).toHaveAttribute("viewBox", "0 0 612 792");
  await page.getByTestId("rotate-right").click();
  await expect(front).toHaveAttribute("viewBox", "0 0 792 612");
  // Changing the sheet to portrait changes the default, which clears the chosen turn.
  await page.getByTestId("sheet-height").fill("1000");
  await page.getByTestId("sheet-width").fill("700");
  await expect(front).toHaveAttribute("viewBox", "0 0 700 1000");
  expect(errors).toEqual([]);
});

test("the fold style control names its options and explains them", async ({ page }) => {
  const errors = await openSetup(page);
  await expect(page.getByText("Fold style", { exact: true })).toBeVisible();
  await expect(page.getByTestId("folds-1")).toHaveText("Folio · 1 fold");
  await expect(page.getByTestId("folds-2")).toHaveText("Quarto · 2 folds");
  await expect(page.getByTestId("folds-3")).toHaveText("Octavo · 3 folds");
  await expect(page.getByText(/Folio suits most zines\. Quarto and octavo need the head or fore-edge trimmed open after sewing\./)).toBeVisible();
  expect(errors).toEqual([]);
});

test("a sheet with no room for fold marks warns only while fold marks are on", async ({ page }) => {
  // Each 576x378 folio is exactly as tall as the 700x378 sheet: the cuts tick in the side margins, the fold can't.
  const errors = await openSetup(page, fixture("book-8.pdf"));
  await page.getByTestId("sheet-size").selectOption("custom");
  await page.getByTestId("sheet-width").fill("700");
  await page.getByTestId("sheet-height").fill("378");
  await page.getByTestId("margin").fill("0");
  await page.getByTestId("start").click();
  const warning = page.locator("[data-testid=issue-warning][data-code=no-room-for-marks]");
  await expect(warning).toHaveText([
    "Cut/fold marks would overlap page content on sheet 1.",
    "Cut/fold marks would overlap page content on sheet 2.",
  ]);
  await page.getByTestId("fold-marks").uncheck();
  await expect(warning).toHaveCount(0);
  await page.getByTestId("fold-marks").check();
  await page.getByTestId("cut-marks").uncheck();
  await expect(warning).toHaveCount(2);
  expect(errors).toEqual([]);
});
