// The 3D book, assembled from the printed sheets by the Layout's assembly steps.
//
// data-testids used here:
//   preview-3d       the 3D panel (data-spread = open spread, data-source = layout/export, data-webgl = true/false)
//   spread-label     what the open spread shows, from the assembled book ("Cover, page 1", "Pages 2–3", ...)
//   spread-prev, spread-next   turn back or on a spread (← and → do the same while the panel has focus)
//   spread-face      a face of the open spread (data-position = left/right, data-page = 0-based page or blank,
//                    data-sheet, data-side, data-region = "x y width height" on that printed side,
//                    data-rotation, data-painted = its texture is ready)
//   verify-export    exports without marks, builds the book's faces from the exported sheets and compares
//                    each page face with the preview's
//   verify-progress  "Exporting…" then "Checking page faces…" while it runs
//   verify-result    the verdict: all pages match, or which differ
//   show-difference  turns the book to the first differing page
//   from-export      the "Built from exported PDF" badge
//   assembly-problem the first step the sheets could not be assembled by, when any
//   preview-wide     makes the panel as wide as the sheet view, or back
import { test, expect, type Page } from "@playwright/test";
import { impose } from "../../engine/src/index.ts";
import { DEFAULT_SETTINGS, toBookSpec } from "../src/lib/book.ts";
import { FIRST_BUILD_MS, fixture, openWithBoards } from "./open-book.ts";

test.describe.configure({ timeout: FIRST_BUILD_MS + 60_000 });

const LANDSCAPE_76 = fixture("landscape-76.pdf");

/** Where the app's Layout prints 0-based `page`: the same book openWithBoards sets up, imposed here. */
function printed(page: number) {
  const layout = impose(toBookSpec(Array.from({ length: 76 }, () => ({ width: 378, height: 288 })), {
    ...DEFAULT_SETTINGS, frontBoard: true, backBoard: true, signatures: 10,
  }));
  for (const [sheet, s] of layout.sheets.entries()) {
    for (const side of ["front", "back"] as const) {
      const p = s[side].placements.find((placement) => placement.pdfPage === page);
      if (p) return { sheet: String(sheet), side, region: `${p.panel.x} ${p.panel.y} ${p.panel.width} ${p.panel.height}` };
    }
  }
  throw new Error(`page ${page} is not printed`);
}

const face = (page: Page, position: "left" | "right") => page.locator(`[data-testid=spread-face][data-position=${position}]`);

async function faceSource(page: Page, position: "left" | "right") {
  const f = face(page, position);
  return { sheet: await f.getAttribute("data-sheet"), side: await f.getAttribute("data-side"), region: await f.getAttribute("data-region") };
}

async function expectCanvas(page: Page) {
  const panel = page.getByTestId("preview-3d");
  // Every Chromium the specs run (SwiftShader) has WebGL; elsewhere only the canvas check is skipped.
  test.skip((await panel.getAttribute("data-webgl")) !== "true", "no WebGL in this browser: the scene state is still checked, the canvas is not");
  await expect(panel.locator("canvas")).toBeVisible();
}

test("the closed book shows the cover; turning shows pages 2 and 3 from where the sheets print them", async ({ page }) => {
  const errors = await openWithBoards(page, LANDSCAPE_76);
  const panel = page.getByTestId("preview-3d");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("spread-label")).toHaveText("Cover, page 1");
  await expect(face(page, "right")).toHaveAttribute("data-page", "0");
  expect(await faceSource(page, "right")).toEqual(printed(0));

  await panel.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("spread-label")).toHaveText("Pages 2–3");
  await expect(panel).toHaveAttribute("data-spread", "1");
  expect(await faceSource(page, "left")).toEqual(printed(1));
  expect(await faceSource(page, "right")).toEqual(printed(2));
  // Landscape pages print turned a quarter; the faces turn them back upright.
  await expect(face(page, "left")).not.toHaveAttribute("data-rotation", "0");
  await expect(face(page, "right")).toHaveAttribute("data-painted", "true");
  // The keys turned the book, not the sheet view.
  await expect(page.getByTestId("sheet-stepper")).toContainText("Sheet 1 of 11");

  await page.getByTestId("spread-prev").click();
  await expect(page.getByTestId("spread-label")).toHaveText("Cover, page 1");
  await expectCanvas(page);
  expect(errors).toEqual([]);
});

test("a page misplaced on a printed sheet shows up misplaced in the book", async ({ page }) => {
  // Swap where pages 3 and 8 (0-based 2 and 7) are printed, as a broken engine might.
  await page.addInitScript(() => {
    (window as { __bookcomposerCorruptLayout?: (layout: { sheets: { front: { placements: { pdfPage: number | null }[] } }[] }) => void })
      .__bookcomposerCorruptLayout = (layout) => {
        const placements = layout.sheets.flatMap((s) => s.front.placements);
        const a = placements.find((p) => p.pdfPage === 2)!;
        const b = placements.find((p) => p.pdfPage === 7)!;
        [a.pdfPage, b.pdfPage] = [b.pdfPage, a.pdfPage];
      };
  });
  const errors = await openWithBoards(page, LANDSCAPE_76);
  await page.getByTestId("spread-next").click();
  await expect(page.getByTestId("spread-label")).toHaveText("Pages 2–8");
  await expect(face(page, "right")).toHaveAttribute("data-page", "7");
  expect(errors).toEqual([]);
});

test("sheets that cannot be assembled by their steps say so", async ({ page }) => {
  // Fold the first piece's spine with the wrong half, as a broken engine might say to.
  await page.addInitScript(() => {
    (window as { __bookcomposerCorruptLayout?: (layout: { assembly: { pieces: { folds: { moves: string }[] }[] } }) => void })
      .__bookcomposerCorruptLayout = (layout) => {
        layout.assembly.pieces[0]!.folds[0]!.moves = "right";
      };
  });
  const errors = await openWithBoards(page, LANDSCAPE_76);
  await expect(page.getByTestId("assembly-problem")).toContainText("The sheets do not assemble cleanly: piece 0:");
  expect(errors).toEqual([]);
});

test("verify export builds the book from the exported sheets until the settings change", async ({ page }) => {
  const errors = await openWithBoards(page, LANDSCAPE_76);
  await page.getByTestId("spread-next").click();
  await page.getByTestId("verify-export").click();
  await expect(page.getByTestId("verify-export")).toBeDisabled();
  await expect(page.getByTestId("verify-result")).toHaveText("Export verified: all 76 pages match the preview, in order.", { timeout: FIRST_BUILD_MS });
  await expect(page.getByTestId("from-export")).toHaveText("Built from exported PDF", { timeout: FIRST_BUILD_MS });
  await expect(page.getByTestId("preview-3d")).toHaveAttribute("data-source", "export");
  // Already built from this export: checking again would only repaint it.
  await expect(page.getByTestId("verify-export")).toBeDisabled();
  await expect(page.getByTestId("spread-label")).toHaveText("Pages 2–3");
  await expect(face(page, "left")).toHaveAttribute("data-painted", "true");
  await expect(face(page, "right")).toHaveAttribute("data-painted", "true");
  expect(await faceSource(page, "right")).toEqual(printed(2));

  await page.getByTestId("margin").fill("10");
  await expect(page.getByTestId("from-export")).toHaveCount(0);
  await expect(page.getByTestId("verify-result")).toHaveCount(0);
  await expect(page.getByTestId("preview-3d")).toHaveAttribute("data-source", "layout");
  await expect(page.getByTestId("verify-export")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("verify export names the pages whose exported face differs and turns the book to the first", async ({ page }) => {
  // Blacks out where the export prints page 14 (0-based 13), as a broken exporter might.
  const target = printed(13);
  await page.addInitScript((t) => {
    (window as { __bookcomposerPerturbExport?: (ctx: CanvasRenderingContext2D, side: { sheet: number; side: string; scale: number }) => void })
      .__bookcomposerPerturbExport = (ctx, side) => {
        if (String(side.sheet) !== t.sheet || side.side !== t.side) return;
        const [x, y, w, h] = t.region.split(" ").map((n) => Number(n) * side.scale);
        ctx.fillStyle = "#000000";
        ctx.fillRect(x!, y!, w!, h!);
      };
  }, target);
  const errors = await openWithBoards(page, LANDSCAPE_76);
  await page.getByTestId("verify-export").click();
  await expect(page.getByTestId("verify-result")).toContainText("Export differs on 1 page: 14", { timeout: FIRST_BUILD_MS });
  await page.getByTestId("show-difference").click();
  await expect(page.getByTestId("spread-label")).toContainText("14");
  expect(errors).toEqual([]);
});

test("the panel can be made as wide as the sheet view and back", async ({ page }) => {
  const errors = await openWithBoards(page, LANDSCAPE_76);
  const panel = page.getByTestId("preview-3d");
  const narrow = (await panel.boundingBox())!.width;
  await page.getByTestId("preview-wide").click();
  await expect(page.getByTestId("preview-wide")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(narrow);
  await page.getByTestId("preview-wide").click();
  await expect.poll(async () => (await panel.boundingBox())!.width).toBe(narrow);
  expect(errors).toEqual([]);
});
